import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma, ProcessBlueprint, TenantProcessActivation } from '@orbit/domain';
import {
  NotFoundError,
  ValidationFailedError,
  canTransitionBlueprint,
  validateBlueprintDefinition,
  type BlueprintDefinition,
  type BlueprintStatus,
  type PlanIssue,
} from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashOf } from './canonical';
import { CapabilityRegistryService } from './capability-registry.service';

export interface BlueprintValidationView {
  valid: boolean;
  issues: PlanIssue[];
}

export interface ActiveBlueprint {
  row: ProcessBlueprint;
  definition: BlueprintDefinition;
}

/**
 * Amendment 02 §8 — Blueprint registry with lifecycle. Only DRAFT is editable;
 * every other state is immutable (the stored `definitionHash` is re-checked
 * before a version is used). A version starts production cases only when it is
 * PUBLISHED *and* activated for the tenant. Blueprints are data: importing one
 * never changes engine code.
 */
@Injectable()
export class BlueprintRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly audit: AuditService,
  ) {}

  validate(input: unknown): BlueprintValidationView & { blueprint?: BlueprintDefinition } {
    return validateBlueprintDefinition(input, this.capabilities.catalogue());
  }

  async importDraft(tenantId: string, userId: string, input: unknown): Promise<{ row: ProcessBlueprint; validation: BlueprintValidationView }> {
    const result = this.validate(input);
    if (!result.blueprint) throw new ValidationFailedError('Der Blueprint entspricht nicht dem Schema.', { issues: result.issues });
    const blueprint = result.blueprint;
    const scoped = this.prisma.forTenantId(tenantId);
    const existing = await scoped.processBlueprint.findFirst({ where: { key: blueprint.key, version: blueprint.version } });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(`Version ${blueprint.version} von ${blueprint.key} ist ${existing.status} und unveränderlich. Bitte eine neue Version anlegen.`);
    }
    const data = {
      definition: blueprint as unknown as Prisma.InputJsonValue,
      definitionHash: hashOf(blueprint),
      validation: { valid: result.valid, issues: result.issues } as unknown as Prisma.InputJsonValue,
    };
    const row = existing
      ? await scoped.processBlueprint.update({ where: { id: existing.id }, data })
      : await scoped.processBlueprint.create({ data: { tenantId, key: blueprint.key, version: blueprint.version, status: 'DRAFT', createdByUserId: userId, ...data } });
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_BLUEPRINT_IMPORTED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'ProcessBlueprint',
      entityId: row.id,
      payload: { key: row.key, version: row.version, hash: row.definitionHash, valid: result.valid },
    });
    return { row, validation: { valid: result.valid, issues: result.issues } };
  }

  async list(tenantId: string): Promise<Array<ProcessBlueprint & { active: boolean }>> {
    const scoped = this.prisma.forTenantId(tenantId);
    const [rows, activations] = await Promise.all([
      scoped.processBlueprint.findMany({ orderBy: [{ key: 'asc' }, { createdAt: 'desc' }] }),
      scoped.tenantProcessActivation.findMany({ where: { enabled: true } }),
    ]);
    return rows.map((row) => ({ ...row, active: activations.some((a) => a.blueprintKey === row.key && a.activeVersion === row.version) }));
  }

  async get(tenantId: string, key: string, version: string): Promise<ProcessBlueprint> {
    const row = await this.prisma.forTenantId(tenantId).processBlueprint.findFirst({ where: { key, version } });
    if (!row) throw new NotFoundError('Blueprint not found.', { key, version });
    return row;
  }

  async transition(tenantId: string, userId: string, key: string, version: string, to: BlueprintStatus): Promise<ProcessBlueprint> {
    const row = await this.get(tenantId, key, version);
    if (!canTransitionBlueprint(row.status, to)) throw new ConflictException(`Der Übergang ${row.status} → ${to} ist nicht erlaubt.`);

    // Re-validate on the way up, and refuse a definition that no longer matches its stored hash.
    if (to === 'VALIDATING' || to === 'TESTING' || to === 'STAGED' || to === 'PUBLISHED') {
      if (hashOf(row.definition) !== row.definitionHash) throw new ConflictException('Die gespeicherte Definition stimmt nicht mehr mit ihrem Hash überein.');
      const result = this.validate(row.definition);
      if (!result.valid) throw new ValidationFailedError('Der Blueprint ist nicht gültig und kann nicht weitergeführt werden.', { issues: result.issues });
    }

    const updated = await this.prisma.forTenantId(tenantId).processBlueprint.update({
      where: { id: row.id },
      data: { status: to, ...(to === 'PUBLISHED' && !row.publishedAt ? { publishedAt: new Date() } : {}) },
    });
    // A blueprint that leaves PUBLISHED must stop starting new cases.
    if (to === 'SUSPENDED' || to === 'DEPRECATED' || to === 'ARCHIVED') {
      await this.prisma.forTenantId(tenantId).tenantProcessActivation.updateMany({ where: { blueprintKey: key, activeVersion: version }, data: { enabled: false } });
    }
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_BLUEPRINT_TRANSITIONED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'ProcessBlueprint',
      entityId: row.id,
      payload: { key, version, from: row.status, to },
    });
    return updated;
  }

  async activate(tenantId: string, userId: string, key: string, version: string): Promise<TenantProcessActivation> {
    const row = await this.get(tenantId, key, version);
    if (row.status !== 'PUBLISHED') throw new ConflictException('Nur eine veröffentlichte Version kann aktiviert werden.');
    const scoped = this.prisma.forTenantId(tenantId);
    const activation = await scoped.tenantProcessActivation.upsert({
      where: { tenantId_blueprintKey: { tenantId, blueprintKey: key } },
      create: { tenantId, blueprintKey: key, activeVersion: version, enabled: true, activatedByUserId: userId },
      update: { activeVersion: version, enabled: true, activatedByUserId: userId, activatedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_BLUEPRINT_ACTIVATED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'ProcessBlueprint',
      entityId: row.id,
      payload: { key, version, hash: row.definitionHash },
    });
    return activation;
  }

  async deactivate(tenantId: string, userId: string, key: string): Promise<void> {
    const result = await this.prisma.forTenantId(tenantId).tenantProcessActivation.updateMany({ where: { blueprintKey: key }, data: { enabled: false } });
    if (result.count === 0) throw new NotFoundError('Blueprint is not activated.', { key });
    await this.audit.record({ tenantId, eventType: 'PROCESS_BLUEPRINT_DEACTIVATED', actorType: 'USER', actorUserId: userId, entityType: 'ProcessBlueprint', payload: { key } });
  }

  /** The tenant's active, published version of a blueprint, or null. Integrity of the definition is verified. */
  async getActive(tenantId: string, key: string): Promise<ActiveBlueprint | null> {
    const scoped = this.prisma.forTenantId(tenantId);
    const activation = await scoped.tenantProcessActivation.findFirst({ where: { blueprintKey: key, enabled: true } });
    if (!activation) return null;
    const row = await scoped.processBlueprint.findFirst({ where: { key, version: activation.activeVersion, status: 'PUBLISHED' } });
    if (!row) return null;
    if (hashOf(row.definition) !== row.definitionHash) throw new ConflictException(`Die Definition von ${key} ${row.version} wurde nach der Veröffentlichung verändert.`);
    return { row, definition: row.definition as unknown as BlueprintDefinition };
  }

  /** Active blueprint whose declared intent hints contain the intent key (first match by key order). */
  async findActiveForIntent(tenantId: string, intentKey: string): Promise<ActiveBlueprint | null> {
    const activations = await this.prisma.forTenantId(tenantId).tenantProcessActivation.findMany({ where: { enabled: true }, orderBy: { blueprintKey: 'asc' } });
    for (const activation of activations) {
      const active = await this.getActive(tenantId, activation.blueprintKey);
      if (active && active.definition.intentHints.includes(intentKey)) return active;
    }
    return null;
  }
}
