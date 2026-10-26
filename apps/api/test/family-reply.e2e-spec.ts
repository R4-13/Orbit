import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PlanProposal } from '@orbit/shared';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseEventsService } from '../src/process/case-events.service';
import { FamilyReplyService } from '../src/process/family-reply.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { PlannerService } from '../src/process/planner.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { clarificationBody, informationBody } from '../src/process/reference/communication-templates';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const TOM = 'tom@kunde.example';

/**
 * Meilenstein C (K3/K4/K5): die gemeinsame Antwort einer aufgeteilten Nachricht. Hauptvorgang und Teilvorgänge liegen direkt in der Datenbank (kein Modell nötig); der Versand ist ein Aufzeichnungs-Double.
 * Bewiesen wird: eine Nachricht je Runde statt einer je Teilvorgang, genau eine Eingangsbestätigung, wahre Stand-Sätze, Unabhängigkeit blockierter Anliegen, Freigabe nach der Regel, kein Doppelversand.
 */
describe('Gemeinsame Antwort einer aufgeteilten Nachricht (Meilenstein C, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let family: FamilyReplyService;
  let reference: ReferenceProcessService;
  let orchestrator: OrchestratorService;
  let sent: OutboundMessage[] = [];
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];

  async function newTenant(ackMode: 'AUTONOMOUS' | 'REQUIRE_APPROVAL' = 'AUTONOMOUS'): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Familie ${suffix.slice(0, 8)}`, slug: `e2e-fam-${suffix}`, adminEmail: `admin-${suffix}@e2e-fam.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action: 'email.send.acknowledgement' } }, create: { tenantId: tenant.id, action: 'email.send.acknowledgement', mode: ackMode }, update: { mode: ackMode } });
    return tenant.id;
  }

  /** Hauptvorgang mit der Nachricht der Kundschaft und einem Teilvorgang je Anliegen (Status: wartend). */
  async function newFamily(tenantId: string, goals: string[]): Promise<{ parentId: string; childIds: string[] }> {
    const scoped = prisma.forTenantId(tenantId);
    const parent = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Mehrere Anliegen: Drei Dinge', orchestrationStatus: 'IN_PROGRESS', status: 'IN_PROGRESS' } });
    await scoped.emailMessage.create({ data: { tenantId, caseId: parent.id, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Drei Dinge', bodyText: 'Guten Tag, drei Dinge …', threadId: 'thr-1', rfcMessageId: `<m-${parent.id}@kunde.example>`, receivedAt: new Date() } });
    const childIds: string[] = [];
    for (const goal of goals) {
      const child = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: `${goal}: Drei Dinge`, parentCaseId: parent.id, orchestrationStatus: 'WAITING_FOR_INFORMATION', status: 'IN_PROGRESS' } });
      await app.get(CaseEventsService).append(tenantId, child.id, { type: 'case.split_from', payload: { parentCaseId: parent.id, goal, siblings: goals.filter((g) => g !== goal) } });
      childIds.push(child.id);
    }
    return { parentId: parent.id, childIds };
  }

  async function hold(tenantId: string, caseId: string, purpose: string, bodyText: string) {
    const { draft } = await reference.saveDraftVersion(tenantId, { caseId, purpose, toAddress: TOM, subject: 'Re: Drei Dinge', bodyText, attachmentDocumentIds: [] });
    return family.hold(tenantId, caseId, draft);
  }

  const questions = (...q: string[]) => clarificationBody({ originalSubject: 'Drei Dinge', questions: q.map((question, i) => ({ key: `k${i}`, question })), companyName: 'Betrieb', intent: 'HANDOFF', previousRounds: 0 });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    family = app.get(FamilyReplyService);
    reference = app.get(ReferenceProcessService);
    orchestrator = app.get(OrchestratorService);
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenant, message) => {
        sent.push(message);
        return { providerMessageId: `gm-${sent.length}-${randomUUID().slice(0, 6)}`, threadId: message.threadId ?? 'thr-1', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
    );
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('Entwürfe der Teilvorgänge gehen nicht einzeln hinaus: eine gemeinsame Antwort mit einem Abschnitt je Anliegen und genau einer Eingangsbestätigung', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Kopie der letzten Rechnung', 'Angebot für einen Heizungsregler']);
    const a = await hold(tenantId, childIds[0]!, 'CLARIFICATION', questions('Welche Rechnung brauchen Sie (Nummer oder Monat)?'));
    const b = await hold(tenantId, childIds[1]!, 'CLARIFICATION', questions('Welchen Hersteller und welches Modell hat Ihr Regler?', 'Welche Heizungsanlage ist vorhanden?'));
    const ack = await hold(tenantId, childIds[1]!, 'ACKNOWLEDGEMENT', 'Guten Tag,\n\nvielen Dank für Ihre Nachricht. Sie ist bei uns eingegangen.\n\nMit freundlichen Grüßen\nBetrieb');
    expect(a?.parentCaseId).toBe(parentId);
    expect(b?.providerRef).toContain(parentId);
    expect(ack).toBeDefined();
    expect(sent).toHaveLength(0); // die Teilvorgänge senden nichts selbst

    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe(TOM);
    expect(mail.bodyText.match(/Guten Tag/g)).toHaveLength(1);
    expect(mail.bodyText.match(/Mit freundlichen Grüßen/g)).toHaveLength(1);
    expect(mail.bodyText.match(/eingegangen/g)).toHaveLength(1); // die einzige Eingangsbestätigung
    expect(mail.bodyText.indexOf('Kopie der letzten Rechnung')).toBeLessThan(mail.bodyText.indexOf('Angebot für einen Heizungsregler'));
    // Jede Rückfrage steht im Abschnitt ihres Anliegens.
    const regler = mail.bodyText.slice(mail.bodyText.indexOf('Angebot für einen Heizungsregler'));
    expect(regler).toContain('Welchen Hersteller und welches Modell hat Ihr Regler?');
    expect(mail.bodyText.slice(0, mail.bodyText.indexOf('Angebot für einen Heizungsregler'))).not.toContain('Regler?');

    // Eine Runde, eine Nachricht: ein zweiter Aufruf sendet nichts mehr.
    expect(await family.settle(tenantId, parentId)).toBe('NOTHING');
    expect(sent).toHaveLength(1);
    expect(await prisma.forTenantId(tenantId).actionIntent.count({ where: { caseId: parentId, status: 'CONFIRMED', capabilityKey: 'email.send' } })).toBe(1);
  });

  it('ein noch arbeitender Teilvorgang hält die Antwort kurz zurück; ein übergebenes Anliegen steht mit dem wahren Stand darin, ein blockiertes hält die anderen nicht auf', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Rechnung 4711 klären', 'Termin für die Wartung', 'Frage nach Frechen']);
    await hold(tenantId, childIds[2]!, 'INFORMATION', informationBody({ answer: 'Ja, wir kommen auch nach Frechen.', companyName: 'Betrieb' }));
    const scoped = prisma.forTenantId(tenantId);
    await scoped.case.update({ where: { id: childIds[1]! }, data: { orchestrationStatus: 'IN_PROGRESS' } }); // arbeitet noch
    expect(await family.settle(tenantId, parentId)).toBe('BUSY');
    expect(sent).toHaveLength(0);

    // Der Teilvorgang übergibt an eine Person (Aufgabe offen), der andere ist ebenfalls übergeben.
    for (const id of [childIds[0]!, childIds[1]!]) {
      await scoped.task.create({ data: { tenantId, caseId: id, title: 'Anliegen übernehmen', description: 'x', source: 'AGENT' } });
      await scoped.case.update({ where: { id }, data: { orchestrationStatus: 'MANUAL_REVIEW' } });
    }
    await scoped.case.update({ where: { id: childIds[2]! }, data: { orchestrationStatus: 'COMPLETED' } });
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(1);
    const body = sent[0]!.bodyText;
    expect(body).toContain('Ja, wir kommen auch nach Frechen.');
    expect((body.match(/Dieses Anliegen können wir nicht automatisch erledigen/g) ?? []).length).toBe(2); // beide Übergaben benannt
    expect(body).not.toMatch(/Dieses Anliegen ist erledigt/); // eine Übergabe ist nie „erledigt“
    // Der Stand wurde mitgeteilt; ohne Neues folgt keine weitere Nachricht.
    expect(await family.settle(tenantId, parentId)).toBe('NOTHING');
    expect(sent).toHaveLength(1);
  });

  it('eine Auskunft, die noch auf ihre Freigabe wartet, fehlt zunächst (Stand: wird geprüft) und geht nach der Freigabe gesondert hinaus – ohne zweite Eingangsbestätigung', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Rechnung 4711 klären', 'Frage nach Frechen']);
    const scoped = prisma.forTenantId(tenantId);
    await scoped.task.create({ data: { tenantId, caseId: childIds[0]!, title: 'Rechnung prüfen', description: 'x', source: 'AGENT' } });
    await scoped.case.update({ where: { id: childIds[0]! }, data: { orchestrationStatus: 'MANUAL_REVIEW' } });
    await scoped.case.update({ where: { id: childIds[1]! }, data: { orchestrationStatus: 'WAITING_FOR_APPROVAL' } });

    // Wer gerade erst auf eine Freigabe wartet, hält die Antwort kurz zurück (meist kommt die Freigabe in Minuten) …
    expect(await family.settle(tenantId, parentId)).toBe('BUSY');
    // … nach der Karenzzeit geht der Stand hinaus.
    await prisma.withRlsBypass((tx) => tx.$executeRaw`UPDATE cases SET updated_at = now() - interval '2 hours' WHERE id = ${childIds[1]!}`);
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Dieses Anliegen prüfen wir noch intern');
    expect(sent[0]!.bodyText).toContain('eingegangen');

    // Die Freigabe ist erteilt, der Teilvorgang hält seine Auskunft bereit.
    await scoped.case.update({ where: { id: childIds[1]! }, data: { orchestrationStatus: 'COMPLETED' } });
    await hold(tenantId, childIds[1]!, 'INFORMATION', informationBody({ answer: 'Ja, wir kommen auch nach Frechen.', companyName: 'Betrieb' }));
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.bodyText).toContain('Ja, wir kommen auch nach Frechen.');
    expect(sent[1]!.bodyText).not.toContain('eingegangen'); // der Eingang wurde schon bestätigt
    expect(sent[1]!.bodyText).not.toContain('Rechnung 4711'); // der Stand dieses Anliegens ist unverändert und wird nicht wiederholt
  });

  it('verlangt die Regel für Eingangsbestätigungen eine Freigabe, wartet die gemeinsame Antwort darauf – nach der Freigabe geht sie genau einmal hinaus, nach der Ablehnung nie', async () => {
    const tenantId = await newTenant('REQUIRE_APPROVAL');
    const user = await prisma.withRlsBypass((tx) => tx.user.findFirstOrThrow({ where: { tenantId } }));
    const one = await newFamily(tenantId, ['Rechnung 4711 klären', 'Frage nach Frechen']);
    await hold(tenantId, one.childIds[0]!, 'CLARIFICATION', questions('Welche Rechnung?'));
    expect(await family.settle(tenantId, one.parentId)).toBe('AWAITING_APPROVAL');
    expect(sent).toHaveLength(0);
    expect(await family.settle(tenantId, one.parentId)).toBe('NOTHING'); // nicht noch einmal zur Freigabe vorgelegt
    const intent = await prisma.forTenantId(tenantId).actionIntent.findFirstOrThrow({ where: { caseId: one.parentId, status: 'AWAITING_APPROVAL' } });
    expect(await orchestrator.decideAction(tenantId, user.id, intent.id, 'APPROVED')).toEqual({ applied: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(TOM);
    expect((await prisma.forTenantId(tenantId).actionIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe('CONFIRMED');

    const two = await newFamily(tenantId, ['Rechnung 4711 klären', 'Frage nach Frechen']);
    await hold(tenantId, two.childIds[0]!, 'CLARIFICATION', questions('Welche Rechnung?'));
    expect(await family.settle(tenantId, two.parentId)).toBe('AWAITING_APPROVAL');
    const rejected = await prisma.forTenantId(tenantId).actionIntent.findFirstOrThrow({ where: { caseId: two.parentId, status: 'AWAITING_APPROVAL' } });
    await orchestrator.decideAction(tenantId, user.id, rejected.id, 'REJECTED', 'nicht senden');
    expect(sent).toHaveLength(1);
    expect(await family.settle(tenantId, two.parentId)).toBe('NOTHING');
  });

  it('eine gemeinsame Antwort der Kundschaft: jede Aufgabe erhält nur die Sätze, die zu ihrem Anliegen gehören (im Wortlaut), nicht zweimal für dieselbe Nachricht', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Kopie der letzten Rechnung für die Steuer erhalten', 'Wartungstermin vom 28.10. auf den 4.11. verschieben']);
    const scoped = prisma.forTenantId(tenantId);
    for (const id of childIds) {
      await scoped.task.create({ data: { tenantId, caseId: id, title: 'Anliegen übernehmen', description: 'Start.', source: 'AGENT' } });
      await scoped.case.update({ where: { id }, data: { orchestrationStatus: 'MANUAL_REVIEW' } });
    }
    const reply = await scoped.emailMessage.create({ data: { tenantId, caseId: parentId, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Re: Drei Dinge', bodyText: 'Zur Rechnung: es ist die vom September. Zum Termin: der Wartungstermin war bei Herrn Weber.\n\n[Simulation] Testwerkzeug', threadId: 'thr-1', rfcMessageId: '<antwort@kunde.example>', receivedAt: new Date() } });
    const open = childIds.map((id, i) => ({ id, title: i === 0 ? 'Rechnung' : 'Termin', waitingForReply: false }));
    const routed = await family.routeReply(tenantId, parentId, reply.id, open);
    expect([...routed.assignedChildIds].sort()).toEqual([...childIds].sort());
    await family.routeReply(tenantId, parentId, reply.id, open); // Wiederholung: keine zweite Ergänzung
    const tasks = await Promise.all(childIds.map((id) => scoped.task.findFirstOrThrow({ where: { caseId: id } })));
    expect(tasks[0]!.description).toContain('es ist die vom September');
    expect(tasks[0]!.description).not.toContain('Herrn Weber');
    expect(tasks[1]!.description).toContain('Herrn Weber');
    expect(tasks[1]!.description).not.toContain('September');
    expect(tasks[1]!.description!.match(/Antwort der Kundschaft/g)).toHaveLength(1);
    // Die gemeinsame Antwort nennt zu jedem Anliegen, dessen Angaben bei der zuständigen Person liegen, genau das – und nichts als „erledigt“.
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText.match(/Ihre Angaben dazu haben wir an die zuständige Person weitergegeben/g)).toHaveLength(2);
    expect(sent[0]!.bodyText).not.toMatch(/Dieses Anliegen ist erledigt/);
  });

  /** Familie mit einer gesendeten Rückfrage an den dritten Teilvorgang; die ersten beiden sind übergeben. */
  async function familyWithOpenQuestion(tenantId: string, ask: string[]): Promise<{ parentId: string; childIds: string[]; open: Array<{ id: string; title: string; waitingForReply: boolean }> }> {
    const { parentId, childIds } = await newFamily(tenantId, ['Kopie der letzten Rechnung für die Steuer erhalten', 'Wartungstermin vom 28.10. auf den 4.11. verschieben', 'Angebot für einen neuen Heizungsregler erhalten']);
    const scoped = prisma.forTenantId(tenantId);
    for (const id of childIds.slice(0, 2)) {
      await scoped.task.create({ data: { tenantId, caseId: id, title: 'Anliegen übernehmen', description: 'Start.', source: 'AGENT' } });
      await scoped.case.update({ where: { id }, data: { orchestrationStatus: 'MANUAL_REVIEW' } });
    }
    await hold(tenantId, childIds[2]!, 'CLARIFICATION', questions(...ask));
    expect(await family.settle(tenantId, parentId)).toBe('SENT'); // die Rückfrage ist hinausgegangen
    return { parentId, childIds, open: childIds.map((id, i) => ({ id, title: ['Rechnung', 'Termin', 'Angebot'][i]!, waitingForReply: i === 2 })) };
  }

  const inbound = (tenantId: string, parentId: string, text: string) =>
    prisma.forTenantId(tenantId).emailMessage.create({
      data: { tenantId, caseId: parentId, direction: 'INBOUND', fromAddress: TOM, toAddresses: ['info@betrieb.example'], subject: 'Re: Drei Dinge', bodyText: text, threadId: 'thr-1', rfcMessageId: `<antwort-${randomUUID()}@kunde.example>`, receivedAt: new Date() },
    });

  it('eine Kurzantwort ohne Anliegenüberschrift („Bitte beides.“) gehört zur einzigen offenen Rückfrage: nur dieser Teilvorgang erhält sie, im Wortlaut', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds, open } = await familyWithOpenQuestion(tenantId, ['Geht es nur um die Lieferung des Reglers oder auch um dessen Einbau?']);
    const reply = await inbound(tenantId, parentId, 'Bitte beides.\n\n[Simulation] Testwerkzeug');
    const routed = await family.routeReply(tenantId, parentId, reply.id, open);
    expect([...routed.assignedChildIds]).toEqual([childIds[2]]);
    expect(routed.askedBack).toBe(0);
    const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: childIds[2]!, type: 'family.reply_assigned' } });
    expect(event.payload).toMatchObject({ messageId: reply.id, sentences: ['Bitte beides.'], basis: ['ONLY_OPEN_QUESTION'] });
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: { in: [childIds[0]!, childIds[1]!] }, type: 'family.reply_assigned' } })).toBe(0);
  });

  it('eine Antwort, die zu mehreren offenen Rückfragen passen könnte, wird nicht geraten: die Kundschaft wird gezielt zurückgefragt (in der nächsten gemeinsamen Antwort), nichts bleibt nur am Hauptvorgang', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Angebot für einen neuen Heizungsregler erhalten', 'Wartung der Heizungsanlage planen']);
    await hold(tenantId, childIds[0]!, 'CLARIFICATION', questions('Geht es nur um die Lieferung des Reglers oder auch um dessen Einbau?'));
    await hold(tenantId, childIds[1]!, 'CLARIFICATION', questions('Soll die Wartung vormittags oder nachmittags stattfinden?'));
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    const open = childIds.map((id, i) => ({ id, title: ['Angebot', 'Wartung'][i]!, waitingForReply: true }));
    const reply = await inbound(tenantId, parentId, 'Ja, bitte.');
    const routed = await family.routeReply(tenantId, parentId, reply.id, open);
    expect(routed.assignedChildIds.size).toBe(0);
    expect(routed.askedBack).toBe(1);
    await family.routeReply(tenantId, parentId, reply.id, open); // dieselbe Nachricht: keine zweite Rückfrage
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: parentId, type: 'family.assignment_question' } })).toBe(1);
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    const mail = sent[sent.length - 1]!.bodyText;
    expect(mail).toContain('Ihre Antwort „Ja, bitte.“ können wir nicht eindeutig zuordnen');
    expect(mail).toContain('Zu „Angebot“: Geht es nur um die Lieferung');
    expect(mail).toContain('Lieferung des Reglers oder auch um dessen Einbau');
    expect(mail).toContain('vormittags oder nachmittags');
    expect(mail).not.toContain('eingegangen'); // keine zweite Eingangsbestätigung
    expect(await family.settle(tenantId, parentId)).toBe('NOTHING'); // die Rückfrage geht genau einmal hinaus
    // Die klärende Antwort nennt den Gegenstand und wird zugeordnet.
    const clarified = await inbound(tenantId, parentId, 'Das gehört zum Einbau des Reglers: ja, mit Einbau.');
    const second = await family.routeReply(tenantId, parentId, clarified.id, open);
    expect([...second.assignedChildIds]).toEqual([childIds[0]]);
  });

  it('die Wartezeit auf die Freigabe eines Anliegens ist begrenzt: bereits Ausführbares geht ohne weiteres Ereignis über den Sweep hinaus; die später freigegebene Auskunft folgt als Ergänzung, ohne Bereits-Gesendetes zu wiederholen', async () => {
    const tenantId = await newTenant();
    const { parentId, childIds } = await newFamily(tenantId, ['Rechnung 4711 klären', 'Termin für die Wartung', 'Frage nach Frechen']);
    const scoped = prisma.forTenantId(tenantId);
    await hold(tenantId, childIds[0]!, 'CLARIFICATION', questions('Welche Rechnung brauchen Sie (Nummer oder Monat)?'));
    await hold(tenantId, childIds[0]!, 'ACKNOWLEDGEMENT', 'Guten Tag,\n\nvielen Dank für Ihre Nachricht. Sie ist bei uns eingegangen.\n\nMit freundlichen Grüßen\nBetrieb');
    await scoped.case.update({ where: { id: childIds[2]! }, data: { orchestrationStatus: 'WAITING_FOR_APPROVAL' } }); // die Auskunft wartet auf ihre Freigabe
    expect(await family.settle(tenantId, parentId)).toBe('BUSY'); // kurz zurückgehalten …
    expect(sent).toHaveLength(0);
    // … aber nicht unbegrenzt: nach der Karenzzeit setzt der Sweep die Antwort zusammen (kein neues Ereignis nötig).
    await prisma.withRlsBypass((tx) => tx.$executeRaw`UPDATE cases SET updated_at = now() - interval '2 hours' WHERE id = ${childIds[2]!}`);
    const parents = (await family.activeParents()).filter((p) => p.tenantId === tenantId);
    expect(parents.map((p) => p.parentCaseId)).toEqual([parentId]);
    for (const p of parents) await family.settle(p.tenantId, p.parentCaseId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Welche Rechnung brauchen Sie');
    expect(sent[0]!.bodyText).toContain('Dieses Anliegen prüfen wir noch intern'); // die Auskunft: wird geprüft
    expect(sent[0]!.bodyText.match(/eingegangen/g)).toHaveLength(1);
    // Die Auskunft wird freigegeben: sie folgt gesondert, ohne die Rückfrage oder die Eingangsbestätigung zu wiederholen.
    await scoped.case.update({ where: { id: childIds[2]! }, data: { orchestrationStatus: 'COMPLETED' } });
    await hold(tenantId, childIds[2]!, 'INFORMATION', informationBody({ answer: 'Ja, wir kommen auch nach Frechen.', companyName: 'Betrieb' }));
    expect(await family.settle(tenantId, parentId)).toBe('SENT');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.bodyText).toContain('Ja, wir kommen auch nach Frechen.');
    expect(sent[1]!.bodyText).not.toContain('eingegangen');
    expect(sent[1]!.bodyText).not.toContain('Welche Rechnung brauchen Sie');
    expect(await family.settle(tenantId, parentId)).toBe('NOTHING');
  });

  it('Entwürfe außerhalb einer aufgeteilten Nachricht oder mit Anhang werden nicht bereitgehalten (sie gehen wie bisher selbst hinaus)', async () => {
    const tenantId = await newTenant();
    const single = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title: 'Einzelvorgang' } });
    expect(await hold(tenantId, single.id, 'CLARIFICATION', questions('Eine Frage?'))).toBeUndefined();
    const { childIds } = await newFamily(tenantId, ['A Anliegen', 'B Anliegen']);
    const { draft } = await reference.saveDraftVersion(tenantId, { caseId: childIds[0]!, purpose: 'QUOTE_DELIVERY', toAddress: TOM, subject: 'Angebot', bodyText: 'Angebot im Anhang', attachmentDocumentIds: ['doc-1'] });
    expect(await family.hold(tenantId, childIds[0]!, draft)).toBeUndefined();
  });

  it('FN-09: ein überholter Planungsversuch legt keine Aufgabe „Planung nicht möglich“ an und setzt den Vorgang nicht auf Prüfung', async () => {
    const tenantId = await newTenant();
    const scoped = prisma.forTenantId(tenantId);
    const parent = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Mehrere Anliegen: x' } });
    const child = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Teil: x', parentCaseId: parent.id } });
    const plan = (id: string): PlanProposal => ({
      goalKeys: ['human.review'],
      nodes: [{ id: 'w', type: 'WAIT_EVENT', title: 'Warten', inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: { eventType: 'communication.received' }, timeout: { hours: 72 }, evidenceRefs: [] } as never],
      edges: [],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: id,
    });
    const first = await orchestrator.startProcedure(tenantId, child.id, plan('erste'));
    expect(first.outcome).toBe('RUNNING');
    const store = app.get(PlanStoreService);
    // Die Neuplanung läuft; währenddessen wird ein anderer Plan aktiv, und die Neuplanung selbst scheitert.
    const planner = app.get(PlannerService);
    const spy = jest.spyOn(planner, 'plan').mockImplementation(async () => {
      const other = await store.createRevision(tenantId, child.id, { proposal: plan('zweite'), source: 'LLM_PLANNER', status: 'VALIDATED', basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null } });
      await store.activate(tenantId, other.plan.id);
      return { status: 'REVIEW_REQUIRED', reason: 'Der Plan besteht die deterministische Prüfung nicht.' } as never;
    });
    try {
      const result = await orchestrator.replan(tenantId, child.id, undefined);
      expect(result.outcome).toBe('RUNNING');
    } finally {
      spy.mockRestore();
    }
    expect(await scoped.task.count({ where: { caseId: child.id } })).toBe(0);
    expect((await scoped.case.findUniqueOrThrow({ where: { id: child.id } })).orchestrationStatus).not.toBe('MANUAL_REVIEW');
  });

  it('ein neuer Vorschlag, der auf Freigabe wartet, löst den älteren unfreigegebenen Vorschlag desselben Vorgangs ab (es steht nur ein Plan zur Freigabe)', async () => {
    const tenantId = await newTenant();
    const scoped = prisma.forTenantId(tenantId);
    const child = await scoped.case.create({ data: { tenantId, type: 'GENERAL', title: 'Teil: y' } });
    const store = app.get(PlanStoreService);
    const proposal = (id: string): PlanProposal => ({
      goalKeys: ['human.review'],
      nodes: [{ id: 'w', type: 'WAIT_EVENT', title: 'Warten', inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: { eventType: 'communication.received' }, timeout: { hours: 1 }, evidenceRefs: [] } as never],
      edges: [],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: id,
    });
    const input = (id: string) => ({ proposal: proposal(id), source: 'LLM_PLANNER' as const, status: 'AWAITING_APPROVAL' as const, basedOnCaseRevision: 0, validation: { valid: true, issues: [], stats: null } });
    const first = await store.createRevision(tenantId, child.id, input('erster'));
    const second = await store.createRevision(tenantId, child.id, input('zweiter'));
    const plans = await scoped.processPlan.findMany({ where: { caseId: child.id }, orderBy: { revision: 'asc' } });
    expect(plans.map((p) => [p.id, p.status])).toEqual([[first.plan.id, 'SUPERSEDED'], [second.plan.id, 'AWAITING_APPROVAL']]);
  });
});
