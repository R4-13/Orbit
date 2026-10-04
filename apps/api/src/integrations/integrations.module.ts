import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { ConnectorStatusService } from './connector-status.service';
import { GmailConnectorService } from './gmail-connector.service';
import { IntegrationsCallbackController } from './integrations-callback.controller';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuth2Service } from './oauth2.service';

@Module({
  imports: [
    // Own registration (not importing AuthModule) to keep this module self-contained — reuses the
    // same JWT_SECRET (already a trusted platform signing secret), see OAuthStateService's header
    // comment for why that's safe despite the distinct purpose.
    JwtModule.registerAsync({
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => ({ secret: env.JWT_SECRET }),
    }),
  ],
  controllers: [IntegrationsController, IntegrationsCallbackController],
  providers: [IntegrationsService, OAuth2Service, OAuthStateService, GmailConnectorService, ConnectorStatusService],
  // GmailConnectorService exported for GmailPollAdapter (ChannelSyncModule, Increment C) — the
  // only other consumer of this service besides IntegrationsController/-CallbackController.
  exports: [IntegrationsService, GmailConnectorService],
})
export class IntegrationsModule {}
