import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ContactsService } from '../src/contacts/contacts.service';
import { LeadsService } from '../src/leads/leads.service';
import { PersistentMockCrmConnector } from '../src/connectors/persistent-mock-crm.connector';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Amendment 02 §12.5 / §25.2 — a stored mock-CRM contact reference must stay
 * valid across worker/container restarts and stay tenant-bound. A fresh
 * `PersistentMockCrmConnector` instance has no in-process memory, which is
 * exactly the situation after a restart.
 */
describe('Mock-CRM reference durability and tenant binding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contacts: ContactsService;
  let leads: LeadsService;
  let tenantsService: TenantsService;
  const created: string[] = [];

  async function newTenant(label: string): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E ${label} ${suffix}`,
      slug: `e2e-${label}-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-${label}.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    created.push(tenant.id);
    return tenant.id;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    contacts = app.get(ContactsService);
    leads = app.get(LeadsService);
    tenantsService = app.get(TenantsService);
  });

  afterAll(async () => {
    for (const tenantId of created) {
      await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    }
    await app.close();
  });

  it('a known contact still creates a lead through a brand-new connector instance (= after a restart)', async () => {
    const tenantId = await newTenant('durable');
    const contact = await contacts.upsert(tenantId, undefined, {
      email: `returning-${randomUUID()}@kunde.example`,
      firstName: 'Re',
      lastName: 'Turning',
    });
    expect(contact.crmExternalId).toMatch(/^mock-contact-/);

    const afterRestart = new PersistentMockCrmConnector(prisma);
    await expect(
      afterRestart.createLead({ tenantId, contactExternalId: contact.crmExternalId!, source: 'EMAIL' }),
    ).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-lead-/) });

    const lead = await leads.create(tenantId, undefined, { contactId: contact.id, source: 'EMAIL' });
    expect(lead.contactId).toBe(contact.id);
  });

  it('rejects a formally similar id that was never issued', async () => {
    const tenantId = await newTenant('similar');
    const connector = new PersistentMockCrmConnector(prisma);

    await expect(
      connector.createLead({ tenantId, contactExternalId: `mock-contact-${randomUUID()}`, source: 'EMAIL' }),
    ).rejects.toThrow(/unknown contact/i);
  });

  it("rejects another tenant's valid contact reference", async () => {
    const tenantA = await newTenant('tenant-a');
    const tenantB = await newTenant('tenant-b');
    const contact = await contacts.upsert(tenantA, undefined, {
      email: `a-${randomUUID()}@kunde.example`,
      firstName: 'Alpha',
      lastName: 'Kunde',
    });

    const connector = new PersistentMockCrmConnector(prisma);
    await expect(
      connector.createLead({ tenantId: tenantB, contactExternalId: contact.crmExternalId!, source: 'EMAIL' }),
    ).rejects.toThrow(/unknown contact/i);
  });

  it('rejects a reference whose backing record was deleted — nothing is reconstructed', async () => {
    const tenantId = await newTenant('deleted');
    const contact = await contacts.upsert(tenantId, undefined, {
      email: `gone-${randomUUID()}@kunde.example`,
      firstName: 'Gone',
      lastName: 'Kunde',
    });
    await prisma.forTenantId(tenantId).mockCrmRecord.deleteMany({
      where: { tenantId, kind: 'CONTACT', externalId: contact.crmExternalId! },
    });

    const connector = new PersistentMockCrmConnector(prisma);
    await expect(
      connector.createLead({ tenantId, contactExternalId: contact.crmExternalId!, source: 'EMAIL' }),
    ).rejects.toThrow(/unknown contact/i);
  });
});
