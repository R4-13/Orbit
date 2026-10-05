import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantBranding } from '@orbit/domain';
import { apiFetch } from '../api-client';
import { useAuth } from '../auth-context';
import { normalizeTheme } from '../theme-contrast';

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
  // Der Cache-Schlüssel enthält den Mandanten: nach einem Mandantenwechsel im selben Browser wird nie das Erscheinungsbild des
  // vorigen Mandanten wiederverwendet (UI v2 §21.3, AC-18).
  const { user } = useAuth();
  return useQuery({
    queryKey: ['tenant-branding', user?.tenantId],
    queryFn: () => apiFetch<{ branding: TenantBranding | null }>('/v1/tenant/branding'),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(user),
  });
}

const THEME_CACHE_PREFIX = 'orbit.theme.';

/** Das zuletzt angewendete Erscheinungsbild je Mandant, damit der erste Render nicht erst mit der Standardfarbe aufblitzt. */
function readThemeCache(tenantId: string): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(`${THEME_CACHE_PREFIX}${tenantId}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function writeThemeCache(tenantId: string, variables: Record<string, string>): void {
  try {
    window.localStorage.setItem(`${THEME_CACHE_PREFIX}${tenantId}`, JSON.stringify(variables));
  } catch {
    /* ohne Speicher gibt es nur keinen Sofort-Effekt */
  }
}

function toCssVariables(branding: TenantBranding): Record<string, string> {
  // Unlesbare Kombinationen werden korrigiert, statt Schrift oder Statuswerte zu verstecken (siehe lib/theme-contrast).
  const { values } = normalizeTheme({
    primaryColor: branding.primaryColor,
    primaryForeground: branding.primaryForeground,
    accentColor: branding.accentColor,
    accentForeground: branding.accentForeground,
    navigationBackground: branding.navigationBackground,
    navigationForeground: branding.navigationForeground,
  });
  const resolved: Partial<Record<string, unknown>> = { ...branding, ...values };
  const variables: Record<string, string> = {};
  for (const [field, cssVar] of Object.entries(CSS_VARIABLE_BY_FIELD) as [keyof TenantBranding, string][]) {
    const value = resolved[field];
    if (typeof value === 'string' && value.length > 0) {
      variables[cssVar] = CHANNEL_CSS_VARIABLES.has(cssVar) ? (hexToRgbChannels(value) ?? value) : value;
    }
  }
  return variables;
}

/**
 * Applies a tenant's branding as CSS custom-property overrides on
 * `:root`. Called once from the authenticated app shell. Reverts every overridden
 * property on unmount/tenant-change so a stale override can never survive
 * into a different tenant's session. Beim ersten Render wird – falls vorhanden – das zuletzt für DIESEN Mandanten angewendete Theme
 * sofort gesetzt, danach gilt die geladene (und kontrastgeprüfte) Konfiguration.
 */
export function useApplyTenantTheme(branding: TenantBranding | null | undefined) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  useEffect(() => {
    if (!tenantId || branding !== undefined) return;
    const cached = readThemeCache(tenantId);
    if (!cached) return;
    const root = document.documentElement;
    for (const [cssVar, value] of Object.entries(cached)) root.style.setProperty(cssVar, value);
    return () => {
      for (const cssVar of Object.keys(cached)) root.style.removeProperty(cssVar);
    };
  }, [tenantId, branding]);

  useEffect(() => {
    if (branding === undefined) return;
    const root = document.documentElement;
    const variables = branding ? toCssVariables(branding) : {};
    for (const [cssVar, value] of Object.entries(variables)) root.style.setProperty(cssVar, value);
    if (tenantId) writeThemeCache(tenantId, variables);
    return () => {
      for (const cssVar of Object.keys(variables)) root.style.removeProperty(cssVar);
    };
  }, [branding, tenantId]);
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
