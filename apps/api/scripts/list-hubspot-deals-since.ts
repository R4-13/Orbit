/**
 * Listet (nur lesend) HubSpot-Deals, die seit einem Zeitpunkt angelegt wurden – um nach einem Messlauf nachzusehen, ob der Lauf Deals erzeugt hat.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/list-hubspot-deals-since.ts <tenant-slug> <ISO-Zeitpunkt>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HubSpotService } from '../src/connectors/hubspot.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [slug, sinceText] = process.argv.slice(2);
  const since = new Date(sinceText ?? '');
  if (!slug || Number.isNaN(since.getTime())) throw new Error('Aufruf: list-hubspot-deals-since.ts <tenant-slug> <ISO-Zeitpunkt>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const tenant = await app.get(PrismaService).withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const hubspot = app.get(HubSpotService);
    if (!(await hubspot.isConnected(tenant.id))) throw new Error('HubSpot ist nicht verbunden.');
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await hubspot.tokenFor(tenant.id)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(since.getTime()) }] }], properties: ['dealname', 'createdate', 'dealstage', 'pipeline', 'hs_lastmodifieddate'], limit: 50 }),
    });
    const body = (await response.json()) as { total?: number; results?: Array<{ id: string; properties: Record<string, string | null> }> };
    console.log(`HTTP ${response.status}, Treffer: ${body.total ?? '?'}`);
    for (const deal of body.results ?? []) console.log(`${deal.id} · ${deal.properties.dealname} · angelegt ${deal.properties.createdate} · Phase ${deal.properties.dealstage}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
