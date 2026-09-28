import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CopilotConversationService } from './copilot-conversation.service';
import { CopilotRuntimeService } from './copilot-runtime.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SONDE_ASK_TOOL_NAMES } from './tools/sonde.tools';

/**
 * §33 des Master-Dokuments ("Sonde action cards, streaming and API") —
 * Routenschema wörtlich wie dort vorgeschlagen, minus des Streaming-
 * Endpunkts (Phase 8, noch nicht Teil dieser Stufe). Nur `JwtAuthGuard`,
 * keine zusätzliche `RequirePermissions` — Sonde ist laut §25 global für
 * jeden authentifizierten Nutzer verfügbar; welche Tools ein Tool-Aufruf
 * tatsächlich ausführen darf, entscheidet weiterhin die Policy Engine
 * (`COPILOT_READ`), nicht diese Route. Siehe docs/ASSUMPTIONS.md für die
 * bewusst noch nicht umgesetzte volle §32-Berechtigungs-Schnittmenge.
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
    // §32: nur READ/ASK in dieser Phase — PREPARE/ACT/DELEGATE/NAVIGATE folgen mit späteren Phasen.
    return { mode: 'ASK', tools: SONDE_ASK_TOOL_NAMES };
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
    return this.runtime.sendMessage(user.tenantId, user.id, id, dto.content);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.conversations.deleteConversation(user.tenantId, user.id, id);
  }
}
