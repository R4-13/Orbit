import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolExecutionContext, ToolRegistry } from '@orbit/agent-core';
import { InvoicesService } from '../../invoices/invoices.service';

/**
 * Finance/AP Agent tools (§12/§14 of the master spec) — thin wrappers
 * around the already-tested Phase 7 Finance workflow (InvoicesService).
 * Deliberately does NOT re-decompose `createFromDocument` into separate
 * find_supplier/check_duplicate_invoice steps: that method already does
 * both internally as one atomic, tested operation, and its result
 * (`supplierId`, `status`) tells the agent everything a prior lookup
 * would have — see docs/ASSUMPTIONS.md Phase 18.
 */
@Injectable()
export class FinanceAgentTools {
  constructor(private readonly invoices: InvoicesService) {}

  register(registry: ToolRegistry): void {
    registry.register(this.extractInvoiceTool());
    registry.register(this.createBookingProposalTool());
    registry.register(this.transferInvoiceToFinanceTool());
  }

  private extractInvoiceTool(): ToolDefinition {
    const inputSchema = z.object({
      documentId: z.string().min(1),
      caseId: z.string().optional(),
    });

    return {
      name: 'extract_invoice',
      description:
        'Liest ein hochgeladenes Dokument aus (OCR), gleicht den Lieferanten ab, prüft auf Dubletten und legt die Rechnung an. Gibt supplierId (falls gefunden) und status zurück.',
      inputSchema,
      policyAction: POLICY_ACTIONS.INVOICE_INTAKE,
      execute: async (input, context: ToolExecutionContext) =>
        this.invoices.createFromDocument(
          context.tenantId,
          context.actorUserId,
          { documentId: input.documentId, caseId: input.caseId },
          'AGENT',
        ),
    };
  }

  private createBookingProposalTool(): ToolDefinition {
    const inputSchema = z.object({
      invoiceId: z.string().min(1),
      accountCode: z.string().min(1),
      costCenter: z.string().optional(),
      description: z.string().optional(),
      amount: z.number().positive(),
    });

    return {
      name: 'create_booking_proposal',
      description: 'Erstellt einen Buchungsvorschlag (Sachkonto + Betrag) für eine Rechnung, die auf Freigabe wartet.',
      inputSchema,
      policyAction: POLICY_ACTIONS.BOOKING_PROPOSAL_CREATE,
      execute: async (input, context: ToolExecutionContext) =>
        this.invoices.addBookingProposal(
          context.tenantId,
          context.actorUserId,
          input.invoiceId,
          {
            accountCode: input.accountCode,
            costCenter: input.costCenter,
            description: input.description,
            amount: input.amount,
          },
          'AGENT',
        ),
    };
  }

  private transferInvoiceToFinanceTool(): ToolDefinition {
    const inputSchema = z.object({ invoiceId: z.string().min(1) });

    return {
      name: 'transfer_invoice_to_finance',
      description:
        'Überträgt eine bereits freigegebene Rechnung an die Finanzbuchhaltung (FiBu-Connector). Per Default REQUIRE_APPROVAL — läuft für einen Tenant mit Default-Konfiguration nie autonom durch, sondern erzeugt eine Freigabeanfrage.',
      inputSchema,
      policyAction: POLICY_ACTIONS.INVOICE_TRANSFER_TO_FIBU,
      execute: async (input, context: ToolExecutionContext) =>
        this.invoices.transfer(context.tenantId, context.actorUserId, input.invoiceId, 'AGENT'),
    };
  }
}
