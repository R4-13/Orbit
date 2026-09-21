import { Prisma } from '@prisma/client';
import { isOrbitError } from '@orbit/shared';
import { describe, expect, it } from 'vitest';
import { applyTenantScope, isTenantScopedModel, TENANT_SCOPED_MODELS } from './tenant-scope';

const TENANT_ID = 'tenant_1';
const OTHER_TENANT_ID = 'tenant_2';

describe('TENANT_SCOPED_MODELS', () => {
  it('covers every Prisma model except the Tenant root itself', () => {
    const allModels = new Set(Object.values(Prisma.ModelName));
    allModels.delete('Tenant');

    expect(new Set(TENANT_SCOPED_MODELS)).toEqual(allModels);
  });

  it('isTenantScopedModel() rejects the Tenant model and unknown names', () => {
    expect(isTenantScopedModel('Tenant')).toBe(false);
    expect(isTenantScopedModel('NotAModel')).toBe(false);
    expect(isTenantScopedModel('Invoice')).toBe(true);
  });
});

describe('applyTenantScope', () => {
  it('injects tenantId into a findMany where clause with no prior filter', () => {
    const result = applyTenantScope('findMany', { where: { status: 'OPEN' } }, TENANT_ID);
    expect(result.where).toEqual({ status: 'OPEN', tenantId: TENANT_ID });
  });

  it('injects tenantId into findUnique/findFirst/count/update/delete alike', () => {
    for (const operation of ['findUnique', 'findFirst', 'count', 'update', 'delete']) {
      const result = applyTenantScope(operation, { where: { id: 'x' } }, TENANT_ID);
      expect(result.where).toEqual({ id: 'x', tenantId: TENANT_ID });
    }
  });

  it('stamps create() data with tenantId', () => {
    const result = applyTenantScope('create', { data: { title: 'Neue Rechnung' } }, TENANT_ID);
    expect(result.data).toEqual({ title: 'Neue Rechnung', tenantId: TENANT_ID });
  });

  it('stamps every row of createMany() data with tenantId', () => {
    const result = applyTenantScope(
      'createMany',
      { data: [{ title: 'A' }, { title: 'B' }] },
      TENANT_ID,
    );
    expect(result.data).toEqual([
      { title: 'A', tenantId: TENANT_ID },
      { title: 'B', tenantId: TENANT_ID },
    ]);
  });

  it('scopes both where and create/update branches of upsert()', () => {
    const result = applyTenantScope(
      'upsert',
      {
        where: { id: 'x' },
        create: { title: 'A' },
        update: { title: 'B' },
      },
      TENANT_ID,
    );
    expect(result.where).toEqual({ id: 'x', tenantId: TENANT_ID });
    expect(result.create).toEqual({ title: 'A', tenantId: TENANT_ID });
    expect(result.update).toEqual({ title: 'B' });
  });

  it('throws TenantIsolationViolationError when a where clause targets another tenant', () => {
    let caught: unknown;
    try {
      applyTenantScope('findFirst', { where: { tenantId: OTHER_TENANT_ID } }, TENANT_ID);
    } catch (error) {
      caught = error;
    }

    expect(isOrbitError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  it('throws TenantIsolationViolationError when create() data targets another tenant', () => {
    expect(() =>
      applyTenantScope('create', { data: { tenantId: OTHER_TENANT_ID } }, TENANT_ID),
    ).toThrowError(/tenant/i);
  });

  it('leaves args for a non-scoping operation untouched apart from a shallow copy', () => {
    const args = { data: { foo: 'bar' } };
    const result = applyTenantScope('executeRaw', args, TENANT_ID);
    expect(result).toEqual(args);
  });
});
