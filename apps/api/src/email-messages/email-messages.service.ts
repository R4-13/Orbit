import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { EmailMessage } from '@orbit/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §34 Unified Inbox — read-only. Every EmailMessage row so far comes
 * exclusively from IntakeService.handleIncomingEmail() (the simulated
 * intake endpoint, §23/§29 — no real Mail-Connector webhook exists yet,
 * see docs/KNOWN_LIMITATIONS.md). This module doesn't create or send
 * email itself; it only surfaces what the Communication Agent already
 * classified.
 */
@Injectable()
export class EmailMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string): Promise<EmailMessage[]> {
    return this.prisma.forTenantId(tenantId).emailMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(tenantId: string, id: string): Promise<EmailMessage> {
    const found = await this.prisma.forTenantId(tenantId).emailMessage.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Email message not found.', { id });
    }
    return found;
  }
}
