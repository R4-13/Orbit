import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { IncomingEmailDto } from './dto/incoming-email.dto';
import { IntakeService, type IntakeResult } from './intake.service';

/**
 * Simulates the one entry point this MVP has no real connector for: an
 * inbound email arriving (§23/§29 — real Microsoft Graph/Gmail webhooks
 * require provider credentials this environment doesn't have, see
 * docs/KNOWN_LIMITATIONS.md). Deliberately gated only by authentication,
 * not a specific RBAC permission (`@RequirePermissions`): this endpoint
 * stands in for a *system* trigger (a mail webhook, a scheduled sync),
 * not a fine-grained human action — a real webhook handler would
 * authenticate via provider signature verification instead of a user's
 * JWT entirely. Any authenticated tenant user may trigger the demo.
 */
@ApiTags('intake')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'intake' })
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('emails')
  @HttpCode(HttpStatus.CREATED)
  handleIncomingEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IncomingEmailDto,
  ): Promise<IntakeResult> {
    return this.intake.handleIncomingEmail(user.tenantId, user.id, dto);
  }
}
