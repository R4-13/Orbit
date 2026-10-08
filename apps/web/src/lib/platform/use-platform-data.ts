'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformFetch } from './platform-client';

export interface PlatformOverview {
  environment: string;
  generatedAt: string;
  tenants: { total: number; byStatus: Record<string, number> };
  platformIdentities: { active: number; disabled: number };
  activePlatformSessions: number;
  platformAuditEventsLast24h: number;
  notYetAvailable: string[];
}

export interface PlatformTenantRow {
  tenantId: string;
  displayName: string;
  slug: string;
  lifecycleStatus: string;
  userCount: number;
  deletionRequested: boolean;
  suspensionScopes: string[];
  featureCohorts: string[];
  createdAt: string;
}

export interface TenantLifecyclePreview {
  tenantId: string;
  current: { status: string; suspensionScopes: string[]; featureCohorts: string[] };
  target: { status: string; suspensionScopes: string[]; featureCohorts: string[] };
  effects: string[];
  activeUsers: number;
  /** Bindet die Bestätigung an genau die angezeigte Wirkung. */
  confirmationToken: string;
}

export interface PlatformAuditRow {
  id: string;
  at: string;
  eventType: string;
  actorUserId: string | null;
  actorRoles: string[];
  targetType: string | null;
  targetId: string | null;
  targetTenantId: string | null;
  reason: string | null;
  supportSessionId: string | null;
}

export interface KillSwitchRow {
  key: string;
  title: string;
  effect: string;
  engaged: boolean;
  reason: string | null;
  changedAt: string | null;
  version: number;
}

export interface ConnectorRow {
  connectorKey: string;
  name: string;
  provider: string;
  category: string;
  lifecycle: string;
  reason: string | null;
  version: number;
  activeConnections: number;
  tenantsAffected: number;
  connectionHealth: { total: number; connected: number; problems: number };
}

export interface ConnectorImpact {
  activeConnections: number;
  tenantsAffected: number;
  [key: string]: unknown;
}

export interface AiOverview {
  adapters: string[];
  providers: Array<{ providerKey: string; displayName: string; adapterKey: string; lifecycle: string; supportedRegions: string[] }>;
  models: Array<{ id: string; providerKey: string; providerModelId: string; displayName: string; lifecycle: string; evaluationStatus: string; costInputPerMtok: number | null; costOutputPerMtok: number | null; costCurrency: string }>;
  profiles: Array<{ id: string; profileKey: string; version: number; purpose: string; fallbackMode: string; lifecycle: string }>;
  routes: Array<{ id: string; modelProfileKey: string; environment: string; tenantScope: string | null; primaryModelId: string; fallbackModelIds: string[]; fallbackMode: string; trafficPercent: number; active: boolean; version: number }>;
  connections: Array<{ id: string; providerKey: string; environment: string; credentialType: string; lifecycle: string; lastHealthStatus: string | null; allowedProfileKeys: string[] }>;
  health: Array<{ providerKey: string; modelRef: string; environment: string; status: string; consecutiveFailures: number }>;
}

export interface AiUsageRow {
  key: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
  avgLatencyMs: number | null;
}

export interface DiagnosticProjectionView {
  caseId: string;
  tenantId: string;
  caseStatus: string;
  caseRevision: number;
  generatedAt: string;
  planRevisions: Array<{ planId: string; revision: number; status: string; source: string; blueprintKey?: string; blueprintVersion?: string; createdAt: string }>;
  nodes: Array<{ planRevision: number; nodeKey: string; type: string; state: string; attempts: number; executionMode?: string; errorCode?: string; errorMessage?: string; retryAt?: string }>;
  actions: Array<{ intentId: string; nodeKey: string; capabilityKey: string; purpose?: string; status: string; errorCode?: string; receipts: Array<{ status: string; executionMode: string }> }>;
  agentRuns: Array<{ id: string; agentType: string; status: string }>;
  correlations: Array<{ emailMessageId: string; status: string; rule: string }>;
}

export interface RuntimeQueueRow {
  name: string;
  status: 'OK' | 'DEGRADED' | 'DOWN';
  note: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  workers: number;
  oldestWaitingAgeSec: number | null;
}

