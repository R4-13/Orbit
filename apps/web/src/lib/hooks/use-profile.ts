import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { useAuth } from '../auth-context';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
}

/** Anzeigename des angemeldeten Nutzers (UI v2 GAP-08). Der Cache-Schlüssel enthält Mandant und Nutzer. */
export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.tenantId, user?.id],
    queryFn: () => apiFetch<UserProfile>('/v1/auth/me'),
    enabled: Boolean(user),
    staleTime: 10 * 60 * 1000,
  });
}
