import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantBranding } from '@orbit/domain';
import { apiFetch } from '../api-client';

export interface UpdateTenantBrandingInput {
  companyDisplayName?: string;
  logoUrl?: string;
  logoMarkUrl?: string;
  primaryColor?: string;
  primaryForeground?: string;
  secondaryColor?: string;
  secondaryForeground?: string;
  accentColor?: string;
  accentForeground?: string;
  navigationBackground?: string;
  navigationForeground?: string;
}

/** Maps TenantBranding fields onto the CSS custom properties defined in app/globals.css. Only non-null fields are overridden — everything else keeps the default ORION theme. */
const CSS_VARIABLE_BY_FIELD: Partial<Record<keyof TenantBranding, string>> = {
  primaryColor: '--brand-primary',
  primaryForeground: '--brand-primary-foreground',
  secondaryColor: '--brand-secondary',
  secondaryForeground: '--brand-secondary-foreground',
  accentColor: '--brand-accent',
  accentForeground: '--brand-accent-foreground',
  navigationBackground: '--nav-background',
  navigationForeground: '--nav-foreground',
};

export function useTenantBranding() {
  return useQuery({
    queryKey: ['tenant-branding'],
    queryFn: () => apiFetch<{ branding: TenantBranding | null }>('/v1/tenant/branding'),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Applies a tenant's branding as CSS custom-property overrides on
 * `:root` (docs/ORION_UI_UX_DEVELOPMENT_SPECIFICATION_v1.md §24.2/§24.3).
 * Called once from the authenticated app shell. Reverts every overridden
 * property on unmount/tenant-change so a stale override can never survive
 * into a different tenant's session (§24.4).
 */
export function useApplyTenantTheme(branding: TenantBranding | null | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const applied: string[] = [];

    if (branding) {
      for (const [field, cssVar] of Object.entries(CSS_VARIABLE_BY_FIELD) as [keyof TenantBranding, string][]) {
        const value = branding[field];
        if (typeof value === 'string' && value.length > 0) {
          root.style.setProperty(cssVar, value);
          applied.push(cssVar);
        }
      }
    }

    return () => {
      for (const cssVar of applied) {
        root.style.removeProperty(cssVar);
      }
    };
  }, [branding]);
}

export function useUpdateTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantBrandingInput) =>
      apiFetch<TenantBranding>('/v1/tenant/branding', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-branding'] }),
  });
}

export function useResetTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/v1/tenant/branding', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-branding'] }),
  });
}
