import { Injectable } from '@nestjs/common';
import type { Approval } from '@orbit/domain';
import {
  DEFAULT_POLICY_CONFIG,
  NotFoundError,
  PERMISSIONS,
  UNMAPPED_LABEL,
  approvalEntityLabel,
  internalHref,
  policyActionLabel,
  type ApprovalDecisionMode,
  type ApprovalDetail,
  type ApprovalFieldView,
  type ApprovalQueueItem,
  type EntityRef,
  type EntityType,
  type Permission,
  type PolicyActionKey,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

interface Presented {
  actionLabel: string;
  object?: EntityRef;
  subtitle?: string;
  amountText?: string;
  reason: string;
  risk: 'CRITICAL' | 'NORMAL';
  forWhom?: EntityRef;
  fields: ApprovalFieldView[];
  targetSystem: string;
  afterwards: string;
  related: EntityRef[];
  decision: { mode: ApprovalDecisionMode; approveLabel: string; rejectLabel: string; rejectNeedsReason: boolean; endpoints?: { approve: string; reject: string } };
  processAction?: { caseId: string; nodeId: string };
  stale: boolean;
  requiredPermission?: Permission;
  cannotDecideReason?: string;
}

const money = (value: unknown, currency: string): string | undefined =>
  value === null || value === undefined ? undefined : new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(value));

const day = (value: Date | null | undefined): string | undefined => (value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(value) : undefined);

function ref(type: EntityType, id: string, label: string): EntityRef {
  return { type, id, label, href: internalHref(type, id) };
}

/** Sensible Felder werden nie in Freigabe-Details gezeigt. */
const HIDDEN_INPUT_KEYS = /(password|secret|token|apikey|api_key|credential)/i;

/**
 * UI v2 §14 — reichert Freigaben für Queue und Entscheidungsdetail an: was geschieht, für wen, mit welchen Daten, in welches
 * System, warum die Freigabe nötig ist und was danach passiert. Eine reine Lese-Projektion über den Bestand; entschieden wird
 * weiterhin am jeweiligen Besitzer-Endpunkt bzw. über den Command des Vorgangs (Nutzlast-Bindung bleibt dort).
 */
@Injectable()
export class ApprovalPresenterService {
  constructor(private readonly prisma: PrismaService) {}

  async queue(tenantId: string, permissions: readonly Permission[], scope: 'MINE' | 'TEAM', limit = 100): Promise<ApprovalQueueItem[]> {
    const approvals = await this.prisma.forTenantId(tenantId).approval.findMany({
      where: scope === 'MINE' ? { status: 'PENDING' } : {},
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });
    const presented = await this.presentMany(tenantId, approvals);
    return approvals
      .map((approval) => this.toQueueItem(approval, presented.get(approval.id) as Presented, permissions))
      .filter((item) => scope === 'TEAM' || item.canDecide)
      .sort((a, b) => Number(b.risk === 'CRITICAL') - Number(a.risk === 'CRITICAL') || b.requestedAt.localeCompare(a.requestedAt));
  }

  async detail(tenantId: string, permissions: readonly Permission[], id: string): Promise<ApprovalDetail> {
    const approval = await this.prisma.forTenantId(tenantId).approval.findUnique({ where: { id } });
    if (!approval) throw new NotFoundError('Approval not found.', { id });
    const presented = (await this.presentMany(tenantId, [approval])).get(approval.id) as Presented;
    const policy = DEFAULT_POLICY_CONFIG[approval.policyAction as PolicyActionKey];
    const why =
      approval.reason ??
      (policy?.locked
        ? 'Diese Aktion verlangt immer eine menschliche Freigabe; die Regel ist fest vorgegeben.'
        : policy?.mode === 'REQUIRE_APPROVAL'
          ? 'Die geltende Regel verlangt für diese Aktion Ihre Freigabe, bevor ORBIT fortfährt.'
          : 'ORBIT hat eine Entscheidung durch einen Menschen angefordert.');
    return {
      ...this.toQueueItem(approval, presented, permissions),
      forWhom: presented.forWhom,
      fields: presented.fields,
      targetSystem: presented.targetSystem,
      whyRequired: why,
      afterwards: presented.afterwards,
      related: presented.related,
      decision: presented.decision,
      processAction: presented.processAction,
      stale: presented.stale,
      cannotDecideReason: presented.cannotDecideReason,
    };
  }

