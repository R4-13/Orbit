import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@orbit/shared';
import { AIProviderKey } from '@orbit/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { AiProvidersService } from './ai-providers.service';
import { UpsertAiProviderConnectionDto } from './dto/upsert-ai-provider-connection.dto';

/**
 * §44 des Unified-Evolution-Konzepts ("Provider Administration UI") —
 * Backend für `/admin/ai-providers`. Gated über `INTEGRATION_CONFIGURE`
 * (dieselbe Sensibilität wie andere Drittsystem-Zugangsdaten in
 * `IntegrationsController`), nicht über eine neue, eigene Permission —
 * ein BYOK-LLM-Credential ist fachlich dieselbe Art Entscheidung wie ein
 * DATEV-/Lexware-Zugang.
 */
@ApiTags('ai-providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INTEGRATION_CONFIGURE)
@Controller({ path: 'ai-providers' })
export class AiProvidersController {
  constructor(private readonly aiProviders: AiProvidersService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.aiProviders.getStatus(user.tenantId);
  }

  @Put(':providerKey')
  upsertConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('providerKey', new ParseEnumPipe(AIProviderKey)) providerKey: AIProviderKey,
    @Body() dto: UpsertAiProviderConnectionDto,
  ) {
    return this.aiProviders.upsertConnection(user.tenantId, user.id, providerKey, dto.apiKey, dto.model);
  }

  @Post('test')
  testConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.aiProviders.testConnection(user.tenantId, user.id);
  }

  @Delete()
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.aiProviders.disconnect(user.tenantId, user.id);
  }
}
