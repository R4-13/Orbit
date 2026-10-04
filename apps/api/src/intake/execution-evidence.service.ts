import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import type { ExecutionComponentEvidence, ExecutionEvidenceSnapshot } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';

function component(provider: string): ExecutionComponentEvidence {
  // Every provider whose name contains "mock" is a simulation; anything else talked to a real system.
  return { provider, mode: provider.toLowerCase().includes('mock') ? 'SIMULATED' : 'LIVE' };
}

/**
 * Amendment 02 §19.4 — records, at processing time, which parts of a run
 * were live and which simulated, plus the build identity. Stored with the
 * IntakeEvent so a later change of configuration or version can never turn
 * an old proof into "currently live tested".
 */
@Injectable()
export class ExecutionEvidenceService {
  constructor(
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
    private readonly aiProviders: AiProviderResolverService,
  ) {}

  async capture(tenantId: string, input: { channelProvider: string; simulatedChannel: boolean }): Promise<ExecutionEvidenceSnapshot> {
    const llm = await this.aiProviders.resolveForTenant(tenantId);
    return {
      capturedAt: new Date().toISOString(),
      buildCommit: this.env.ORBIT_BUILD_COMMIT || null,
      channel: input.simulatedChannel ? { provider: input.channelProvider, mode: 'SIMULATED' } : { provider: input.channelProvider, mode: 'LIVE' },
      ai: component(llm.providerName),
      // CRM_CONNECTOR=mock is wired to PersistentMockCrmConnector ('mock-persistent') — still a test SoR.
      crm: component(this.env.CRM_CONNECTOR === 'mock' ? 'mock-persistent' : this.env.CRM_CONNECTOR),
      ocr: component(this.env.OCR_PROVIDER),
    };
  }
}