  private toQueueItem(approval: Approval, presented: Presented, permissions: readonly Permission[]): ApprovalQueueItem {
    const permitted = presented.requiredPermission ? permissions.includes(presented.requiredPermission) : false;
    return {
      id: approval.id,
      status: approval.status,
      actionLabel: presented.actionLabel,
      object: presented.object,
      subtitle: presented.subtitle,
      amountText: presented.amountText,
      reason: presented.reason,
      risk: presented.risk,
      requestedAt: approval.requestedAt.toISOString(),
      decidedAt: approval.decidedAt?.toISOString(),
      href: `/approvals/${approval.id}`,
      canDecide: approval.status === 'PENDING' && permitted && !presented.stale,
    };
  }

  private async presentMany(tenantId: string, approvals: Approval[]): Promise<Map<string, Presented>> {
    const db = this.prisma.forTenantId(tenantId);
    const ids = (type: Approval['entityType']) => approvals.filter((a) => a.entityType === type).map((a) => a.entityId);

    const invoiceIds = ids('INVOICE');
    const supplierIds = ids('SUPPLIER');
    const intentIds = ids('PROCESS_ACTION');
    const toolCallIds = ids('FOLLOW_UP');

    const [invoices, suppliers, intents, invocations] = await Promise.all([
      invoiceIds.length > 0 ? db.invoice.findMany({ where: { id: { in: invoiceIds } }, include: { supplier: true } }) : [],
      supplierIds.length > 0 ? db.supplier.findMany({ where: { id: { in: supplierIds } } }) : [],
      intentIds.length > 0 ? db.actionIntent.findMany({ where: { id: { in: intentIds } }, include: { case: { select: { id: true, title: true } } } }) : [],
      toolCallIds.length > 0 ? db.toolInvocation.findMany({ where: { toolCallId: { in: toolCallIds } }, orderBy: { createdAt: 'desc' } }) : [],
    ]);
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));
    const intentById = new Map(intents.map((row) => [row.id, row]));
    const invocationByCall = new Map<string, (typeof invocations)[number]>();
    for (const row of invocations) if (row.toolCallId && !invocationByCall.has(row.toolCallId)) invocationByCall.set(row.toolCallId, row);

    const result = new Map<string, Presented>();
    for (const approval of approvals) {
      const mapped = policyActionLabel(approval.policyAction);
      const baseLabel = mapped === UNMAPPED_LABEL ? 'Freigabe erforderlich' : mapped;
      const fallback: Presented = {
        actionLabel: baseLabel,
        reason: approval.reason ?? 'Ihre Freigabe ist erforderlich.',
        risk: 'NORMAL',
        fields: [{ label: 'Objekt', value: approvalEntityLabel(approval.entityType) }],
        targetSystem: 'ORBIT',
        afterwards: 'Nach Ihrer Entscheidung setzt ORBIT die Bearbeitung fort oder beendet sie.',
        related: [],
        decision: { mode: 'NONE', approveLabel: 'Freigeben', rejectLabel: 'Ablehnen', rejectNeedsReason: false },
        stale: false,
        cannotDecideReason: 'Für diesen Freigabetyp ist in der Oberfläche noch keine Entscheidung vorgesehen.',
      };

      if (approval.entityType === 'INVOICE') {
        const invoice = invoiceById.get(approval.entityId);
        if (invoice) {
          const bank = approval.policyAction === 'invoice.bank_change_review' || invoice.status === 'BANK_CHANGE_SUSPECTED';
          const extracted = (invoice.extractedData ?? {}) as { supplierIban?: string };
          const label = `${invoice.supplier?.name ?? 'Rechnung'}${invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ''}`;
          const fields: ApprovalFieldView[] = [
            { label: 'Lieferant', value: invoice.supplier?.name ?? 'Noch nicht zugeordnet' },
            { label: 'Rechnungsnummer', value: invoice.invoiceNumber ?? '–' },
            { label: 'Betrag (brutto)', value: money(invoice.amountGross, invoice.currency) ?? '–' },
            { label: 'Fällig am', value: day(invoice.dueDate) ?? '–' },
          ];
          if (bank) {
            fields.push({ label: 'Hinterlegte Bankverbindung', value: invoice.supplier?.iban ?? '–' }, { label: 'Bankverbindung laut Rechnung', value: extracted.supplierIban ?? '–', emphasis: true });
          }
          result.set(approval.id, {
            ...fallback,
            actionLabel: bank ? 'Neue Bankverbindung bestätigen' : baseLabel === 'Freigabe erforderlich' ? 'Rechnung freigeben' : baseLabel,
            object: ref('INVOICE', invoice.id, label),
            subtitle: invoice.supplier?.name,
            amountText: money(invoice.amountGross, invoice.currency),
            reason: bank ? 'Die Bankverbindung weicht von der hinterlegten ab – bitte vor jeder Zahlung telefonisch beim Lieferanten prüfen.' : (approval.reason ?? 'Die Rechnung wartet auf Ihre Freigabe.'),
            risk: bank ? 'CRITICAL' : 'NORMAL',
            forWhom: invoice.supplier ? ref('SUPPLIER', invoice.supplier.id, invoice.supplier.name) : undefined,
            fields,
            targetSystem: bank ? 'Lieferantenstamm in ORBIT' : 'Buchhaltung (nach Freigabe zur Übertragung bereit)',
            afterwards: bank
              ? 'Die neue Bankverbindung wird beim Lieferanten hinterlegt und die Rechnung geht in die normale Freigabe. Es wird nichts bezahlt.'
              : 'Die Rechnung gilt als freigegeben und kann zur Buchhaltung übertragen werden. Eine Zahlung löst ORBIT nicht aus.',
            related: [ref('INVOICE', invoice.id, label), ...(invoice.caseId ? [ref('CASE', invoice.caseId, 'Zugehöriger Vorgang')] : [])],
            decision: {
              mode: 'ENTITY',
              approveLabel: bank ? 'Neue Bankverbindung bestätigen' : 'Genehmigen',
              rejectLabel: 'Ablehnen',
              rejectNeedsReason: true,
              endpoints: { approve: `/v1/invoices/${invoice.id}/${bank ? 'confirm-bank-change' : 'approve'}`, reject: `/v1/invoices/${invoice.id}/reject` },
            },
            requiredPermission: PERMISSIONS.INVOICE_APPROVE,
            cannotDecideReason: undefined,
          });
          continue;
        }
      }

      if (approval.entityType === 'SUPPLIER') {
        const supplier = supplierById.get(approval.entityId);
        if (supplier) {
          result.set(approval.id, {
            ...fallback,
            actionLabel: 'Neuen Lieferanten anlegen',
            object: ref('SUPPLIER', supplier.id, supplier.name),
            subtitle: supplier.email ?? undefined,
            reason: approval.reason ?? 'Ein neuer Lieferant wartet auf Ihre Freigabe, bevor Rechnungen zugeordnet werden.',
            fields: [
              { label: 'Name', value: supplier.name },
              { label: 'E-Mail', value: supplier.email ?? '–' },
              { label: 'Bankverbindung', value: supplier.iban ?? '–' },
              { label: 'USt-IdNr.', value: supplier.vatId ?? '–' },
            ],
            targetSystem: 'Lieferantenstamm in ORBIT',
            afterwards: 'Der Lieferant wird aktiv und kann Rechnungen zugeordnet bekommen.',
            related: [ref('SUPPLIER', supplier.id, supplier.name)],
            decision: {
              mode: 'ENTITY',
              approveLabel: 'Genehmigen',
              rejectLabel: 'Ablehnen',
              rejectNeedsReason: true,
              endpoints: { approve: `/v1/suppliers/${supplier.id}/approve`, reject: `/v1/suppliers/${supplier.id}/reject` },
            },
            requiredPermission: PERMISSIONS.SUPPLIER_MANAGE,
            cannotDecideReason: undefined,
          });
          continue;
        }
      }

      if (approval.entityType === 'FOLLOW_UP') {
        const invocation = invocationByCall.get(approval.entityId);
        const input = ((invocation?.input ?? {}) as Record<string, unknown>) ?? {};
        const isMail = typeof input.toAddress === 'string' || typeof input.subject === 'string';
        const fields: ApprovalFieldView[] = isMail
          ? [
              { label: 'Empfänger', value: String(input.toAddress ?? input.to ?? '–'), emphasis: true },
              { label: 'Betreff', value: String(input.subject ?? '–') },
              { label: 'Text', value: String(input.bodyText ?? input.body ?? '–') },
            ]
          : Object.entries(input)
              .filter(([key]) => !HIDDEN_INPUT_KEYS.test(key))
              .slice(0, 8)
              .map(([key, value]) => ({ label: key.replace(/[_-]+/g, ' '), value: typeof value === 'string' ? value : JSON.stringify(value) }));
        result.set(approval.id, {
          ...fallback,
          actionLabel: policyActionLabel(invocation?.toolName ?? approval.policyAction) === UNMAPPED_LABEL ? 'Vorgeschlagene Aktion ausführen' : policyActionLabel(invocation?.toolName ?? approval.policyAction),
          reason: approval.reason ?? 'ORBIT oder Sonde hat eine Aktion vorgeschlagen, die nur mit Ihrer Freigabe ausgeführt wird.',
          fields: fields.length > 0 ? fields : fallback.fields,
          targetSystem: isMail ? 'E-Mail (Postfach der Firma)' : 'ORBIT',
          afterwards: isMail ? 'Die Nachricht wird genau so versendet, wie sie hier steht.' : 'Die vorgeschlagene Aktion wird genau mit diesen Angaben ausgeführt.',
          decision: {
            mode: 'FOLLOW_UP',
            approveLabel: 'Genehmigen & ausführen',
            rejectLabel: 'Ablehnen',
            rejectNeedsReason: false,
            endpoints: { approve: `/v1/follow-ups/${approval.id}/approve`, reject: `/v1/follow-ups/${approval.id}/reject` },
          },
          requiredPermission: PERMISSIONS.APPROVAL_DECIDE,
          cannotDecideReason: invocation ? undefined : 'Die ursprüngliche Anfrage ist nicht mehr vorhanden und kann nicht ausgeführt werden.',
          stale: !invocation && approval.status === 'PENDING',
        });
        continue;
      }

      if (approval.entityType === 'PROCESS_ACTION') {
        const intent = intentById.get(approval.entityId);
        if (intent) {
          const mailPurpose = intent.capabilityKey.startsWith('email.send');
          const stale = approval.status === 'PENDING' && intent.status !== 'AWAITING_APPROVAL';
          result.set(approval.id, {
            ...fallback,
            actionLabel: policyActionLabel(intent.capabilityKey) === UNMAPPED_LABEL ? 'Vorbereitete Aktion ausführen' : policyActionLabel(intent.capabilityKey),
            object: ref('CASE', intent.case.id, intent.case.title),
            subtitle: intent.case.title,
            reason: approval.reason ?? 'Ein vorbereiteter Schritt wartet auf Ihre Freigabe.',
            fields: [{ label: 'Vorgang', value: intent.case.title }, { label: 'Bindung', value: 'Die Freigabe gilt nur für genau die unten gezeigte Fassung.' }],
            targetSystem: mailPurpose ? 'E-Mail an den Kunden' : 'Externes System laut Prozess',
            afterwards: mailPurpose ? 'Die Nachricht wird versandt. „Genehmigt“ und „Versandt“ sind getrennte Zustände – der Versandnachweis erscheint im Vorgang.' : 'Der Schritt wird ausgeführt; den Nachweis sehen Sie im Vorgang.',
            related: [ref('CASE', intent.case.id, intent.case.title)],
            decision: { mode: 'PROCESS_ACTION', approveLabel: 'Genehmigen & ausführen', rejectLabel: 'Ablehnen', rejectNeedsReason: true },
            processAction: { caseId: intent.caseId, nodeId: intent.nodeKey },
            stale,
            requiredPermission: PERMISSIONS.APPROVAL_DECIDE,
            cannotDecideReason: stale ? 'Diese Freigabe wurde durch eine Änderung ersetzt. Bitte die aktuelle Version prüfen.' : undefined,
          });
          continue;
        }
      }

      result.set(approval.id, fallback);
    }
    return result;
  }
}
