/**
 * Prüft nur lesend, ob ein Zeitraum im verbundenen Google-Kalender eines Betriebs belegt ist (Calendar API `freebusy.query`) – z. B. nach einer Buchung durch ORBIT.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/calendar-slot-check.ts <tenant-slug> <von ISO> <bis ISO>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [slug, from, to] = process.argv.slice(2);
  if (!slug || !from || !to) throw new Error('Usage: ts-node scripts/calendar-slot-check.ts <tenant-slug> <von ISO> <bis ISO>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const tenant = await app.get(PrismaService).withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, timezone: true } }));
    if (!tenant) throw new Error(`Tenant "${slug}" not found.`);
    const result = await app.get(GmailConnectorService).queryFreeBusy(tenant.id, ['primary'], new Date(from), new Date(to), tenant.timezone || 'Europe/Berlin');
    for (const calendar of result) {
      console.log(`${calendar.calendarId}: ${calendar.busy.length === 0 ? 'FREI im gefragten Zeitraum' : `BELEGT – ${calendar.busy.map((b) => `${b.start.toISOString()} bis ${b.end.toISOString()}`).join('; ')}`}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
