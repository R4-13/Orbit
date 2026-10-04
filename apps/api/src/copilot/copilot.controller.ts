import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CopilotConversationService } from './copilot-conversation.service';
import { CopilotRuntimeService } from './copilot-runtime.service';
import type { CopilotStreamEvent } from './copilot-stream-event';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SONDE_ACT_TOOL_NAMES, SONDE_ASK_TOOL_NAMES, SONDE_PREPARE_TOOL_NAMES } from './tools/sonde.tools';

/**
 * §33 des Master-Dokuments ("Sonde action cards, streaming and API") —
 * Routenschema wörtlich wie dort vorgeschlagen, inkl. des dort
 * empfohlenen Streaming-Endpunkts (`POST .../messages/stream`, Phase 8).
 * Nur `JwtAuthGuard`, keine zusätzliche `RequirePermissions` — Sonde ist
 * laut §25 global für jeden authentifizierten Nutzer verfügbar; welche
 * Tools ein Tool-Aufruf tatsächlich ausführen darf, entscheidet weiterhin
 * die Policy Engine (`COPILOT_READ`/`EMAIL_DRAFT`/`MEETING_PROPOSE`/
 * `BOOKING_PROPOSAL_CREATE`/`TASK_CREATE`/`CONTACT_MANAGE`/`LEAD_CREATE`/
 * `FOLLOW_UP_SEND`), nicht diese Route. Siehe docs/ASSUMPTIONS.md für die
 * bewusst noch nicht umgesetzte volle §32-Berechtigungs-Schnittmenge.
 *
 * Der Streaming-Endpunkt nutzt bewusst **nicht** Nests eingebauten
 * `@Sse()`-Dekorator: dieser erzwingt intern immer `RequestMethod.GET`
 * (`@nestjs/common/decorators/http/sse.decorator.ts`), während §33 explizit
 * `POST` vorschlägt (der Nachrichteninhalt gehört in den Body, nicht in
 * die URL/Query-String — u. a. wegen Server-/Proxy-Logs). Stattdessen wird
 * die SSE-Antwort manuell über `@Res()` geschrieben, siehe
 * `streamMessage()` unten.
 */
@ApiTags('copilot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'copilot' })
export class CopilotController {
  constructor(
    private readonly conversations: CopilotConversationService,
    private readonly runtime: CopilotRuntimeService,
  ) {}

  @Get('capabilities')
  getCapabilities() {
    // §32: READ (ASK) + PREPARE + ACT in dieser Phase — DELEGATE/NAVIGATE folgen mit späteren Phasen.
    return {
      modes: ['ASK', 'PREPARE', 'ACT'],
      tools: [...SONDE_ASK_TOOL_NAMES, ...SONDE_PREPARE_TOOL_NAMES, ...SONDE_ACT_TOOL_NAMES],
    };
  }

  @Post('conversations')
  createConversation(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConversationDto) {
    return this.conversations.createConversation(user.tenantId, user.id, dto.title);
  }

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.listConversations(user.tenantId, user.id);
  }

  @Get('conversations/:id')
  getConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.getConversation(user.tenantId, user.id, id);
  }

  @Get('conversations/:id/messages')
  listMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.listMessages(user.tenantId, user.id, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.runtime.sendMessage(user.tenantId, user.id, id, dto.content, { permissions: user.permissions, context: dto.context });
  }

  @Post('conversations/:id/messages/stream')
  async streamMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    // Läuft VOR jedem SSE-Header — eine fremde/nicht existierende Konversation liefert
    // weiterhin ein echtes 404 über den globalen OrbitExceptionFilter, exakt wie beim
    // synchronen Endpunkt (sobald `Content-Type: text/event-stream` einmal gesendet ist,
    // lässt sich der HTTP-Status nicht mehr ändern).
    await this.conversations.getConversation(user.tenantId, user.id, id);

    // `@Res()` hands full control to us, but Nest still applies its
    // default-status-per-verb behavior (201 for POST) unless a status is
    // set explicitly — an SSE stream is a successful GET-like read, not a
    // resource creation, so 200 is correct here.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (event: CopilotStreamEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    await this.runtime.streamMessage(user.tenantId, user.id, id, dto.content, emit, { permissions: user.permissions, context: dto.context });
    res.end();
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.conversations.deleteConversation(user.tenantId, user.id, id);
  }
}
