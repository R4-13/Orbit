import { Test } from '@nestjs/testing';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyEnforcementService } from './policy-enforcement.service';

describe('PolicyEnforcementService', () => {
  let service: PolicyEnforcementService;
  let findUnique: jest.Mock;
  let control: { killSwitchEngaged: jest.Mock; tenantGate: jest.Mock };

  beforeEach(async () => {
    findUnique = jest.fn();
    control = { killSwitchEngaged: jest.fn().mockResolvedValue(false), tenantGate: jest.fn().mockResolvedValue({ automationAllowed: true }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PolicyEnforcementService,
        { provide: PrismaService, useValue: { forTenantId: () => ({ policyConfig: { findUnique } }) } },
        { provide: PlatformControlService, useValue: control },
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

  describe('Plattformobergrenze (Amendment 03 §7)', () => {
    it('der Kill Switch nimmt nur AUTONOMOUS externe Sendeaktionen zurück – nie auf etwas Lockereres, nie andere Aktionen', async () => {
      control.killSwitchEngaged.mockResolvedValue(true);
      findUnique.mockResolvedValue({ mode: 'AUTONOMOUS' });
      expect(await service.resolveMode('t', 'email.send.clarification')).toBe('REQUIRE_APPROVAL');
      expect(await service.resolveMode('t', 'followup.send')).toBe('REQUIRE_APPROVAL');
      expect(await service.resolveMode('t', 'lead.create')).toBe('AUTONOMOUS');
      findUnique.mockResolvedValue({ mode: 'SUGGEST_ONLY' });
      expect(await service.resolveMode('t', 'email.send.clarification')).toBe('SUGGEST_ONLY');
      findUnique.mockResolvedValue({ mode: 'DISABLED' });
      expect(await service.resolveMode('t', 'email.send.clarification')).toBe('DISABLED');
    });

    it('eine Automatisierungssperre des Mandanten nimmt Autonomie zurück, außer bei reinem Lesen/Einordnen', async () => {
      control.tenantGate.mockResolvedValue({ automationAllowed: false });
      findUnique.mockResolvedValue({ mode: 'AUTONOMOUS' });
      expect(await service.resolveMode('t', 'lead.create')).toBe('REQUIRE_APPROVAL');
      expect(await service.resolveMode('t', 'copilot.read')).toBe('AUTONOMOUS');
      expect(await service.resolveMode('t', 'email.triage')).toBe('AUTONOMOUS');
    });

    it('ohne Sperre bleibt die Mandantenpolicy unverändert (keine Datenbankabfrage der Plattform für Nicht-AUTONOMOUS)', async () => {
      findUnique.mockResolvedValue({ mode: 'REQUIRE_APPROVAL' });
      expect(await service.resolveMode('t', 'email.send.clarification')).toBe('REQUIRE_APPROVAL');
      expect(control.killSwitchEngaged).not.toHaveBeenCalled();
      expect(control.tenantGate).not.toHaveBeenCalled();
    });
  });
});
