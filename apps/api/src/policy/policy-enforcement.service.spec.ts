import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyEnforcementService } from './policy-enforcement.service';

describe('PolicyEnforcementService', () => {
  let service: PolicyEnforcementService;
  let findUnique: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PolicyEnforcementService,
        {
          provide: PrismaService,
          useValue: { forTenantId: () => ({ policyConfig: { findUnique } }) },
        },
      ],
    }).compile();
    service = moduleRef.get(PolicyEnforcementService);
  });

  it('resolveMode() returns the stored mode for the tenant+action', async () => {
    findUnique.mockResolvedValue({ mode: 'AUTONOMOUS' });
    expect(await service.resolveMode('tenant_1', 'crm.activity.log')).toBe('AUTONOMOUS');
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_action: { tenantId: 'tenant_1', action: 'crm.activity.log' } },
    });
  });

  it('resolveMode() fails safe to REQUIRE_APPROVAL when no PolicyConfig row exists', async () => {
    findUnique.mockResolvedValue(null);
    expect(await service.resolveMode('tenant_1', 'invoice.transfer_to_fibu')).toBe('REQUIRE_APPROVAL');
  });

  it('decide() maps the resolved mode through decidePolicyAction()', async () => {
    findUnique.mockResolvedValue({ mode: 'DISABLED' });
    expect(await service.decide('tenant_1', 'payment.execute')).toBe('DENY');
  });
});
