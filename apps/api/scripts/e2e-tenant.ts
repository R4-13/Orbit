/**
 * Legt für Browser-Tests einen zweiten, frischen Betrieb an oder löscht ihn wieder (UX-01: Mandantenwechsel A/B). Gibt eine JSON-Zeile aus; das Passwort steht nur dort.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-tenant.ts create [--roles viewer,finance,sales,approver]
 *   pnpm --filter @orbit/api exec ts-node scripts/e2e-tenant.ts delete <tenantId>
 *
 * Der Betrieb heißt `e2e-…` und gehört nur dem Test; `delete` entfernt ihn samt allen Daten. Er hat keine Verbindung zu einem Demo- oder Kundenbetrieb.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { ROLES } from '@orbit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';

async function main(): Promise<void> {
  const [command, tenantId] = process.argv.slice(2);
  const rolesIndex = process.argv.indexOf('--roles');
  const extraRoles = rolesIndex >= 0 ? (process.argv[rolesIndex + 1] ?? '').split(',').filter(Boolean) : [];
  if (command !== 'create' && command !== 'delete') throw new Error('Aufruf: e2e-tenant.ts create | delete <tenantId>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    if (command === 'create') {
      const suffix = randomUUID();
      const password = `Ab-${randomBytes(12).toString('base64url')}#9`;
      const email = `admin-${suffix}@e2e-ab.example`;
      const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `AB-Test ${suffix.slice(0, 8)}`, slug: `e2e-ab-${suffix}`, adminEmail: email, adminPassword: password, adminFirstName: 'Bea', adminLastName: 'Test' });
      // Weitere Benutzer mit Rolle (z. B. ein Betrachter neben dem Administrator) – für Tests, die mehrere Rollen im selben Betrieb brauchen.
      const roleNames: Record<string, string> = { viewer: ROLES.VIEWER, finance: ROLES.FINANCE_USER, sales: ROLES.SALES_USER, approver: ROLES.APPROVER };
      const prisma = app.get(PrismaService);
      const users: Record<string, string> = { admin: email };
      for (const role of extraRoles) {
        const roleName = roleNames[role];
        if (!roleName) throw new Error(`Unbekannte Rolle "${role}". Erlaubt: ${Object.keys(roleNames).join(', ')}.`);
        const row = await prisma.forTenantId(tenant.id).role.findFirstOrThrow({ where: { name: roleName } });
        const user = await prisma.forTenantId(tenant.id).user.create({ data: { tenantId: tenant.id, email: `${role}-${suffix}@e2e-ab.example`, passwordHash: await argon2.hash(password), firstName: 'Test', lastName: role, status: 'ACTIVE' } });
        await prisma.forTenantId(tenant.id).userRole.create({ data: { userId: user.id, roleId: row.id } });
        users[role] = user.email;
      }
      console.log(JSON.stringify({ tenantId: tenant.id, email, password, users }));
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
