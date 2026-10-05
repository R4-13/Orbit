import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolExecutionContext, ToolRegistry } from '@orbit/agent-core';
import type { CalendarConnector, CrmConnector, MailConnector } from '@orbit/integration-core';
import { NotFoundError } from '@orbit/shared';
import { CALENDAR_CONNECTOR, CRM_CONNECTOR, MAIL_CONNECTOR } from '../../connectors/connectors.tokens';
import { CompaniesService } from '../../companies/companies.service';
import { ContactsService } from '../../contacts/contacts.service';
import { LeadsService } from '../../leads/leads.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';

/**
 * Sales/CRM Agent tools (§12/§14). Wraps the already-tested Phase 8 Sales
 * workflow services — see docs/ASSUMPTIONS.md Phase 18 for why
 * find_customer isn't implemented (no Customer/AR model exists, only
 * Supplier/AP — see MASTER_SPEC_GAP_ANALYSIS.md §10).
 */
@Injectable()
export class SalesAgentTools {
  constructor(
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly leads: LeadsService,
    private readonly opportunities: OpportunitiesService,
    private readonly tasks: TasksService,
    private readonly meetings: MeetingsService,
    private readonly prisma: PrismaService,
    @Inject(CRM_CONNECTOR) private readonly crmConnector: CrmConnector,
    @Inject(CALENDAR_CONNECTOR) private readonly calendarConnector: CalendarConnector,
    @Inject(MAIL_CONNECTOR) private readonly mailConnector: MailConnector,
  ) {}

  register(registry: ToolRegistry): void {
    registry.register(this.findContactTool());
    registry.register(this.createCompanyTool());
    registry.register(this.createContactTool());
    registry.register(this.createLeadTool());
    registry.register(this.updateOpportunityTool());
    registry.register(this.createTaskTool());
    registry.register(this.getCalendarAvailabilityTool());
    registry.register(this.createMeetingTool());
    registry.register(this.logCrmActivityTool());
    registry.register(this.draftEmailTool());
    registry.register(this.sendEmailTool());
  }

  private findContactTool(): ToolDefinition {
    return {
      name: 'find_contact',
      description: 'Sucht einen bestehenden Kontakt anhand der E-Mail-Adresse.',
      inputSchema: z.object({ email: z.string().email() }),
      policyAction: POLICY_ACTIONS.CONTACT_MANAGE,
      execute: async (input, context: ToolExecutionContext) =>
        this.contacts.findByEmail(context.tenantId, input.email),
    };
  }

  private createCompanyTool(): ToolDefinition {
    const inputSchema = z.object({ name: z.string().min(1), domain: z.string().optional() });
    return {
      name: 'create_company',
      description: 'Legt ein Unternehmen an (oder findet ein bestehendes anhand der Domain).',
      inputSchema,
      policyAction: POLICY_ACTIONS.CONTACT_MANAGE,
      execute: async (input, context: ToolExecutionContext) =>
        this.companies.upsert(context.tenantId, context.actorUserId, input, 'AGENT'),
    };
  }

