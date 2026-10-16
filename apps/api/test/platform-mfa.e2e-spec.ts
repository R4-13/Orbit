import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PLATFORM_ROLES } from '@orbit/shared';
import request from 'supertest';
import { PlatformAuthService } from '../src/platform/auth/platform-auth.service';
import { base32Decode, totp, totpStep } from '../src/platform/auth/totp';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * PLT-02 — zweiter Faktor (TOTP) für Plattformzugänge: Einrichtung mit Passwort und erstem Code, Anmeldung nur mit Code, derselbe Code gilt nie zweimal,
 * Step-up verlangt den Code, Wiederherstellungscodes gelten einmal, Deaktivierung und Rücksetzen durch den Owner. Das Geheimnis liegt nur verschlüsselt in der Datenbank.
 */
describe('Plattform: zweiter Faktor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: PlatformAuthService;
  let identities: PlatformIdentityService;
  const suffix = randomBytes(4).toString('hex');
  const password = `Pf-${randomBytes(9).toString('base64url')}-9!`;
  const created: string[] = [];
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function makeIdentity(tag: string, role = PLATFORM_ROLES.PLATFORM_OPERATOR) {
    const email = `mfa-${suffix}-${tag}@platform-test.example`;
    const identity = await identities.create(null, { email, displayName: `MFA ${tag}`, password, roles: [role] });
    created.push(identity.id);
    const tokens = await auth.login(email, password);
    return { id: identity.id, email, token: tokens.accessToken };
  }

  /** Richtet den zweiten Faktor vollständig ein und gibt Geheimnis und Wiederherstellungscodes zurück. */
  async function enrol(person: { token: string }) {
    const setup = (await api().post('/api/v1/platform/auth/mfa/setup').set(bearer(person.token)).send({ password }).expect(200)).body as { secret: string; otpauthUri: string };
    const secret = base32Decode(setup.secret);
    const enabled = (await api().post('/api/v1/platform/auth/mfa/enable').set(bearer(person.token)).send({ code: totp(secret, new Date()) }).expect(200)).body as { recoveryCodes: string[] };
    return { setup, secret, recoveryCodes: enabled.recoveryCodes };
  }

  /** Ein Code für einen späteren Zeitschritt als der zuletzt benutzte (die Tests laufen innerhalb weniger Sekunden). */
  const nextCode = (secret: Buffer, afterStep: number) => ({ code: totp(secret, new Date((afterStep + 1) * 30_000 + 1000)), step: afterStep + 1 });
  /** Die Tests laufen innerhalb weniger Sekunden; damit ein weiterer Code gilt, wird der zuletzt akzeptierte Zeitschritt zurückgesetzt (der Wiederholungsschutz selbst ist im Anmeldetest geprüft). */
  const rewind = (id: string) => prisma.withPlatformScope((tx) => tx.platformUser.update({ where: { id }, data: { mfaLastStep: totpStep(new Date()) - 5 } }));
  const currentCode = (secret: Buffer) => totp(secret, new Date());
  const login = (email: string, body: Record<string, string> = {}) => api().post('/api/v1/platform/auth/login').send({ email, password, ...body });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    auth = app.get(PlatformAuthService);
    identities = app.get(PlatformIdentityService);
  });
  afterAll(async () => {
    await prisma.withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id: { in: created } } }));
    await app.close();
  });

  it('Einrichtung verlangt das Passwort; das Geheimnis liegt nur verschlüsselt in der Datenbank; ohne ersten Code ist nichts scharf', async () => {
    const person = await makeIdentity('setup');
    await api().post('/api/v1/platform/auth/mfa/setup').set(bearer(person.token)).send({ password: 'falsch-falsch-falsch' }).expect(401);
    const setup = (await api().post('/api/v1/platform/auth/mfa/setup').set(bearer(person.token)).send({ password }).expect(200)).body as { secret: string; otpauthUri: string };
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);

    const row = await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }));
    expect(row.mfaEnabledAt).toBeNull(); // noch nicht bestätigt
    expect(Buffer.from(row.mfaSecretEnc as Uint8Array).toString('utf8')).not.toContain(setup.secret);
    expect(JSON.stringify(row)).not.toContain(setup.secret);
    await login(person.email).expect(200); // abgebrochene Einrichtung sperrt niemanden aus

    // Ein falscher erster Code schaltet nichts scharf.
    await api().post('/api/v1/platform/auth/mfa/enable').set(bearer(person.token)).send({ code: '000000' }).expect(400);
    expect((await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }))).mfaEnabledAt).toBeNull();
  });

  it('nach der Einrichtung braucht die Anmeldung den Code; derselbe Code gilt nicht zweimal; die Sitzung hat die Stufe MFA', async () => {
    const person = await makeIdentity('login');
    const { secret, recoveryCodes } = await enrol(person);
    expect(recoveryCodes).toHaveLength(8);
    const row = await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }));
    expect(row.mfaEnabledAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain(recoveryCodes[0]); // nur Hashes

    // Nur Passwort: eindeutige Antwort MFA_REQUIRED (401), kein Token.
    const noCode = await login(person.email).expect(401);
    expect(noCode.body).toMatchObject({ code: 'MFA_REQUIRED' });
    expect(noCode.body.accessToken).toBeUndefined();
    // Falscher Code: wie ein falsches Passwort.
    expect((await login(person.email, { mfaCode: '000000' }).expect(401)).body.code).not.toBe('MFA_REQUIRED');

    // Der beim Einrichten benutzte Code ist verbraucht, ein neuerer Schritt gilt.
    const used = (await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }))).mfaLastStep as number;
    await login(person.email, { mfaCode: totp(secret, new Date(used * 30_000 + 1000)) }).expect(401); // derselbe Zeitschritt
    const next = nextCode(secret, used);
    const ok = (await login(person.email, { mfaCode: next.code }).expect(200)).body as { accessToken: string; principal: { authenticationAssurance: string; mfaEnabled: boolean } };
    expect(ok.principal).toMatchObject({ authenticationAssurance: 'MFA', mfaEnabled: true });
    await login(person.email, { mfaCode: next.code }).expect(401); // Wiederholung desselben Codes
    expect((await api().get('/api/v1/platform/me').set(bearer(ok.accessToken)).expect(200)).body.authenticationAssurance).toBe('MFA');
  });

  it('Step-up verlangt zusätzlich den aktuellen Code', async () => {
    const person = await makeIdentity('stepup');
    const { secret } = await enrol(person);
    await rewind(person.id);
    const session = await login(person.email, { mfaCode: currentCode(secret) }).expect(200);
    const token = session.body.accessToken as string;
    const stepUp = (body: Record<string, string>) => api().post('/api/v1/platform/auth/step-up').set(bearer(token)).send(body);

    expect((await stepUp({ password }).expect(401)).body).toMatchObject({ code: 'MFA_REQUIRED' });
    await stepUp({ password, mfaCode: '000000' }).expect(401);
    await rewind(person.id);
    await stepUp({ password: 'falsch-falsch-falsch', mfaCode: currentCode(secret) }).expect(401);
    const done = (await stepUp({ password, mfaCode: currentCode(secret) }).expect(200)).body as { authenticationAssurance: string; stepUpUntil: string };
    expect(done.authenticationAssurance).toBe('MFA');
    expect(new Date(done.stepUpUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it('ein Wiederherstellungscode gilt genau einmal und ersetzt den Code bei der Anmeldung', async () => {
    const person = await makeIdentity('recovery');
    const { recoveryCodes } = await enrol(person);
    const first = recoveryCodes[0] as string;
    await login(person.email, { mfaCode: first.toUpperCase() }).expect(200); // Schreibweise egal
    await login(person.email, { mfaCode: first }).expect(401); // verbraucht
    await login(person.email, { mfaCode: recoveryCodes[1] as string }).expect(200);
    const row = await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }));
    expect(row.mfaRecoveryHashes).toHaveLength(6);
    const audit = await prisma.withPlatformScope((tx) => tx.auditLog.count({ where: { domain: 'PLATFORM', eventType: 'PLATFORM_MFA_RECOVERY_USED', entityId: person.id } }));
    expect(audit).toBe(2);
  });

  it('Deaktivieren verlangt Passwort und Code; danach genügt wieder das Passwort; das Audit hält beides fest', async () => {
    const person = await makeIdentity('disable');
    const { secret } = await enrol(person);
    await rewind(person.id);
    const token = (await login(person.email, { mfaCode: currentCode(secret) }).expect(200)).body.accessToken as string;
    const disable = (body: Record<string, string>) => api().post('/api/v1/platform/auth/mfa/disable').set(bearer(token)).send(body);
    await rewind(person.id);
    await disable({ password: 'falsch-falsch-falsch', code: currentCode(secret) }).expect(401);
    await disable({ password, code: '000000' }).expect(401);
    await disable({ password, code: currentCode(secret) }).expect(204);
    await login(person.email).expect(200);
    const events = await prisma.withPlatformScope((tx) => tx.auditLog.findMany({ where: { domain: 'PLATFORM', eventType: { in: ['PLATFORM_MFA_ENABLED', 'PLATFORM_MFA_DISABLED'] }, entityId: person.id } }));
    expect(events.map((e) => e.eventType).sort()).toEqual(['PLATFORM_MFA_DISABLED', 'PLATFORM_MFA_ENABLED']);
    expect(JSON.stringify(events)).not.toContain(password);
  });

  it('der Owner kann den Faktor einer anderen Person zurücksetzen (Sitzungen enden), den eigenen nicht; ohne Faktor gibt es nichts zurückzusetzen', async () => {
    const owner = await makeIdentity('owner', PLATFORM_ROLES.PLATFORM_OWNER);
    const person = await makeIdentity('lost');
    const { secret } = await enrol(person);
    // Step-up des Owners (ohne eigenen Faktor genügt das Passwort).
    await api().post('/api/v1/platform/auth/step-up').set(bearer(owner.token)).send({ password }).expect(200);
    const reset = (id: string) => api().post(`/api/v1/platform/identities/${id}/reset-mfa`).set(bearer(owner.token)).send({ reason: 'Authenticator verloren' });
    await reset(owner.id).expect(400); // nicht für sich selbst
    const done = (await reset(person.id).expect(200)).body as { revokedSessions: number };
    expect(done.revokedSessions).toBeGreaterThanOrEqual(1);
    await reset(person.id).expect(400); // nichts mehr zurückzusetzen
    await login(person.email).expect(200); // wieder nur Passwort
    // Das alte Geheimnis ist wertlos.
    expect((await prisma.withPlatformScope((tx) => tx.platformUser.findUniqueOrThrow({ where: { id: person.id } }))).mfaSecretEnc).toBeNull();
    expect(totpStep(new Date())).toBeGreaterThan(0);
    expect(secret).toBeDefined();
  });
});
