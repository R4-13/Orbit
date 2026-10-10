import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { SemanticTriageService } from '../src/intake/semantic-triage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const LIVE = process.env.LIVE_AI === '1';

/**
 * LIVE-Nachweis mit dem echten Modell (nur mit `LIVE_AI=1`): erkennt die Triage mit dem Betriebsprofil Notfälle (Dringlichkeit CRITICAL), ohne gewöhnliche Anfragen
 * zu überbewerten? Es wird nichts gesendet; geprüft wird nur die Einstufung. Die Ausgabe zeigt Kategorie, Relevanz und Dringlichkeit je Nachricht.
 */
(LIVE ? describe : describe.skip)('Triage with the tenant profile and the real model (live)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({
      name: `Sanitär Live ${suffix.slice(0, 8)}`,
      slug: `e2e-profile-live-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-live.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
      industry: 'Heizung und Sanitär',
    });
    tenantId = tenant.id;
    await prisma.forTenantId(tenantId).tenantProfile.update({
      where: { tenantId },
      data: { services: ['Heizungswartung', 'Badsanierung', 'Rohrreinigung'], exclusions: ['Elektroarbeiten'], emergencyService: true, emergencyNote: 'Notdienst rund um die Uhr', serviceArea: 'Köln und Umgebung', tone: 'FRIENDLY' },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  const triage = async (subject: string, content: string) => {
    const event = {
      tenantId: '',
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: 'kunde@privat.example', displayName: 'Kim Kunde' },
      recipients: [{ address: 'info@sanitaer.example' }],
      direction: 'INBOUND',
      subject,
      content,
    } as NormalizedIntakeEvent;
    const outcome = await app.get(SemanticTriageService).triage(tenantId, undefined, event);
    if (outcome.status !== 'DECIDED') throw new Error(`Keine Einstufung: ${outcome.status} ${JSON.stringify(outcome).slice(0, 300)}`);
    const row = { subject, category: outcome.result.category, relevance: outcome.result.businessRelevance, urgency: outcome.result.urgency, reason: outcome.result.conciseReason };
    process.stdout.write(`TRIAGE ${JSON.stringify(row)}\n`);
    return outcome.result;
  };

  it('Wasserrohrbruch: kritisch, Notfall', async () => {
    const result = await triage('Wasser läuft durch die Decke!', 'Hallo, bei uns ist im Keller ein Rohr gebrochen, das Wasser steht schon 5 cm hoch und läuft weiter. Bitte sofort jemanden schicken! Kim Kunde, Venloer Str. 12, Köln');
    expect(result.urgency).toBe('CRITICAL');
    expect(result.businessRelevance).toBe('RELEVANT');
  }, 120_000);

  it('Gasgeruch: kritisch', async () => {
    const result = await triage('Es riecht nach Gas in der Küche', 'Seit heute Morgen riecht es in unserer Küche stark nach Gas, die Therme ist daneben. Wir haben die Fenster geöffnet. Was sollen wir tun, können Sie heute noch kommen?');
    expect(result.urgency).toBe('CRITICAL');
  }, 120_000);

  it('gewöhnliche Angebotsanfrage: relevant, aber kein Notfall', async () => {
    const result = await triage('Angebot Badsanierung', 'Guten Tag, wir möchten im Herbst unser Bad (6 qm) sanieren lassen, Dusche statt Wanne. Können Sie uns ein Angebot machen? Viele Grüße, Kim Kunde');
    expect(result.businessRelevance).toBe('RELEVANT');
    expect(result.urgency).not.toBe('CRITICAL');
  }, 120_000);

  it('Werbung ist kein Geschäftsvorgang', async () => {
    const result = await triage('Nur diese Woche: 30 % auf alle Büromöbel', 'Sparen Sie jetzt bei Ihrer nächsten Büroausstattung! Klicken Sie hier und sichern Sie sich den Rabatt. Zum Abbestellen klicken Sie hier.');
    expect(result.businessRelevance).toBe('NON_BUSINESS');
  }, 120_000);
});