  private createContactTool(): ToolDefinition {
    const inputSchema = z.object({
      email: z.string().email().optional(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().optional(),
      companyId: z.string().optional(),
    });
    return {
      name: 'create_contact',
      description: 'Legt einen Kontakt an (oder findet einen bestehenden anhand der E-Mail-Adresse).',
      inputSchema,
      policyAction: POLICY_ACTIONS.CONTACT_MANAGE,
      execute: async (input, context: ToolExecutionContext) =>
        this.contacts.upsert(context.tenantId, context.actorUserId, input, 'AGENT'),
    };
  }

  private createLeadTool(): ToolDefinition {
    const inputSchema = z.object({
      contactId: z.string().min(1),
      companyId: z.string().optional(),
      source: z.enum(['EMAIL', 'PHONE', 'WEB', 'MANUAL']),
      notes: z.string().optional(),
      caseId: z.string().optional(),
    });
    return {
      name: 'create_lead',
      description: 'Erzeugt einen Lead für einen Kontakt — erstellt automatisch eine Folgeaufgabe.',
      inputSchema,
      policyAction: POLICY_ACTIONS.LEAD_CREATE,
      execute: async (input, context: ToolExecutionContext) =>
        this.leads.create(context.tenantId, context.actorUserId, input, 'AGENT'),
    };
  }

  private updateOpportunityTool(): ToolDefinition {
    const inputSchema = z.object({
      leadId: z.string().optional(),
      companyId: z.string().optional(),
      contactId: z.string().optional(),
      name: z.string().min(1),
      value: z.number().optional(),
      currency: z.string().optional(),
      stage: z.enum(['NEW', 'QUALIFICATION', 'PROPOSAL', 'WON', 'LOST']).optional(),
    });
    return {
      name: 'update_opportunity',
      description:
        'Legt eine Opportunity für einen Lead an, falls noch keine existiert, oder aktualisiert ihre Phase.',
      inputSchema,
      policyAction: POLICY_ACTIONS.CRM_ACTIVITY_LOG,
      execute: async (input, context: ToolExecutionContext) => {
        const existing = input.leadId
          ? await this.opportunities.findByLeadId(context.tenantId, input.leadId)
          : null;
        if (existing) {
          return input.stage
            ? this.opportunities.updateStage(context.tenantId, context.actorUserId, existing.id, input.stage, 'AGENT')
            : existing;
        }
        return this.opportunities.create(
          context.tenantId,
          context.actorUserId,
          {
            leadId: input.leadId,
            companyId: input.companyId,
            contactId: input.contactId,
            name: input.name,
            value: input.value,
            currency: input.currency,
          },
          'AGENT',
        );
      },
    };
  }

  private createTaskTool(): ToolDefinition {
    const inputSchema = z.object({
      caseId: z.string().optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      dueDate: z.string().optional(),
    });
    return {
      name: 'create_task',
      description: 'Erstellt eine Aufgabe, z. B. eine Erinnerung an einen Follow-up-Anruf.',
      inputSchema,
      policyAction: POLICY_ACTIONS.TASK_CREATE,
      execute: async (input, context: ToolExecutionContext) =>
        this.tasks.create(context.tenantId, context.actorUserId, input, 'AGENT', 'AGENT'),
    };
  }

  private getCalendarAvailabilityTool(): ToolDefinition {
    const inputSchema = z.object({
      durationMinutes: z.number().int().positive(),
      earliestStart: z.string().datetime(),
      latestEnd: z.string().datetime(),
    });
    return {
      name: 'get_calendar_availability',
      description: 'Fragt freie Terminslots in einem Zeitfenster ab (rein lesend, keine Terminerstellung).',
      inputSchema,
      policyAction: POLICY_ACTIONS.CALENDAR_READ,
      execute: async (input) =>
        this.calendarConnector.findAvailability({
          durationMinutes: input.durationMinutes,
          earliestStart: new Date(input.earliestStart),
          latestEnd: new Date(input.latestEnd),
        }),
    };
  }

  private createMeetingTool(): ToolDefinition {
    const inputSchema = z.object({
      contactId: z.string().optional(),
      opportunityId: z.string().optional(),
      title: z.string().min(1),
      durationMinutes: z.number().int().positive(),
      earliestStart: z.string().datetime(),
      latestEnd: z.string().datetime(),
    });
    return {
      name: 'create_meeting',
      description:
        'Schlägt einen Beratungstermin vor (fragt Verfügbarkeit ab und legt eine Meeting-Anfrage mit Terminvorschlägen an). Die endgültige Bestätigung erfolgt weiterhin durch einen Menschen.',
      inputSchema,
      policyAction: POLICY_ACTIONS.MEETING_PROPOSE,
      execute: async (input, context: ToolExecutionContext) =>
        this.meetings.proposeSlots(
          context.tenantId,
          context.actorUserId,
          {
            contactId: input.contactId,
            opportunityId: input.opportunityId,
            title: input.title,
            durationMinutes: input.durationMinutes,
            earliestStart: new Date(input.earliestStart),
            latestEnd: new Date(input.latestEnd),
          },
          'AGENT',
        ),
    };
  }

  private logCrmActivityTool(): ToolDefinition {
    const inputSchema = z.object({
      contactExternalId: z.string().min(1),
      activityType: z.string().min(1),
      summary: z.string().min(1),
    });
    return {
      name: 'log_crm_activity',
      description: 'Dokumentiert eine Aktivität (z. B. eingehende Anfrage) am CRM-Kontakt.',
      inputSchema,
      policyAction: POLICY_ACTIONS.CRM_ACTIVITY_LOG,
      execute: async (input, context) =>
        this.crmConnector.logActivity({
          tenantId: context.tenantId,
          contactExternalId: input.contactExternalId,
          activityType: input.activityType,
          summary: input.summary,
          occurredAt: new Date(),
        }),
    };
  }

  private draftEmailTool(): ToolDefinition {
    const inputSchema = z.object({
      caseId: z.string().optional(),
      toAddress: z.string().email(),
      subject: z.string().min(1),
      bodyText: z.string().min(1),
    });
    return {
      name: 'draft_email',
      description: 'Entwirft eine Follow-up-E-Mail (wird als Entwurf gespeichert, noch nicht versendet).',
      inputSchema,
      policyAction: POLICY_ACTIONS.EMAIL_DRAFT,
      execute: async (input, context: ToolExecutionContext) => {
        // Der Absender ist das verbundene Postfach des Mandanten (dynamisch ermittelt), nie eine im Code festgelegte Adresse (UI v2 AC-17).
        const mailbox = await this.prisma.forTenantId(context.tenantId).integration.findFirst({
          where: { connectorType: { in: ['GMAIL', 'MICROSOFT'] }, status: 'CONNECTED' },
          select: { externalAccountDisplayName: true },
        });
        return this.prisma.forTenantId(context.tenantId).emailMessage.create({
          data: {
            tenantId: context.tenantId,
            caseId: input.caseId,
            direction: 'OUTBOUND',
            fromAddress: mailbox?.externalAccountDisplayName ?? 'Kein Postfach verbunden',
            toAddresses: [input.toAddress],
            subject: input.subject,
            bodyPreview: input.bodyText.slice(0, 500),
          },
        });
      },
    };
  }

  private sendEmailTool(): ToolDefinition {
    const inputSchema = z.object({ draftEmailId: z.string().min(1) });
    return {
      name: 'send_email',
      description:
        'Versendet eine zuvor entworfene E-Mail. Per Default REQUIRE_APPROVAL (§17 "Follow-up versenden").',
      inputSchema,
      policyAction: POLICY_ACTIONS.FOLLOW_UP_SEND,
      execute: async (input, context: ToolExecutionContext) => {
        const draft = await this.prisma.forTenantId(context.tenantId).emailMessage.findUnique({
          where: { id: input.draftEmailId },
        });
        if (!draft) {
          throw new NotFoundError('Draft email not found.', { id: input.draftEmailId });
        }

        const result = await this.mailConnector.sendMessage({
          to: draft.toAddresses,
          subject: draft.subject ?? '',
          bodyText: draft.bodyPreview ?? '',
        });

        return this.prisma.forTenantId(context.tenantId).emailMessage.update({
          where: { id: draft.id },
          data: { sentAt: new Date(), providerMessageId: result.providerMessageId },
        });
      },
    };
  }
}
