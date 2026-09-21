import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError, POLICY_ACTIONS } from '@orbit/shared';
import type { Supplier } from '@orbit/domain';
import type { FinanceConnector } from '@orbit/integration-core';
import { AuditService } from '../audit/audit.service';
import { FINANCE_CONNECTOR } from '../connectors/connectors.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';

export interface FindOrCreateSupplierInput {
  name: string;
  taxId?: string;
  vatId?: string;
  iban?: string;
  bic?: string;
  email?: string;
}

export interface FindOrCreateSupplierResult {
  supplier: Supplier;
  /** True if a brand-new Supplier row was created by this call (pending or active). */
  created: boolean;
}

/**
 * Matches an extracted/provided supplier against the tenant's existing
 * suppliers, or creates one — gated by the SUPPLIER_CREATE policy action,
 * which defaults to (and is locked at minimum) REQUIRE_APPROVAL (§17,
 * DEFAULT_POLICY_CONFIG in @orbit/shared/policy.ts): a supplier a tenant
 * never approved must never silently start receiving bank transfers.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyEnforcementService,
    @Inject(FINANCE_CONNECTOR) private readonly financeConnector: FinanceConnector,
  ) {}

  async findOrCreate(
    tenantId: string,
    actorUserId: string,
    input: FindOrCreateSupplierInput,
  ): Promise<FindOrCreateSupplierResult> {
    const existing = await this.findExisting(tenantId, input);
    if (existing) {
      return { supplier: existing, created: false };
    }

    const decision = await this.policy.decide(tenantId, POLICY_ACTIONS.SUPPLIER_CREATE);
    if (decision === 'DENY') {
      throw new PolicyViolationError('Supplier creation is disabled for this tenant.', {
        policyAction: POLICY_ACTIONS.SUPPLIER_CREATE,
      });
    }

    if (decision === 'ALLOW') {
      const externalSupplier = await this.financeConnector.createSupplier({
        name: input.name,
        taxId: input.taxId,
        vatId: input.vatId,
        iban: input.iban,
        bic: input.bic,
        email: input.email,
      });

      const supplier = await this.prisma.forTenantId(tenantId).supplier.create({
        data: {
          tenantId,
          name: input.name,
          taxId: input.taxId,
          vatId: input.vatId,
          iban: input.iban,
          bic: input.bic,
          email: input.email,
          status: 'ACTIVE',
          externalFinanceId: externalSupplier.externalId,
        },
      });

      await this.audit.record({
        tenantId,
        eventType: 'SUPPLIER_CREATED',
        actorType: 'USER',
        actorUserId,
        entityType: 'Supplier',
        entityId: supplier.id,
        payload: { name: supplier.name, status: 'ACTIVE' },
      });

      return { supplier, created: true };
    }

    // SUGGEST_ONLY / REQUIRE_APPROVAL: create a pending record; no
    // external FiBu registration yet — see approve().
    const supplier = await this.prisma.forTenantId(tenantId).supplier.create({
      data: {
        tenantId,
        name: input.name,
        taxId: input.taxId,
        vatId: input.vatId,
        iban: input.iban,
        bic: input.bic,
        email: input.email,
        status: 'PENDING_APPROVAL',
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'SUPPLIER_CREATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Supplier',
      entityId: supplier.id,
      payload: { name: supplier.name, status: 'PENDING_APPROVAL' },
    });

    return { supplier, created: true };
  }

  findAll(tenantId: string, status?: Supplier['status']): Promise<Supplier[]> {
    return this.prisma.forTenantId(tenantId).supplier.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Supplier> {
    const found = await this.prisma.forTenantId(tenantId).supplier.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Supplier not found.', { id });
    }
    return found;
  }

  async approve(tenantId: string, id: string, actorUserId: string): Promise<Supplier> {
    const supplier = await this.requirePendingSupplier(tenantId, id);

    const externalSupplier = await this.financeConnector.createSupplier({
      name: supplier.name,
      taxId: supplier.taxId ?? undefined,
      vatId: supplier.vatId ?? undefined,
      iban: supplier.iban ?? undefined,
      bic: supplier.bic ?? undefined,
      email: supplier.email ?? undefined,
    });

    const updated = await this.prisma.forTenantId(tenantId).supplier.update({
      where: { id },
      data: { status: 'ACTIVE', externalFinanceId: externalSupplier.externalId },
    });

    await this.audit.record({
      tenantId,
      eventType: 'APPROVAL_GRANTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Supplier',
      entityId: id,
      payload: { policyAction: POLICY_ACTIONS.SUPPLIER_CREATE },
    });

    return updated;
  }

  async reject(tenantId: string, id: string, actorUserId: string): Promise<Supplier> {
    await this.requirePendingSupplier(tenantId, id);

    const updated = await this.prisma.forTenantId(tenantId).supplier.update({
      where: { id },
      data: { status: 'BLOCKED' },
    });

    await this.audit.record({
      tenantId,
      eventType: 'APPROVAL_REJECTED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Supplier',
      entityId: id,
      payload: { policyAction: POLICY_ACTIONS.SUPPLIER_CREATE },
    });

    return updated;
  }

  private async requirePendingSupplier(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.findOne(tenantId, id);
    if (supplier.status !== 'PENDING_APPROVAL') {
      throw new PolicyViolationError('Supplier is not pending approval.', { id, status: supplier.status });
    }
    return supplier;
  }

  private async findExisting(tenantId: string, input: FindOrCreateSupplierInput): Promise<Supplier | null> {
    if (input.taxId) {
      const byTaxId = await this.prisma.forTenantId(tenantId).supplier.findFirst({
        where: { taxId: input.taxId },
      });
      if (byTaxId) return byTaxId;
    }
    return this.prisma.forTenantId(tenantId).supplier.findFirst({ where: { name: input.name } });
  }
}
