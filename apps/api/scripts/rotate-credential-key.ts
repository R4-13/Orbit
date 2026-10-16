/**
 * Rotiert `CREDENTIAL_ENCRYPTION_KEY` (TEC-08): alle verschlüsselten Zugangsdaten werden mit dem neuen Schlüssel neu verschlüsselt, in einer Transaktion.
 *
 *   # 1. neuen Schlüssel erzeugen:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   # 2. Probelauf (schreibt nichts, prüft nur, dass alles mit dem alten Schlüssel lesbar ist):
 *   set -a && source .env && set +a
 *   CREDENTIAL_ENCRYPTION_KEY_NEW='<neuer Schlüssel>' pnpm --filter @orbit/api exec ts-node scripts/rotate-credential-key.ts --dry-run
 *   # 3. echter Lauf (ohne --dry-run), danach CREDENTIAL_ENCRYPTION_KEY auf den neuen Wert setzen und API + Worker neu starten.
 *
 * Der alte Schlüssel ist `CREDENTIAL_ENCRYPTION_KEY` aus der Umgebung. Vorher eine Sicherung der Datenbank anlegen (docs/DEPLOYMENT.md, „Sicherung und Wiederherstellung“).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { parseKey, rotateCredentialKey } from '../src/security/credential-key-rotation';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const oldKey = parseKey(process.env.CREDENTIAL_ENCRYPTION_KEY ?? '', 'CREDENTIAL_ENCRYPTION_KEY (alt)');
  const newKey = parseKey(process.env.CREDENTIAL_ENCRYPTION_KEY_NEW ?? '', 'CREDENTIAL_ENCRYPTION_KEY_NEW');
  if (oldKey.equals(newKey)) throw new Error('Der neue Schlüssel ist identisch mit dem alten.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const report = await rotateCredentialKey(app.get(PrismaService), oldKey, newKey, { dryRun });
    console.log(`${dryRun ? 'Probelauf – nichts geschrieben' : 'Rotiert'}: ${report.integrationSecrets} Anbindungs-Zugangsdaten, ${report.platformSecrets} Plattform-Geheimnisse, ${report.mfaSecrets} Geheimnisse zweiter Faktoren, ${report.aiProviderConnections} KI-Zugänge.`);
    if (!dryRun) console.log('Jetzt CREDENTIAL_ENCRYPTION_KEY auf den neuen Wert setzen und API und Worker neu starten.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
