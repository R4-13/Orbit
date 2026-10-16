/**
 * Legt für Browser-Tests einen Betreiberzugang an oder löscht ihn wieder (PLT-02: Oberfläche des zweiten Faktors). Gibt eine JSON-Zeile aus; das Passwort steht nur dort.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-platform-user.ts create
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-platform-user.ts delete <id>
 *
 * Der Zugang hat die Rolle `PLATFORM_OPERATOR`, die E-Mail beginnt mit `e2e-ui-`; `delete` entfernt nur solche Zugänge (samt Sitzungen).
 */
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PLATFORM_ROLES } from '@orbit/shared';
import { AppModule } from '../src/app.module';
import { PlatformIdentityService } from '../src/platform/identity/platform-identity.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [command, id] = process.argv.slice(2);
  if (command !== 'create' && command !== 'delete') throw new Error('Aufruf: e2e-platform-user.ts create | delete <id>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    if (command === 'create') {
      const tag = randomBytes(4).toString('hex');
      const email = `e2e-ui-mfa-${tag}@platform-test.example`;
      const password = `Ui-${randomBytes(12).toString('base64url')}#7`;
      const created = await app.get(PlatformIdentityService).create(null, { email, displayName: `UI MFA ${tag}`, password, roles: [PLATFORM_ROLES.PLATFORM_OPERATOR] });
      console.log(JSON.stringify({ id: created.id, email, password }));
      return;
    }
    if (!id) throw new Error('delete braucht die Kennung.');
    const deleted = await app.get(PrismaService).withPlatformScope((tx) => tx.platformUser.deleteMany({ where: { id, email: { startsWith: 'e2e-ui-' } } }));
    console.log(JSON.stringify({ deleted: deleted.count }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
