import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ValidationFailedError, type PlatformPrincipal } from '@orbit/shared';
import { CredentialEncryptionService } from '../../security/credential-encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { base32Decode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, looksLikeRecoveryCode, otpauthUri, verifyTotp } from './totp';

export const MFA_ISSUER = 'ZERIONUS Plattform';

export type MfaVerification = 'TOTP' | 'RECOVERY';

/**
 * Zweiter Faktor für Plattformzugänge (PLT-02): TOTP nach RFC 6238 plus einmalige Wiederherstellungscodes. Das Geheimnis liegt verschlüsselt (AES-256-GCM, derselbe
 * Schlüssel wie die Tresore), wird bei der Einrichtung **einmal** angezeigt und nie wieder ausgegeben. Erst die erste gültige Eingabe (`enable`) schaltet den Faktor scharf –
 * eine abgebrochene Einrichtung sperrt niemanden aus. Das Passwort wird vom Aufrufer geprüft (`PlatformAuthService.assertPassword`).
 */
@Injectable()
export class PlatformMfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Beginnt die Einrichtung: neues Geheimnis (überschreibt ein noch nicht bestätigtes). Bei bereits aktivem Faktor zuerst deaktivieren. */
  async beginSetup(principal: PlatformPrincipal): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.withPlatformScope((tx) => tx.platformUser.findUnique({ where: { id: principal.userId } }));
    if (!user) throw new UnauthorizedException('Unknown identity.');
    if (user.mfaEnabledAt) throw new ValidationFailedError('Der zweite Faktor ist bereits eingerichtet. Deaktivieren Sie ihn zuerst, wenn Sie ihn neu einrichten möchten.');
    const secret = generateTotpSecret();
    const encrypted = new Uint8Array(this.encryption.encrypt(secret));
    await this.prisma.withPlatformScope((tx) => tx.platformUser.update({ where: { id: user.id }, data: { mfaSecretEnc: encrypted, mfaLastStep: null } }));
    return { secret, otpauthUri: otpauthUri({ secret, account: user.email, issuer: MFA_ISSUER }) };
  }

  /** Bestätigt die Einrichtung mit dem ersten Code und gibt die Wiederherstellungscodes **einmal** aus. */
  async enable(principal: PlatformPrincipal, code: string, now = new Date()): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.withPlatformScope((tx) => tx.platformUser.findUnique({ where: { id: principal.userId } }));
    if (!user?.mfaSecretEnc) throw new ValidationFailedError('Es läuft keine Einrichtung. Starten Sie sie zuerst.');
    if (user.mfaEnabledAt) throw new ValidationFailedError('Der zweite Faktor ist bereits eingerichtet.');
    const step = verifyTotp(base32Decode(this.encryption.decrypt(Buffer.from(user.mfaSecretEnc))), code, now);
    if (step === null) {
      await this.audit.record({ eventType: 'PLATFORM_ACCESS_DENIED', actor: { userId: user.id, roles: principal.platformRoles }, targetType: 'PlatformUser', targetId: user.id, reason: 'mfa setup: invalid code' });
      throw new ValidationFailedError('Der Code stimmt nicht. Prüfen Sie die Uhrzeit Ihres Geräts und versuchen Sie es mit dem aktuellen Code erneut.');
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.withPlatformScope(async (tx) => {
      await tx.platformUser.update({ where: { id: user.id }, data: { mfaEnabledAt: now, mfaLastStep: step, mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode) } });
      // Andere Sitzungen enden: wer das Konto vor der Einrichtung übernommen hatte, bleibt nicht angemeldet.
      await tx.platformSession.updateMany({ where: { platformUserId: user.id, revokedAt: null, id: { not: principal.sessionId } }, data: { revokedAt: now, revokedReason: 'MFA_ENABLED' } });
    });
    await this.audit.record({ eventType: 'PLATFORM_MFA_ENABLED', actor: { userId: user.id, roles: principal.platformRoles }, targetType: 'PlatformUser', targetId: user.id });
    return { recoveryCodes };
  }

  /** Schaltet den Faktor ab (Passwort und aktueller Code, vom Aufrufer bzw. hier geprüft). */
  async disable(principal: PlatformPrincipal, code: string, now = new Date()): Promise<void> {
    const verified = await this.verify(principal.userId, code, now);
    if (!verified) {
      await this.audit.record({ eventType: 'PLATFORM_ACCESS_DENIED', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'PlatformUser', targetId: principal.userId, reason: 'mfa disable: invalid code' });
      throw new UnauthorizedException('Invalid credentials.');
    }
    await this.prisma.withPlatformScope((tx) => tx.platformUser.update({ where: { id: principal.userId }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } }));
    await this.audit.record({ eventType: 'PLATFORM_MFA_DISABLED', actor: { userId: principal.userId, roles: principal.platformRoles }, targetType: 'PlatformUser', targetId: principal.userId });
  }

  /** Setzt den zweiten Faktor eines Zugangs zurück (Owner-Aktion beim Zurücksetzen; die Person richtet ihn danach neu ein). */
  async reset(platformUserId: string): Promise<void> {
    await this.prisma.withPlatformScope((tx) => tx.platformUser.update({ where: { id: platformUserId }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } }));
  }

  /**
   * Prüft einen Code für Anmeldung, Step-up oder Deaktivierung. TOTP: gültig nur für einen neueren Zeitschritt als der zuletzt akzeptierte (atomar fortgeschrieben, damit zwei
   * gleichzeitige Anfragen mit demselben Code nicht beide gelten). Wiederherstellungscode: gilt genau einmal. Gibt die Art zurück oder `null`.
   */
  async verify(platformUserId: string, input: string, now = new Date()): Promise<MfaVerification | null> {
    const user = await this.prisma.withPlatformScope((tx) => tx.platformUser.findUnique({ where: { id: platformUserId } }));
    if (!user?.mfaEnabledAt || !user.mfaSecretEnc) return null;
    if (looksLikeRecoveryCode(input)) {
      const hash = hashRecoveryCode(input);
      if (!user.mfaRecoveryHashes.includes(hash)) return null;
      const consumed = await this.prisma.withPlatformScope((tx) =>
        tx.platformUser.updateMany({ where: { id: user.id, mfaRecoveryHashes: { has: hash } }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((h) => h !== hash) } }),
      );
      if (consumed.count !== 1) return null;
      await this.audit.record({ eventType: 'PLATFORM_MFA_RECOVERY_USED', actor: { userId: user.id, roles: [] }, targetType: 'PlatformUser', targetId: user.id, extra: { remaining: user.mfaRecoveryHashes.length - 1 } });
      return 'RECOVERY';
    }
    const step = verifyTotp(base32Decode(this.encryption.decrypt(Buffer.from(user.mfaSecretEnc))), input, now, user.mfaLastStep);
    if (step === null) return null;
    const advanced = await this.prisma.withPlatformScope((tx) =>
      tx.platformUser.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } }),
    );
    return advanced.count === 1 ? 'TOTP' : null;
  }
}
