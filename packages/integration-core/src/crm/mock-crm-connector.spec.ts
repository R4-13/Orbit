import { describe, expect, it } from 'vitest';
import { MockCrmConnector } from './mock-crm-connector';

describe('MockCrmConnector', () => {
  it('upsertContact() creates once, then returns the same record for the same email', async () => {
    const connector = new MockCrmConnector();
    const first = await connector.upsertContact({
      email: 'kunde@example.com',
      firstName: 'Kim',
      lastName: 'Kunde',
    });
    const second = await connector.upsertContact({
      email: 'kunde@example.com',
      firstName: 'Kim',
      lastName: 'Kunde',
    });

    expect(second.externalId).toBe(first.externalId);
  });

  it('upsertContact() without an email always creates a new contact', async () => {
    const connector = new MockCrmConnector();
    const a = await connector.upsertContact({ firstName: 'A', lastName: 'Anon' });
    const b = await connector.upsertContact({ firstName: 'B', lastName: 'Anon' });
    expect(a.externalId).not.toBe(b.externalId);
  });

  it('upsertCompany() dedupes by domain', async () => {
    const connector = new MockCrmConnector();
    const first = await connector.upsertCompany({ name: 'Muster GmbH', domain: 'muster.example' });
    const second = await connector.upsertCompany({ name: 'Muster GmbH', domain: 'muster.example' });
    expect(second.externalId).toBe(first.externalId);
  });

  it('createLead() rejects an unknown contact', async () => {
    const connector = new MockCrmConnector();
    await expect(
      connector.createLead({ contactExternalId: 'does-not-exist', source: 'EMAIL' }),
    ).rejects.toThrow(/unknown contact/i);
  });

  it('createLead() accepts a mock-contact id issued by an earlier process lifetime (ORBIT persists crmExternalId across restarts)', async () => {
    const connector = new MockCrmConnector();
    await expect(
      connector.createLead({ contactExternalId: 'mock-contact-issued-before-restart', source: 'EMAIL' }),
    ).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-lead-/) });
  });

  it('createLead() succeeds for a real contact and is recorded', async () => {
    const connector = new MockCrmConnector();
    const contact = await connector.upsertContact({ firstName: 'Kim', lastName: 'Kunde' });

    const result = await connector.createLead({ contactExternalId: contact.externalId, source: 'EMAIL' });

    expect(result.externalId).toMatch(/^mock-lead-/);
    expect(connector.getRecordedLeads()).toHaveLength(1);
  });

  it('logActivity() rejects an unknown contact and records valid ones', async () => {
    const connector = new MockCrmConnector();
    const contact = await connector.upsertContact({ firstName: 'Kim', lastName: 'Kunde' });

    await expect(
      connector.logActivity({
        contactExternalId: 'does-not-exist',
        activityType: 'CALL',
        summary: 'x',
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(/unknown contact/i);

    await connector.logActivity({
      contactExternalId: contact.externalId,
      activityType: 'CALL',
      summary: 'Erstgespräch geführt',
      occurredAt: new Date(),
    });
    expect(connector.getRecordedActivities()).toHaveLength(1);
  });
});
