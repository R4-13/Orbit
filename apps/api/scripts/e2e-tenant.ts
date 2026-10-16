/**
 * Legt für Browser-Tests einen zweiten, frischen Betrieb an oder löscht ihn wieder (UX-01: Mandantenwechsel A/B). Gibt eine JSON-Zeile aus; das Passwort steht nur dort.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-tenant.ts create
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-tenant.ts delete <tenantId>
 *
 * Der Betrieb heißt `e2e-…` und gehört nur dem Test; `delete` entfernt ihn samt allen Daten. Er hat keine Verbindung zu einem Demo- oder Kundenbetrieb.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';

async function main(): Promise<void> {
  const [command, tenantId] = process.argv.slice(2);
  if (command !== 'create' && command !== 'delete') throw new Error('Aufruf: e2e-tenant.ts create | delete <tenantId>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    if (command === 'create') {
      const suffix = randomUUID();
      const password = `Ab-${randomBytes(12).toString('base64url')}#9`;
      const email = `admin-${suffix}@e2e-ab.example`;
      const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `AB-Test ${suffix.slice(0, 8)}`, slug: `e2e-ab-${suffix}`, adminEmail: email, adminPassword: password, adminFirstName: 'Bea', adminLastName: 'Test' });
      console.log(JSON.stringify({ tenantId: tenant.id, email, password }));
      return;
    }
    if (!tenantId) throw new Error('delete braucht die tenantId.');
    const prisma = app.get(PrismaService);
    // Nur Betriebe, die dieses Skript angelegt hat – nie ein anderer Betrieb.
    const deleted = await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId, slug: { startsWith: 'e2e-ab-' } } }));
    console.log(JSON.stringify({ deleted: deleted.count }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
