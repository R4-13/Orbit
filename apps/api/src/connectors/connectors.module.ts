import { Global, Module } from '@nestjs/common';
import { IntegrationUnavailableError } from '@orbit/shared';
import {
  MockCalendarConnector,
  MockFinanceConnector,
  MockMailConnector,
  MockOcrProvider,
} from '@orbit/integration-core';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { HubSpotService } from './hubspot.service';
import { PersistentMockCrmConnector } from './persistent-mock-crm.connector';
import { TenantRoutedCrmConnector } from './tenant-routed-crm.connector';
import { SecurityModule } from '../security/security.module';
import { CALENDAR_CONNECTOR, CRM_CONNECTOR, FINANCE_CONNECTOR, MAIL_CONNECTOR, OCR_PROVIDER } from './connectors.tokens';

/**
 * Wires each *_CONNECTOR/*_PROVIDER env selection (@orbit/config) to a
 * concrete @orbit/integration-core implementation. Only "mock" exists
 * today (see docs/INTEGRATIONS.md) — selecting a real provider fails fast
 * at boot with a clear IntegrationUnavailableError rather than silently
 * falling back to the mock.
 */
@Global()
@Module({
  imports: [SecurityModule],
  providers: [
    HubSpotService,
    {
      provide: FINANCE_CONNECTOR,
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => {
        if (env.FINANCE_CONNECTOR !== 'mock') {
          throw new IntegrationUnavailableError(
            `FinanceConnector "${env.FINANCE_CONNECTOR}" is not implemented yet — see docs/INTEGRATIONS.md.`,
          );
        }
        return new MockFinanceConnector();
      },
    },
    {
      provide: OCR_PROVIDER,
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => {
        if (env.OCR_PROVIDER !== 'mock') {
          throw new IntegrationUnavailableError(
            `OcrProvider "${env.OCR_PROVIDER}" is not implemented yet — see docs/INTEGRATIONS.md.`,
          );
        }
        return new MockOcrProvider();
      },
    },
    {
      provide: CRM_CONNECTOR,
      inject: [ORBIT_ENV, PrismaService, HubSpotService],
      useFactory: (env: OrbitEnv, prisma: PrismaService, hubspot: HubSpotService) => {
        if (env.CRM_CONNECTOR !== 'mock') {
          throw new IntegrationUnavailableError(
            `CrmConnector "${env.CRM_CONNECTOR}" is not implemented yet — see docs/INTEGRATIONS.md.`,
          );
        }
        // Je Betrieb: mit verbundenem HubSpot dorthin, sonst die gekennzeichnete Test-Ablage.
        return new TenantRoutedCrmConnector(new PersistentMockCrmConnector(prisma), hubspot, prisma);
      },
    },
    {
      provide: CALENDAR_CONNECTOR,
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => {
        if (env.CALENDAR_CONNECTOR !== 'mock') {
          throw new IntegrationUnavailableError(
            `CalendarConnector "${env.CALENDAR_CONNECTOR}" is not implemented yet — see docs/INTEGRATIONS.md.`,
          );
        }
        return new MockCalendarConnector();
      },
    },
    {
      provide: MAIL_CONNECTOR,
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => {
        if (env.MAIL_CONNECTOR !== 'mock') {
          throw new IntegrationUnavailableError(
            `MailConnector "${env.MAIL_CONNECTOR}" is not implemented yet — see docs/INTEGRATIONS.md.`,
          );
        }
        return new MockMailConnector();
      },
    },
  ],
  exports: [FINANCE_CONNECTOR, OCR_PROVIDER, CRM_CONNECTOR, CALENDAR_CONNECTOR, MAIL_CONNECTOR, HubSpotService],
})
export class ConnectorsModule {}
