/**
 * Legt die ERSTE Plattformidentität (Platform Owner) an (Amendment 03 §2.4: Plattformrollen kommen nur aus der Platform-Identity-Administration,
 * nie aus einem Mandantenpfad). Idempotent und defensiv: existiert bereits ein aktiver Owner, passiert nichts. Weitere Identitäten legt ein Owner über
 * `POST /api/v1/platform/identities` an.
 *
 *   set -a && source .env && set +a
 *   PLATFORM_BOOTSTRAP_EMAIL=owner@example.com PLATFORM_BOOTSTRAP_PASSWORD='<mindestens 14 Zeichen>' \
 *     pnpm --filter @orbit/api exec ts-node scripts/platform-bootstrap.ts
 *
 * Ohne PLATFORM_BOOTSTRAP_PASSWORD wird ein zufälliges Passwort erzeugt und EINMALIG auf der Konsole ausgegeben. Es wird nirgends gespeichert.
 */
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PLATFORM_ROLES } from '@orbit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';

async function main(): Promise<void> {
  const email = process.env.PLATFORM_BOOTSTRAP_EMAIL;
  if (!email) throw new Error('PLATFORM_BOOTSTRAP_EMAIL fehlt.');
  const displayName = process.env.PLATFORM_BOOTSTRAP_NAME ?? 'Platform Owner';
  const supplied = process.env.PLATFORM_BOOTSTRAP_PASSWORD;
  const password = supplied ?? randomBytes(18).toString('base64url');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const owners = await prisma.withPlatformScope((tx) =>
      tx.platformRoleAssignment.count({ where: { role: PLATFORM_ROLES.PLATFORM_OWNER, revokedAt: null, user: { status: 'ACTIVE' } } }),
    );
    if (owners > 0) {
      console.log('Es existiert bereits ein aktiver Platform Owner – nichts zu tun.');
      return;
    }
    const created = await app.get(PlatformIdentityService).create(null, { email, displayName, password, roles: [PLATFORM_ROLES.PLATFORM_OWNER] });
    console.log(`Platform Owner angelegt: ${created.email}`);
    if (!supplied) console.log(`Einmaliges Passwort (jetzt notieren, es wird nicht gespeichert): ${password}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