export interface RuntimeHealthView {
  status: 'OK' | 'DEGRADED' | 'DOWN';
  checkedAt: string;
  queues: RuntimeQueueRow[];
}

/** Betriebszustand ändert sich laufend: alle 15 Sekunden neu messen, solange die Seite offen ist. */
export const useRuntimeHealth = (enabled = true) => useQuery({ queryKey: ['platform', 'runtime'], queryFn: () => platformFetch<RuntimeHealthView>('/runtime'), enabled, refetchInterval: 15_000 });

export const usePlatformOverview = () => useQuery({ queryKey: ['platform', 'overview'], queryFn: () => platformFetch<PlatformOverview>('/overview') });
export const usePlatformTenants = () => useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => platformFetch<PlatformTenantRow[]>('/tenants') });
export const useAiOverview = (enabled = true) => useQuery({ queryKey: ['platform', 'ai'], queryFn: () => platformFetch<AiOverview>('/ai/overview'), enabled });
export const useAiUsage = (enabled: boolean) => useQuery({ queryKey: ['platform', 'ai', 'usage'], queryFn: () => platformFetch<AiUsageRow[]>('/ai/usage?groupBy=profileKey'), enabled });
export const useKillSwitches = () => useQuery({ queryKey: ['platform', 'kill-switches'], queryFn: () => platformFetch<KillSwitchRow[]>('/kill-switches') });
export const useConnectors = () => useQuery({ queryKey: ['platform', 'connectors'], queryFn: () => platformFetch<ConnectorRow[]>('/connectors') });

export function useAuditTrail(filter: { eventType?: string; targetTenantId?: string }, before?: string) {
  const params = new URLSearchParams({ limit: '50' });
  if (filter.eventType) params.set('eventType', filter.eventType);
  if (filter.targetTenantId) params.set('targetTenantId', filter.targetTenantId);
  if (before) params.set('before', before);
  return useQuery({ queryKey: ['platform', 'audit', params.toString()], queryFn: () => platformFetch<{ items: PlatformAuditRow[]; nextBefore?: string }>(`/audit?${params.toString()}`) });
}


export interface SupportSessionRow {
  id: string;
  targetTenantId: string;
  operatorUserId: string;
  reasonCode: string;
  freeTextReason: string;
  ticketRef: string | null;
  mode: string;
  scopes: string[];
  status: 'REQUESTED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLOSED';
  requestedMinutes: number;
  requiresApproval: boolean;
  approvedByUserId: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  version: number;
}

export interface SupportTenantContextView {
  tenantId: string;
  status: string;
  suspensionScopes: string[];
  featureCohorts: string[];
  policies: Array<{ action: string; mode: string }>;
  integrations: Array<{ connectorType: string; status: string }>;
}

export const useSupportSessions = () => useQuery({ queryKey: ['platform', 'support-sessions'], queryFn: () => platformFetch<SupportSessionRow[]>('/support-sessions') });


export type FlagValue = boolean | string | number;

export interface FlagRow {
  key: string;
  description: string;
  lifecycle: string;
  defaultValue: FlagValue;
  environmentOverrides: Array<{ environment: string; value: FlagValue }>;
  cohortOverrides: Array<{ cohort: string; value: FlagValue; percent?: number }>;
  tenantOverrides: Array<{ tenantId: string; value: FlagValue }>;
  owner: string;
  expiresAt: string | null;
  exposeToTenant: boolean;
  version: number;
  updatedAt: string;
}

export interface FlagPreview {
  key: string;
  version: number;
  tenants: number;
  distribution: Array<{ value: FlagValue; count: number }>;
}

export const useFlags = () => useQuery({ queryKey: ['platform', 'features'], queryFn: () => platformFetch<FlagRow[]>('/features') });


export interface IdentityRow {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roles: string[];
  lastLoginAt?: string;
  createdAt: string;
}

export const useIdentities = (enabled = true) => useQuery({ queryKey: ['platform', 'identities'], queryFn: () => platformFetch<IdentityRow[]>('/identities'), enabled });

/** Schreibende Plattformaktion; invalidiert danach alle Plattformdaten, damit die Anzeige den bestätigten Serverstand zeigt. */
export function usePlatformMutation<TInput, TResult = unknown>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: run, onSuccess: () => client.invalidateQueries({ queryKey: ['platform'] }) });
}
