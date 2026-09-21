/**
 * Demo-data seed script (§43-45 of the master spec): populates the
 * "Musterwerk GmbH" demo tenant with realistic Finance and Sales data so a
 * fresh environment has something to look at without manual data entry.
 *
 * Deliberately does NOT reuse apps/api's NestJS services (TenantsService,
 * SuppliersService, InvoicesService, ...): this package (@orbit/domain)
 * cannot depend on apps/api (that would invert the workspace dependency
 * graph — apps depend on packages, never the reverse), so the tenant
 * bootstrap logic (roles/permissions/policy seeding) is intentionally
 * duplicated here in a smaller, self-contained form. See
 * docs/ASSUMPTIONS.md for the full reasoning.
 *
 * Run with `pnpm prisma:seed` (needs DATABASE_URL set — see .env.example).
 */
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaClient, type Prisma } from '@prisma/client';
import { MockCrmConnector, MockFinanceConnector } from '@orbit/integration-core';
import {
  DEFAULT_POLICY_CONFIG,
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  type AuditEventType,
  type RoleName,
} from '@orbit/shared';

const prisma = new PrismaClient();
const financeConnector = new MockFinanceConnector();
const crmConnector = new MockCrmConnector();

const TENANT_SLUG = 'musterwerk';
/** Same password for every demo user — see docs/DEMO_DATA.md. */
const DEMO_PASSWORD = 'Musterwerk#2026!';

const DEMO_USERS: { email: string; firstName: string; lastName: string; role: RoleName }[] = [
  { email: 'admin@musterwerk.example', firstName: 'Anna', lastName: 'Admin', role: ROLES.TENANT_ADMIN },
  { email: 'finance@musterwerk.example', firstName: 'Frank', lastName: 'Finanz', role: ROLES.FINANCE_USER },
  { email: 'sales@musterwerk.example', firstName: 'Sina', lastName: 'Sales', role: ROLES.SALES_USER },
  { email: 'approval@musterwerk.example', firstName: 'Alex', lastName: 'Approve', role: ROLES.APPROVER },
  { email: 'viewer@musterwerk.example', firstName: 'Vera', lastName: 'View', role: ROLES.VIEWER },
];

async function recordAudit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  eventType: AuditEventType,
  entityType: string,
  entityId: string,
  actorUserId?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId,
      eventType,
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      actorUserId,
      entityType,
      entityId,
      payload: payload as Prisma.InputJsonValue | undefined,
    },
  });
}

