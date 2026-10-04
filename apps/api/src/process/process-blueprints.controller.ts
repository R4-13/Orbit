import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ProcessBlueprint, TenantProcessActivation } from '@orbit/domain';
import { PERMISSIONS } from '@orbit/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { BlueprintRegistryService } from './blueprint-registry.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { ImportBlueprintDto, TransitionBlueprintDto } from './dto/process-dtos';

/**
 * Process Studio backend (Amendment 02 §8 / §17.4): schema-validated JSON import, lifecycle, tenant activation.
 * Blueprints are data; this surface never edits engine code. Same sensitivity as policy configuration.
 */
@ApiTags('process-blueprints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.POLICY_MANAGE)
@Controller({ path: 'process-blueprints' })
export class ProcessBlueprintsController {
  constructor(
    private readonly registry: BlueprintRegistryService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Array<ProcessBlueprint & { active: boolean }>> {
    return this.registry.list(user.tenantId);
  }

  /** What the tenant can actually execute right now, with reasons (Amendment 02 §9.2). */
  @Get('capabilities')
  async listCapabilities(@CurrentUser() user: AuthenticatedUser) {
    const executability = await this.capabilities.executabilityFor(user.tenantId);
    return [...this.capabilities.catalogue().values()].map((capability) => ({ ...capability, executability: executability.get(capability.key) }));
  }

  @Post('validate')
  validate(@Body() dto: ImportBlueprintDto) {
    const { valid, issues } = this.registry.validate(dto.definition);
    return { valid, issues };
  }

  @Post()
  async importDraft(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportBlueprintDto) {
    const { row, validation } = await this.registry.importDraft(user.tenantId, user.id, dto.definition);
    return { id: row.id, key: row.key, version: row.version, status: row.status, definitionHash: row.definitionHash, validation };
  }

  @Get(':key/:version')
  get(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Param('version') version: string): Promise<ProcessBlueprint> {
    return this.registry.get(user.tenantId, key, version);
  }

  @Post(':key/:version/transition')
  transition(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Param('version') version: string, @Body() dto: TransitionBlueprintDto): Promise<ProcessBlueprint> {
    return this.registry.transition(user.tenantId, user.id, key, version, dto.to);
  }

  @Post(':key/:version/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Param('version') version: string): Promise<TenantProcessActivation> {
    return this.registry.activate(user.tenantId, user.id, key, version);
  }

  @Delete(':key/activation')
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    await this.registry.deactivate(user.tenantId, user.id, key);
    return { deactivated: true };
  }
}
