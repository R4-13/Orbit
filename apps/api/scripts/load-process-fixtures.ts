/**
 * Loads the reference process fixtures into one tenant (Amendment 02 §10 / §24): the test system-of-record data and the
 * REQUEST_FOR_QUOTE blueprint, published and activated. Idempotent — running it again updates prices/rules and leaves an
 * already published blueprint version untouched. Touches only the named tenant; never resets or reseeds anything.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/load-process-fixtures.ts <tenant-slug>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';

const FIXTURES = join(__dirname, '../../../fixtures/process');

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) throw new Error('Usage: ts-node scripts/load-process-fixtures.ts <tenant-slug>');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Tenant "${slug}" not found.`);

    const reference = await app.get(ReferenceProcessService).loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    console.log(`Referenzdaten für ${tenant.name}: ${reference.catalogItems} Katalogeinträge, ${reference.requirementRules} Regeln (Test-SoR).`);

    const blueprints = app.get(BlueprintRegistryService);
    const definition = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    const existing = await blueprints.get(tenant.id, definition.key, definition.version).catch(() => undefined);
    if (existing && existing.status !== 'DRAFT') {
      console.log(`Blueprint ${definition.key} ${definition.version} ist bereits ${existing.status} und bleibt unverändert.`);
    } else {
      const imported = await blueprints.importDraft(tenant.id, 'fixture-loader', definition);
      if (!imported.validation.valid) throw new Error(`Blueprint ungültig: ${JSON.stringify(imported.validation.issues)}`);
      for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'fixture-loader', definition.key, definition.version, to);
      console.log(`Blueprint ${definition.key} ${definition.version} veröffentlicht.`);
    }
    if (!(await blueprints.getActive(tenant.id, definition.key))) {
      await blueprints.activate(tenant.id, 'fixture-loader', definition.key, definition.version);
      console.log('Blueprint für den Mandanten aktiviert.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
