import { describe, expect, it } from 'vitest';
import { MockCrmConnector } from './mock-crm-connector';

const T = 'tenant_a';

describe('MockCrmConnector', () => {
  it('upsertContact() creates once, then returns the same record for the same email', async () => {
    const connector = new MockCrmConnector();
    const first = await connector.upsertContact({ tenantId: T, email: 'kunde@example.com', firstName: 'Kim', lastName: 'Kunde' });
    const second = await connector.upsertContact({ tenantId: T, email: 'kunde@example.com', firstName: 'Kim', lastName: 'Kunde' });

    expect(second.externalId).toBe(first.externalId);
  });

  it('upsertContact() without an email always creates a new contact', async () => {
    const connector = new MockCrmConnector();
    const a = await connector.upsertContact({ tenantId: T, firstName: 'A', lastName: 'Anon' });
    const b = await connector.upsertContact({ tenantId: T, firstName: 'B', lastName: 'Anon' });
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('upsertCompany() dedupes by domain', async () => {
    const connector = new MockCrmConnector();
    const first = await connector.upsertCompany({ tenantId: T, name: 'Muster GmbH', domain: 'muster.example' });
    const second = await connector.upsertCompany({ tenantId: T, name: 'Muster GmbH', domain: 'muster.example' });
    expect(second.externalId).toBe(first.externalId);
  });

  it('createLead() rejects an unknown contact, including a formally similar mock-contact id', async () => {
    const connector = new MockCrmConnector();
    await expect(connector.createLead({ tenantId: T, contactExternalId: 'does-not-exist', source: 'EMAIL' })).rejects.toThrow(/unknown contact/i);
    await expect(connector.createLead({ tenantId: T, contactExternalId: 'mock-contact-never-issued', source: 'EMAIL' })).rejects.toThrow(
      /unknown contact/i,
    );
  });

  it("createLead() rejects another tenant's valid contact reference", async () => {
    const connector = new MockCrmConnector();
    const contact = await connector.upsertContact({ tenantId: T, firstName: 'Kim', lastName: 'Kunde' });

    await expect(connector.createLead({ tenantId: 'tenant_b', contactExternalId: contact.externalId, source: 'EMAIL' })).rejects.toThrow(
      /unknown contact/i,
    );
  });

  it('createLead() succeeds for a real contact and is recorded', async () => {
    const connector = new MockCrmConnector();
    const contact = await connector.upsertContact({ tenantId: T, firstName: 'Kim', lastName: 'Kunde' });

    const result = await connector.createLead({ tenantId: T, contactExternalId: contact.externalId, source: 'EMAIL' });

    expect(result.externalId).toMatch(/^mock-lead-/);
    expect(connector.getRecordedLeads()).toHaveLength(1);
  });

  it('logActivity() rejects an unknown contact and records valid ones', async () => {
    const connector = new MockCrmConnector();
    const contact = await connector.upsertContact({ tenantId: T, firstName: 'Kim', lastName: 'Kunde' });

    await expect(
      connector.logActivity({ tenantId: T, contactExternalId: 'does-not-exist', activityType: 'CALL', summary: 'x', occurredAt: new Date() }),
    ).rejects.toThrow(/unknown contact/i);

    await connector.logActivity({
      tenantId: T,
      contactExternalId: contact.externalId,
      activityType: 'CALL',
      summary: 'Erstgespräch geführt',
      occurredAt: new Date(),
    });
    expect(connector.getRecordedActivities()).toHaveLength(1);
  });

  it('testConnection() reports healthy', async () => {
    expect(await new MockCrmConnector().testConnection()).toBe(true);
  });
});