async function main(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (existing) {
    console.log(`[seed] Removing existing "${TENANT_SLUG}" tenant for a clean re-seed …`);
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  await prisma.$transaction(async (tx) => {
    // --- Tenant + roles + policy config (mirrors TenantsService.bootstrapTenant) ---
    const tenant = await tx.tenant.create({
      data: { name: 'Musterwerk GmbH', slug: TENANT_SLUG },
    });

    const roleIdByName = new Map<RoleName, string>();
    for (const roleName of Object.values(ROLES)) {
      const role = await tx.role.create({
        data: { tenantId: tenant.id, name: roleName, isSystemDefault: true },
      });
      roleIdByName.set(roleName, role.id);

      const permissions = DEFAULT_ROLE_PERMISSIONS[roleName];
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, permission })),
        });
      }
    }

    await tx.policyConfig.createMany({
      data: Object.entries(DEFAULT_POLICY_CONFIG).map(([action, config]) => ({
        tenantId: tenant.id,
        action,
        mode: config.mode,
        locked: config.locked ?? false,
      })),
    });

    // --- Users ---
    const passwordHash = await argon2.hash(DEMO_PASSWORD);
    const userIdByEmail = new Map<string, string>();
    for (const demoUser of DEMO_USERS) {
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: demoUser.email,
          passwordHash,
          firstName: demoUser.firstName,
          lastName: demoUser.lastName,
          status: 'ACTIVE',
        },
      });
      userIdByEmail.set(demoUser.email, user.id);
      const roleId = roleIdByName.get(demoUser.role);
      if (roleId) {
        await tx.userRole.create({ data: { userId: user.id, roleId } });
      }
      await recordAudit(tx, tenant.id, 'USER_CREATED', 'User', user.id, undefined, {
        email: user.email,
        role: demoUser.role,
      });
    }
    const adminId = userIdByEmail.get('admin@musterwerk.example')!;
    const financeUserId = userIdByEmail.get('finance@musterwerk.example')!;
    const salesUserId = userIdByEmail.get('sales@musterwerk.example')!;

    // --- Suppliers ---
    const papierBuero = await createActiveSupplier(tx, tenant.id, financeUserId, {
      name: 'Papier & Büro GmbH',
      taxId: 'DE123456780',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      email: 'buchhaltung@papier-buero.example',
    });
    const itServiceNord = await createActiveSupplier(tx, tenant.id, financeUserId, {
      name: 'IT-Service Nord GmbH',
      taxId: 'DE998877665',
      iban: 'DE12500105170648489890',
      bic: 'INGDDEFFXXX',
      email: 'rechnung@it-service-nord.example',
    });
    const schmidtWerkzeugbau = await tx.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'Schmidt Werkzeugbau KG',
        taxId: 'DE554433221',
        status: 'PENDING_APPROVAL',
      },
    });
    await recordAudit(tx, tenant.id, 'SUPPLIER_CREATED', 'Supplier', schmidtWerkzeugbau.id, financeUserId, {
      name: schmidtWerkzeugbau.name,
      status: 'PENDING_APPROVAL',
    });

    // --- Finance Case 1: fully processed invoice ---
    const case1 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'FINANCE',
        status: 'DONE',
        title: 'Rechnung Papier & Büro – Büromaterial März',
        assigneeId: financeUserId,
      },
    });
    await recordAudit(tx, tenant.id, 'CASE_CREATED', 'Case', case1.id, financeUserId);

    const invoice1 = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        supplierId: papierBuero.id,
        invoiceNumber: 'RE-2026-0312',
        invoiceDate: new Date('2026-03-05'),
        dueDate: new Date('2026-04-04'),
        amountNet: 420.0,
        vatAmount: 79.8,
        vatRate: 19,
        amountGross: 499.8,
        currency: 'EUR',
        status: 'TRANSFERRED',
        confidenceScore: 0.94,
        extractedData: { supplierName: papierBuero.name, invoiceNumber: 'RE-2026-0312' },
      },
    });
    await recordAudit(tx, tenant.id, 'INVOICE_CREATED', 'Invoice', invoice1.id, financeUserId);

    const booking1 = await tx.bookingProposal.create({
      data: {
        tenantId: tenant.id,
        invoiceId: invoice1.id,
        accountCode: '4930',
        description: 'Bürobedarf',
        amount: 499.8,
        status: 'APPROVED',
      },
    });
    await recordAudit(tx, tenant.id, 'BOOKING_PROPOSED', 'BookingProposal', booking1.id, financeUserId);
    await recordAudit(tx, tenant.id, 'APPROVAL_GRANTED', 'Invoice', invoice1.id, adminId, {
      policyAction: 'invoice.transfer_to_fibu',
    });

    const transferResult1 = await financeConnector.transferInvoice({
      supplierExternalId: papierBuero.externalFinanceId!,
      invoiceNumber: invoice1.invoiceNumber!,
      invoiceDate: invoice1.invoiceDate!,
      amountNet: 420,
      amountGross: 499.8,
      vatAmount: 79.8,
      vatRate: 19,
      currency: 'EUR',
      accountCode: '4930',
    });
    await tx.financeTransfer.create({
      data: {
        tenantId: tenant.id,
        invoiceId: invoice1.id,
        connector: financeConnector.providerName,
        externalReference: transferResult1.externalReference,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    await recordAudit(tx, tenant.id, 'FINANCE_TRANSFER_COMPLETED', 'Invoice', invoice1.id, financeUserId, {
      externalReference: transferResult1.externalReference,
    });

    // --- Finance Case 2: approved, awaiting transfer ---
    const case2 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'FINANCE',
        status: 'IN_PROGRESS',
        title: 'Rechnung IT-Service Nord – Serverwartung',
        assigneeId: financeUserId,
      },
    });
    const invoice2 = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        caseId: case2.id,
        supplierId: itServiceNord.id,
        invoiceNumber: 'INV-8842',
        invoiceDate: new Date('2026-03-18'),
        dueDate: new Date('2026-04-17'),
        amountNet: 850.0,
        vatAmount: 161.5,
        vatRate: 19,
        amountGross: 1011.5,
        currency: 'EUR',
        status: 'APPROVED',
        confidenceScore: 0.88,
        extractedData: { supplierName: itServiceNord.name, invoiceNumber: 'INV-8842' },
      },
    });
    await tx.bookingProposal.create({
      data: {
        tenantId: tenant.id,
        invoiceId: invoice2.id,
        accountCode: '6805',
        description: 'Kosten für EDV (Serverwartung)',
        amount: 1011.5,
        status: 'APPROVED',
      },
    });
    await recordAudit(tx, tenant.id, 'INVOICE_CREATED', 'Invoice', invoice2.id, financeUserId);

    // --- Finance Case 3: pending supplier + invoice approval ---
    const case3 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'FINANCE',
        status: 'WAITING_APPROVAL',
        title: 'Rechnung Schmidt Werkzeugbau – Neue Anfrage',
      },
    });
    const invoice3 = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        caseId: case3.id,
        supplierId: schmidtWerkzeugbau.id,
        invoiceNumber: 'SW-2026-014',
        invoiceDate: new Date('2026-03-20'),
        amountNet: 2000.0,
        vatAmount: 380.0,
        vatRate: 19,
        amountGross: 2380.0,
        currency: 'EUR',
        status: 'PENDING_APPROVAL',
        confidenceScore: 0.76,
        extractedData: { supplierName: schmidtWerkzeugbau.name, invoiceNumber: 'SW-2026-014' },
      },
    });
    await recordAudit(tx, tenant.id, 'INVOICE_CREATED', 'Invoice', invoice3.id, financeUserId);
    await tx.task.create({
      data: {
        tenantId: tenant.id,
        caseId: case3.id,
        title: 'Neuen Lieferanten Schmidt Werkzeugbau prüfen und freigeben',
        status: 'OPEN',
        source: 'AGENT',
        assigneeId: financeUserId,
      },
    });

    // --- Finance Case 4: suspected duplicate ---
    const case4 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'FINANCE',
        status: 'OPEN',
        title: 'Mögliche Doppelrechnung Papier & Büro',
      },
    });
    const invoice4a = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        supplierId: papierBuero.id,
        invoiceNumber: 'RE-2026-0455',
        invoiceDate: new Date('2026-03-22'),
        amountNet: 131.43,
        vatAmount: 24.97,
        vatRate: 19,
        amountGross: 156.4,
        currency: 'EUR',
        status: 'TRANSFERRED',
        confidenceScore: 0.91,
      },
    });
    const invoice4b = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        caseId: case4.id,
        supplierId: papierBuero.id,
        invoiceNumber: 'RE-2026-0455',
        invoiceDate: new Date('2026-03-22'),
        amountNet: 131.43,
        vatAmount: 24.97,
        vatRate: 19,
        amountGross: 156.4,
        currency: 'EUR',
        status: 'DUPLICATE_SUSPECTED',
        confidenceScore: 0.89,
        duplicateOfInvoiceId: invoice4a.id,
      },
    });
    await recordAudit(tx, tenant.id, 'DUPLICATE_INVOICE_DETECTED', 'Invoice', invoice4b.id, undefined, {
      duplicateOfInvoiceId: invoice4a.id,
    });
    await tx.task.create({
      data: {
        tenantId: tenant.id,
        caseId: case4.id,
        title: 'Dublette RE-2026-0455 mit Lieferant klären',
        status: 'OPEN',
        source: 'AGENT',
        assigneeId: financeUserId,
      },
    });

    // --- Sales: companies & contacts ---
    const nordwind = await createCrmCompany(tx, tenant.id, {
      name: 'Nordwind Immobilien GmbH',
      domain: 'nordwind-immobilien.example',
      industry: 'Immobilien',
    });
    const cafeSonnenschein = await createCrmCompany(tx, tenant.id, {
      name: 'Café Sonnenschein',
      domain: 'cafe-sonnenschein.example',
      industry: 'Gastronomie',
    });

    const juliaNord = await createCrmContact(tx, tenant.id, {
      firstName: 'Julia',
      lastName: 'Nord',
      email: 'julia.nord@nordwind-immobilien.example',
      companyId: nordwind.id,
    });
    const markusBerg = await createCrmContact(tx, tenant.id, {
      firstName: 'Markus',
      lastName: 'Berg',
      email: 'm.berg@cafe-sonnenschein.example',
      companyId: cafeSonnenschein.id,
    });
    const petraKlein = await createCrmContact(tx, tenant.id, {
      firstName: 'Petra',
      lastName: 'Klein',
      email: 'petra.klein@example.com',
    });

    // --- Sales Case 1: qualified lead with an open opportunity ---
    const salesCase1 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'SALES',
        status: 'IN_PROGRESS',
        title: 'Anfrage Nordwind Immobilien',
        assigneeId: salesUserId,
      },
    });
    const lead1 = await tx.lead.create({
      data: {
        tenantId: tenant.id,
        caseId: salesCase1.id,
        contactId: juliaNord.id,
        companyId: nordwind.id,
        source: 'EMAIL',
        status: 'QUALIFIED',
        notes: 'Interesse an Büroausstattung für neuen Standort.',
      },
    });
    await recordAudit(tx, tenant.id, 'LEAD_CREATED', 'Lead', lead1.id, salesUserId);
    await tx.task.create({
      data: {
        tenantId: tenant.id,
        caseId: salesCase1.id,
        title: 'Neuen Lead kontaktieren: Julia Nord',
        status: 'DONE',
        source: 'AGENT',
        assigneeId: salesUserId,
      },
    });
    const opportunity1 = await tx.opportunity.create({
      data: {
        tenantId: tenant.id,
        leadId: lead1.id,
        companyId: nordwind.id,
        contactId: juliaNord.id,
        name: 'Büroausstattung Nordwind',
        stage: 'PROPOSAL',
        value: 12500,
        currency: 'EUR',
      },
    });
    await recordAudit(tx, tenant.id, 'OPPORTUNITY_CREATED', 'Opportunity', opportunity1.id, salesUserId);
    await tx.meeting.create({
      data: {
        tenantId: tenant.id,
        contactId: juliaNord.id,
        opportunityId: opportunity1.id,
        title: 'Erstgespräch Nordwind Immobilien',
        status: 'PROPOSED',
        proposedSlots: [
          { start: '2026-04-02T09:00:00.000Z', end: '2026-04-02T09:30:00.000Z' },
          { start: '2026-04-02T10:00:00.000Z', end: '2026-04-02T10:30:00.000Z' },
        ] as unknown as Prisma.InputJsonValue,
      },
    });

    // --- Sales Case 2: brand-new lead, nothing done yet ---
    const salesCase2 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        type: 'SALES',
        status: 'OPEN',
        title: 'Anfrage Café Sonnenschein',
      },
    });
    const lead2 = await tx.lead.create({
      data: {
        tenantId: tenant.id,
        caseId: salesCase2.id,
        contactId: markusBerg.id,
        companyId: cafeSonnenschein.id,
        source: 'PHONE',
        status: 'NEW',
        notes: 'Rückruf erbeten, Interesse an Rahmenvertrag für Verbrauchsmaterial.',
      },
    });
    await recordAudit(tx, tenant.id, 'LEAD_CREATED', 'Lead', lead2.id, salesUserId);
    await tx.task.create({
      data: {
        tenantId: tenant.id,
        caseId: salesCase2.id,
        title: 'Neuen Lead kontaktieren: Markus Berg',
        status: 'OPEN',
        source: 'AGENT',
        assigneeId: salesUserId,
      },
    });
    const opportunity2 = await tx.opportunity.create({
      data: {
        tenantId: tenant.id,
        leadId: lead2.id,
        companyId: cafeSonnenschein.id,
        contactId: markusBerg.id,
        name: 'Rahmenvertrag Café Sonnenschein',
        stage: 'QUALIFICATION',
        value: 3200,
        currency: 'EUR',
      },
    });
    await recordAudit(tx, tenant.id, 'OPPORTUNITY_CREATED', 'Opportunity', opportunity2.id, salesUserId);
    await tx.meeting.create({
      data: {
        tenantId: tenant.id,
        contactId: markusBerg.id,
        opportunityId: opportunity2.id,
        title: 'Abschlussgespräch Café Sonnenschein',
        status: 'CONFIRMED',
        scheduledAt: new Date('2026-04-05T13:00:00.000Z'),
        calendarExternalId: `mock-meeting-${randomUUID()}`,
      },
    });

    // --- Converted lead, no open case (already closed out) ---
    const lead3 = await tx.lead.create({
      data: {
        tenantId: tenant.id,
        contactId: petraKlein.id,
        source: 'WEB',
        status: 'CONVERTED',
        notes: 'Anfrage über Kontaktformular, bereits als Kunde gewonnen.',
      },
    });
    await recordAudit(tx, tenant.id, 'LEAD_CREATED', 'Lead', lead3.id, salesUserId);
  });

  console.log(`[seed] "Musterwerk GmbH" (slug: ${TENANT_SLUG}) seeded successfully.`);
  console.log(`[seed] Demo-Login: siehe docs/DEMO_DATA.md (Passwort für alle Demo-Nutzer: ${DEMO_PASSWORD})`);
}

