import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { IntakeService } from '../src/intake/intake.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CASE_EVENT_TYPES } from '../src/process/case-events.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const LIVE = process.env.LIVE_AI === '1';

/**
 * LIVE-Nachweis mit dem echten Modell (nur mit `LIVE_AI=1`, sonst übersprungen): eine realistische Anfrage läuft durch Triage, Extraktion und die
 * Anforderungsanalyse. Der Versand ist abgefangen (es geht keine Nachricht hinaus), der Kalender ist ein Double mit einer belegten Zeit; alles andere
 * – das Modell, die Prüfregeln, die Datenbank – ist echt. Die Ausgabe zeigt, was die KI erkannt, gefragt und entschieden hat.
 */
(LIVE ? describe : describe.skip)('Request analysis with the real model (live)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  const sent: Array<{ bodyText: string }> = [];

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Musterwerk Live ${suffix.slice(0, 8)}`, slug: `e2e-live-${suffix}`, adminEmail: `admin-${suffix}@e2e-live.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenantId = tenant.id;
    await prisma.forTenantId(tenantId).integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] } });
    await app.get(ReferenceProcessService).loadFixture(tenantId, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantId, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantId, 'u1', blueprint.key, blueprint.version);
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message as never);
      return { providerMessageId: 'x', from: 'firma@e2e.example', executionMode: 'SIMULATED' };
    });
    // Eine belegte Zeit im Kalender: der erste Vorschlag darf sie nicht belegen.
    jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [{ start: new Date(Date.now() + 24 * 3_600_000), end: new Date(Date.now() + 26 * 3_600_000) }] }]);
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  const request = async (subject: string, content: string) => {
    const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, {
      tenantId: '',
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: 'anna.beispiel@kunde.example', displayName: 'Anna Beispiel' },
      recipients: [{ address: 'info@musterwerk.example' }],
      direction: 'INBOUND',
      subject,
      content,
      threadId: randomUUID(),
      rfcMessageId: `<${randomUUID()}@kunde.example>`,
    } as NormalizedIntakeEvent);
    return result.case!.id;
  };

  it('Fenstertausch im Altbau: erkennt die Angaben, fragt gezielt Weiteres und schlägt einen Vor-Ort-Termin vor', async () => {
    const caseId = await request(
      'Neue Fenster für unser Haus',
      'Guten Tag, wir haben ein Haus aus dem Jahr 1965 und möchten im Erdgeschoss 8 alte Holzfenster gegen neue Kunststofffenster tauschen lassen. Die Fenster sind zum Teil noch einfach verglast. Bitte senden Sie uns ein Angebot. Mit freundlichen Grüßen, Anna Beispiel',
    );
    const facts = await app.get(CaseFactsService).getCurrent(tenantId, caseId);
    const nodes = (await app.get(PlanStoreService).getActive(tenantId, caseId))!.nodes;
    const reqs = nodes.find((n) => n.nodeKey === 'reqs')!;
    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirst({ where: { caseId, purpose: 'CLARIFICATION' } });
    const analysis = (await prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, type: CASE_EVENT_TYPES.REQUIREMENTS_ANALYZED } }))?.payload;

    console.log('--- ERKANNTE FAKTEN ---\n' + facts.map((f) => `${f.key} = ${JSON.stringify(f.value)} [${f.status}]`).join('\n'));
    console.log('--- ANALYSE ---\n' + JSON.stringify(analysis, null, 2));
    console.log('--- ENTWURF DER RÜCKFRAGE ---\n' + (draft?.bodyText ?? '(kein Entwurf)'));

    expect(reqs.executionMode).toBe('LIVE');
    expect((reqs.output as { analysis: unknown }).analysis).toBeTruthy();
    expect(draft?.bodyText).toBeTruthy();
    // Mehr als nur die Menge: mindestens zwei gezielte Fragen oder ein Termin; und nichts, was schon in der Anfrage steht, wird erneut gefragt.
    const numbered = (draft!.bodyText.match(/^\d+\./gm) ?? []).length;
    expect(numbered + (draft!.bodyText.includes('Termin') ? 1 : 0)).toBeGreaterThanOrEqual(2);
    expect(draft!.bodyText.toLowerCase()).not.toContain('welche menge');
    expect(sent).toHaveLength(0);
  }, 180_000);
});
