import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';
const TEXT = 'Wir sind ein Meisterbetrieb für Heizung und Sanitär in Köln. Montag bis Freitag von 7 bis 16 Uhr erreichbar, Notdienst rund um die Uhr. Keine Elektroarbeiten.';

/** Profil aus Text vorschlagen (AUT-10): der Vorschlag wird bereinigt und nie gespeichert; ohne echte KI gibt es ehrlich keinen. */
describe('Profil-Vorschlag aus Text (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: MockLLMProvider;
  let tenantId: string;
  let token: string;
  let resolveSpy: jest.SpyInstance | undefined;
  const api = () => request(app.getHttpServer());
  const post = (text: string) => api().post('/api/v1/tenant/profile/suggest').set({ Authorization: `Bearer ${token}` }).send({ text });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    llm = app.get(LLM_PROVIDER);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Sug ${suffix.slice(0, 8)}`, slug: `e2e-sug-${suffix}`, adminEmail: `a-${suffix}@e2e-sug.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
    tenantId = tenant.id;
    token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
  });
  afterEach(() => {
    resolveSpy?.mockRestore();
    resolveSpy = undefined;
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  it('ohne echten KI-Anbieter gibt es keinen Vorschlag (503) – nichts wird simuliert', async () => {
    const res = await post(TEXT).expect(503);
    expect(res.body).toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });

  it('ein zu kurzer Text wird abgewiesen', async () => {
    await post('Kurz').expect(400);
  });

  it('liefert einen bereinigten Vorschlag und speichert nichts', async () => {
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (r: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(r) };
    resolveSpy = jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never);
    llm.seedResponse({
      toolCalls: [
        {
          toolCallId: randomUUID(),
          toolName: 'submit_profile_suggestion',
          input: { industry: 'Heizung und Sanitär', services: ['Heizungswartung', 'Badsanierung'], exclusions: ['Elektroarbeiten'], serviceArea: 'Köln', openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '07:00', to: '16:00' }], emergencyService: true },
        },
      ],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
    const res = await post(TEXT).expect(200);
    expect(res.body.fields).toEqual(['industry', 'services', 'exclusions', 'serviceArea', 'openingHours', 'emergencyService']);
    expect(res.body.suggestion).toMatchObject({ industry: 'Heizung und Sanitär', exclusions: ['Elektroarbeiten'], emergencyService: true });
    // Der Vorschlag ist nur ein Vorschlag: im Profil steht danach nichts.
    expect(await prisma.forTenantId(tenantId).tenantProfile.findUnique({ where: { tenantId } })).toBeNull();
  });

  it('die Antwort einer Person ohne Berechtigung wird abgewiesen', async () => {
    await api().post('/api/v1/tenant/profile/suggest').send({ text: TEXT }).expect(401);
  });
});