async function createActiveSupplier(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorUserId: string,
  input: { name: string; taxId: string; iban: string; bic: string; email: string },
) {
  const externalSupplier = await financeConnector.createSupplier(input);
  const supplier = await tx.supplier.create({
    data: {
      tenantId,
      name: input.name,
      taxId: input.taxId,
      iban: input.iban,
      bic: input.bic,
      email: input.email,
      status: 'ACTIVE',
      externalFinanceId: externalSupplier.externalId,
    },
  });
  await recordAudit(tx, tenantId, 'SUPPLIER_CREATED', 'Supplier', supplier.id, actorUserId, {
    name: supplier.name,
    status: 'ACTIVE',
  });
  return supplier;
}

async function createCrmCompany(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { name: string; domain: string; industry: string },
) {
  const crmCompany = await crmConnector.upsertCompany(input);
  const company = await tx.company.create({
    data: { tenantId, ...input, crmExternalId: crmCompany.externalId },
  });
  await recordAudit(tx, tenantId, 'COMPANY_CREATED', 'Company', company.id);
  return company;
}

async function createCrmContact(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { firstName: string; lastName: string; email: string; companyId?: string },
) {
  const crmContact = await crmConnector.upsertContact(input);
  const contact = await tx.contact.create({
    data: { tenantId, ...input, crmExternalId: crmContact.externalId },
  });
  await recordAudit(tx, tenantId, 'CONTACT_CREATED', 'Contact', contact.id);
  return contact;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
