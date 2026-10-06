import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { PlatformControlService } from './platform-control.service';

/**
 * Mandantensicht auf Feature Flags: nur Flags, die die Plattform ausdrücklich für Mandanten freigibt (`exposeToTenant`), und nur der für den eigenen
 * Mandanten geltende Wert – nie Kohorten, Overrides oder andere Mandanten.
 */
@ApiTags('features')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'features' })
export class TenantFeaturesController {
  constructor(private readonly control: PlatformControlService) {}

  @Get()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<{ flags: Record<string, boolean | string | number> }> {
    return { flags: await this.control.evaluateExposed(user.tenantId) };
  }
}
