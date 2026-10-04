import { Injectable } from '@nestjs/common';
import type { CommunicationDraft, Prisma, Quote, ReferenceCatalogItem, ReferenceRequirementRule } from '@orbit/domain';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { hashOf } from '../canonical';
import { toCents, type PriceTier } from './money';

export const ReferenceFixtureSchema = z
  .object({
    catalog: z
      .array(
        z
          .object({
            sku: z.string().min(1).max(60),
            name: z.string().min(1).max(160),
            category: z.string().min(1).max(60),
            unit: z.string().min(1).max(20),
            unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
            currency: z.string().length(3).default('EUR'),
            taxRate: z.number().min(0).max(100),
            priceTiers: z.array(z.object({ minQuantity: z.number().positive(), unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/) }).strict()).optional(),
          })
          .strict(),
      )
      .default([]),
    requirementRules: z
      .array(
        z
          .object({
            category: z.string().min(1).max(60),
            factKey: z.string().min(1).max(120),
            valueType: z.string().min(1).max(40),
            question: z.string().min(1).max(300),
            orderIndex: z.number().int().min(0).default(0),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type ReferenceFixture = z.infer<typeof ReferenceFixtureSchema>;

export interface CatalogItemView {
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: string;
  currency: string;
  taxRate: number;
  priceTiers: PriceTier[] | null;
}

function viewOf(row: ReferenceCatalogItem): CatalogItemView {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    unitPrice: row.unitPrice.toString(),
    currency: row.currency,
    taxRate: Number(row.taxRate),
    priceTiers: (row.priceTiers as PriceTier[] | null) ?? null,
  };
}

/**
 * Data access of the reference process: the test system-of-record (catalog, requirement rules), quote numbering and
 * communication drafts. All data is tenant data loaded from fixtures or an import — nothing is embedded in code.
 */
@Injectable()
export class ReferenceProcessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: re-loading the same fixture updates prices/rules and never duplicates rows. */
  async loadFixture(tenantId: string, input: unknown): Promise<{ catalogItems: number; requirementRules: number }> {
    const fixture = ReferenceFixtureSchema.parse(input);
    const scoped = this.prisma.forTenantId(tenantId);
    for (const item of fixture.catalog) {
      const data = {
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitPrice: item.unitPrice,
        currency: item.currency,
        taxRate: item.taxRate,
        priceTiers: (item.priceTiers ?? undefined) as Prisma.InputJsonValue | undefined,
        active: true,
      };
      await scoped.referenceCatalogItem.upsert({ where: { tenantId_sku: { tenantId, sku: item.sku } }, create: { tenantId, sku: item.sku, ...data }, update: data });
    }
    for (const rule of fixture.requirementRules) {
      const data = { valueType: rule.valueType, question: rule.question, orderIndex: rule.orderIndex };
      await scoped.referenceRequirementRule.upsert({ where: { tenantId_category_factKey: { tenantId, category: rule.category, factKey: rule.factKey } }, create: { tenantId, category: rule.category, factKey: rule.factKey, ...data }, update: data });
    }
    return { catalogItems: fixture.catalog.length, requirementRules: fixture.requirementRules.length };
  }

  async catalog(tenantId: string): Promise<CatalogItemView[]> {
    const rows = await this.prisma.forTenantId(tenantId).referenceCatalogItem.findMany({ where: { active: true }, orderBy: { sku: 'asc' } });
    return rows.map(viewOf);
  }

  async findItem(tenantId: string, sku: string): Promise<CatalogItemView | undefined> {
    const row = await this.prisma.forTenantId(tenantId).referenceCatalogItem.findFirst({ where: { sku, active: true } });
    return row ? viewOf(row) : undefined;
  }

  rulesForCategory(tenantId: string, category: string): Promise<ReferenceRequirementRule[]> {
    return this.prisma.forTenantId(tenantId).referenceRequirementRule.findMany({ where: { category }, orderBy: { orderIndex: 'asc' } });
  }

  allRules(tenantId: string): Promise<ReferenceRequirementRule[]> {
    return this.prisma.forTenantId(tenantId).referenceRequirementRule.findMany({ orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }] });
  }

  /** Number assigned by a counter row locked per tenant and key — never by the model, never reused. */
  async nextNumber(tx: Prisma.TransactionClient, tenantId: string, key: string): Promise<number> {
    await tx.tenantSequence.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, nextValue: 1 }, update: {} });
    const rows = await tx.$queryRaw<Array<{ next_value: number }>>`SELECT next_value FROM tenant_sequences WHERE tenant_id = ${tenantId} AND key = ${key} FOR UPDATE`;
    const value = rows[0]?.next_value ?? 1;
    await tx.tenantSequence.update({ where: { tenantId_key: { tenantId, key } }, data: { nextValue: value + 1 } });
    return value;
  }

  // ── Drafts ──────────────────────────────────────────────────────────────────

  latestDraft(tenantId: string, caseId: string, purpose: string): Promise<CommunicationDraft | null> {
    return this.prisma.forTenantId(tenantId).communicationDraft.findFirst({ where: { caseId, purpose }, orderBy: { version: 'desc' } });
  }

  /**
   * Stores a draft as a new immutable version. An identical content hash returns the existing version (idempotent);
   * otherwise earlier DRAFT versions of the same purpose become SUPERSEDED.
   */
  async saveDraftVersion(
    tenantId: string,
    input: { caseId: string; purpose: string; toAddress: string; subject: string; bodyText: string; attachmentDocumentIds: string[]; threadId?: string; inReplyTo?: string; createdByUserId?: string },
  ): Promise<{ draft: CommunicationDraft; created: boolean }> {
    const contentHash = hashOf({ to: input.toAddress, subject: input.subject, body: input.bodyText, attachments: input.attachmentDocumentIds });
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const latest = await tx.communicationDraft.findFirst({ where: { tenantId, caseId: input.caseId, purpose: input.purpose }, orderBy: { version: 'desc' } });
      if (latest && latest.contentHash === contentHash && latest.status === 'DRAFT') return { draft: latest, created: false };
      if (latest) await tx.communicationDraft.updateMany({ where: { tenantId, caseId: input.caseId, purpose: input.purpose, status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });
      const draft = await tx.communicationDraft.create({
        data: {
          tenantId,
          caseId: input.caseId,
          purpose: input.purpose,
          version: (latest?.version ?? 0) + 1,
          parentDraftId: latest?.id,
          toAddress: input.toAddress,
          subject: input.subject,
          bodyText: input.bodyText,
          attachmentDocumentIds: input.attachmentDocumentIds,
          contentHash,
          threadId: input.threadId ?? latest?.threadId ?? undefined,
          inReplyTo: input.inReplyTo ?? latest?.inReplyTo ?? undefined,
          createdByUserId: input.createdByUserId,
        },
      });
      return { draft, created: true };
    });
  }

  quoteByNumber(tenantId: string, number: string): Promise<Quote | null> {
    return this.prisma.forTenantId(tenantId).quote.findFirst({ where: { number }, orderBy: { version: 'desc' } });
  }

  /** Cents of a stored decimal, for re-validation against the catalog. */
  static cents(value: { toString(): string }): number {
    return toCents(value.toString());
  }
}
