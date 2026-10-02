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

/**
 * These three CSS variables hold space-separated "R G B" channels, not a
 * hex string (see the comment on `--brand-primary` in globals.css) — only
 * they are ever combined with a Tailwind opacity modifier (`bg-brand/10`,
 * `text-nav-foreground/80`, ...). The admin branding form's `<input
 * type="color">` always produces a `#rrggbb` hex string, so it has to be
 * converted before landing in one of these three variables; the other
 * five branding fields are plain hex and passed through unchanged.
 */
const CHANNEL_CSS_VARIABLES = new Set(['--brand-primary', '--brand-accent', '--nav-foreground']);

function hexToRgbChannels(hex: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

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
          const cssValue = CHANNEL_CSS_VARIABLES.has(cssVar) ? (hexToRgbChannels(value) ?? value) : value;
          root.style.setProperty(cssVar, cssValue);
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

/** Mirrors ALLOWED_LOGO_CONTENT_TYPES in apps/api/src/branding/dto/request-logo-upload-url.dto.ts — kept in sync by hand, not a shared import (no existing packages/shared bridge for API DTO constants to the frontend). */
export const ALLOWED_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_LOGO_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export function useRequestLogoUploadUrl() {
  return useMutation({
    mutationFn: (input: { fileName: string; contentType: string }) =>
      apiFetch<{ uploadUrl: string; publicUrl: string }>('/v1/tenant/branding/logo-upload-url', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

/**
 * Client-side validation + the two-step upload (request a presigned URL,
 * then PUT the bytes directly to object storage — the file never transits
 * our own API, same as DocumentsModule's uploads) — pulled out of the
 * branding page component so it's testable on its own and the page only
 * has to wire it to local state.
 */
export async function uploadLogoFile(
  file: File,
  requestUploadUrl: (input: { fileName: string; contentType: string }) => Promise<{ uploadUrl: string; publicUrl: string }>,
): Promise<string> {
  if (!(ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(`Nicht unterstütztes Dateiformat „${file.type || 'unbekannt'}“ — erlaubt sind PNG, JPEG oder WebP.`);
  }
  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error(`Datei zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB) — maximal 2 MB.`);
  }

  const { uploadUrl, publicUrl } = await requestUploadUrl({ fileName: file.name, contentType: file.type });

  const response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!response.ok) {
    throw new Error('Der Upload zum Objektspeicher ist fehlgeschlagen.');
  }

  return publicUrl;
}
