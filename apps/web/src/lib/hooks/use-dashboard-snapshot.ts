import { useQuery } from '@tanstack/react-query';
import type { DashboardPeriod, DashboardSnapshot, DashboardView } from '@orbit/shared';
import { apiFetch } from '../api-client';
import { useAuth } from '../auth-context';

export interface SnapshotLimits {
  attention: number;
  inbox: number;
  tasks: number;
  completed: number;
}

export const DASHBOARD_SNAPSHOT_KEY = ['dashboard', 'snapshot'] as const;

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

/**
 * UI v2 DATA-01: Home liest genau die Projektion, die auch Sonde nutzt. Die Vorschaugrenzen kommen aus der gemessenen
 * Höhe (§6.3) und ändern nur die Menge der Einträge, nie die Zählweise.
 */
export function useDashboardSnapshot(options: { view: DashboardView; period: DashboardPeriod; limits: SnapshotLimits }) {
  const { user } = useAuth();
  const { view, period, limits } = options;
  return useQuery({
    queryKey: [...DASHBOARD_SNAPSHOT_KEY, user?.tenantId, user?.id, view, period, limits],
    queryFn: () => {
      const params = new URLSearchParams({
        view,
        period,
        timezone: localTimezone(),
        attention: String(limits.attention),
        inbox: String(limits.inbox),
        tasks: String(limits.tasks),
        completed: String(limits.completed),
      });
      return apiFetch<DashboardSnapshot>(`/v1/dashboard/snapshot?${params.toString()}`);
    },
    enabled: Boolean(user),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
}
