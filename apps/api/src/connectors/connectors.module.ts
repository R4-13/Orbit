import { Global, Module } from '@nestjs/common';
import { IntegrationUnavailableError } from '@orbit/shared';
import { MockFinanceConnector, MockOcrProvider } from '@orbit/integration-core';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { FINANCE_CONNECTOR, OCR_PROVIDER } from './connectors.tokens';

/**
 * Wires the FINANCE_CONNECTOR/OCR_PROVIDER env selection (@orbit/config)
 * to a concrete @orbit/integration-core implementation. Only "mock" exists
 * today (see docs/INTEGRATIONS.md) — selecting a real provider fails fast
 * at boot with a clear IntegrationUnavailableError rather than silently
 * falling back to the mock.
 */
@Global()
@Module({
  providers: [
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
  ],
  exports: [FINANCE_CONNECTOR, OCR_PROVIDER],
})
export class ConnectorsModule {}
