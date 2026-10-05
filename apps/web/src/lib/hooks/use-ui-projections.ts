import { useQuery } from '@tanstack/react-query';
import type {
  ActivityFeed,
  ApprovalDetail,
  ApprovalQueueItem,
  CaseListFilter,
  CaseListItem,
  CaseListResponse,
  InboxDetail,
  InboxFilter,
  InboxListResponse,
  LeadFilter,
  LeadListResponse,
  TaskListResponse,
} from '@orbit/shared';
import { apiFetch } from '../api-client';
import { useAuth } from '../auth-context';

/** Alle Listen-Hooks hängen Mandant und Nutzer in den Cache-Schlüssel (UI v2 AC-18: kein Tenantflash, keine fremden Daten im Cache). */
function useScope() {
  const { user } = useAuth();
  return { enabled: Boolean(user), scope: [user?.tenantId, user?.id] as const };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function useInboxItems(params: { filter: InboxFilter; page: number; q: string; excluded?: boolean }) {
  const { enabled, scope } = useScope();
  return useQuery({
    queryKey: ['inbox', ...scope, params],
    queryFn: () => apiFetch<InboxListResponse>(`/v1/inbox/items${qs({ filter: params.filter, page: params.page, q: params.q, excluded: params.excluded })}`),
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
}

export function useInboxItem(id: string | null) {
  const { enabled, scope } = useScope();
  return useQuery({ queryKey: ['inbox', ...scope, 'item', id], queryFn: () => apiFetch<InboxDetail>(`/v1/inbox/items/${id}`), enabled: enabled && id !== null });
}

export function useApprovalQueue(scopeKind: 'MINE' | 'TEAM') {
  const { enabled, scope } = useScope();
  return useQuery({
    queryKey: ['approvals', ...scope, 'queue', scopeKind],
    queryFn: () => apiFetch<ApprovalQueueItem[]>(`/v1/approvals/queue?scope=${scopeKind}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useApprovalDetail(id: string | null) {
  const { enabled, scope } = useScope();
  return useQuery({ queryKey: ['approvals', ...scope, 'detail', id], queryFn: () => apiFetch<ApprovalDetail>(`/v1/approvals/${id}/detail`), enabled: enabled && id !== null });
}

export function useActivityFeed(params: { area: 'ALL' | 'FINANCE' | 'SALES'; days: number; results: boolean; page: number; caseId?: string }) {
  const { enabled, scope } = useScope();
  return useQuery({
    queryKey: ['activity', ...scope, params],
    queryFn: () => apiFetch<ActivityFeed>(`/v1/activity/feed${qs({ area: params.area, days: params.days, results: params.results, page: params.page, caseId: params.caseId })}`),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useCaseList(params: { filter: CaseListFilter; type?: 'FINANCE' | 'SALES'; page: number; q: string }) {
  const { enabled, scope } = useScope();
  return useQuery({
    queryKey: ['cases', ...scope, 'overview', params],
    queryFn: () => apiFetch<CaseListResponse>(`/v1/cases/overview${qs({ filter: params.filter, type: params.type, page: params.page, q: params.q })}`),
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
}

export function useCaseSummary(id: string | null) {
  const { enabled, scope } = useScope();
  return useQuery({ queryKey: ['cases', ...scope, 'summary', id], queryFn: () => apiFetch<CaseListItem>(`/v1/cases/${id}/summary`), enabled: enabled && id !== null });
}

export function useTaskList(params: { scope: 'MINE' | 'TEAM'; done: boolean }) {
  const { enabled, scope } = useScope();
  const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Berlin';
  return useQuery({
    queryKey: ['tasks', ...scope, 'overview', params, timezone],
    queryFn: () => apiFetch<TaskListResponse>(`/v1/tasks/overview${qs({ scope: params.scope, done: params.done, timezone })}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useLeadList(params: { filter: LeadFilter; q: string }) {
  const { enabled, scope } = useScope();
  const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Berlin';
  return useQuery({
    queryKey: ['leads', ...scope, 'overview', params, timezone],
    queryFn: () => apiFetch<LeadListResponse>(`/v1/leads/overview${qs({ filter: params.filter, q: params.q, timezone })}`),
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
}
