'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@orbit/ui';
import { ApiError } from '../../../../lib/api-client';
import {
  useResetTenantBranding,
  useTenantBranding,
  useUpdateTenantBranding,
  type UpdateTenantBrandingInput,
} from '../../../../lib/hooks/use-tenant-branding';

/** Spiegelt die Standard-ORION-Palette aus apps/web/src/app/globals.css — Ausgangswerte für die Farbwähler, solange kein Tenant-Override existiert. */
const DEFAULTS = {
  primaryColor: '#1d4ed8',
  primaryForeground: '#ffffff',
  secondaryColor: '#0f172a',
  secondaryForeground: '#ffffff',
  accentColor: '#0891b2',
  accentForeground: '#ecfeff',
  navigationBackground: '#0f172a',
  navigationForeground: '#94a3b8',
};

type FormState = {
  companyDisplayName: string;
  logoUrl: string;
  logoMarkUrl: string;
} & typeof DEFAULTS;

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} className="font-mono text-xs" />
      </div>
    </div>
  );
}

export default function AdminBrandingPage() {
  const { data: brandingResponse, isLoading } = useTenantBranding();
  const update = useUpdateTenantBranding();
  const reset = useResetTenantBranding();
  const [form, setForm] = useState<FormState>({ companyDisplayName: '', logoUrl: '', logoMarkUrl: '', ...DEFAULTS });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const branding = brandingResponse?.branding;
    setForm({
      companyDisplayName: branding?.companyDisplayName ?? '',
      logoUrl: branding?.logoUrl ?? '',
      logoMarkUrl: branding?.logoMarkUrl ?? '',
      primaryColor: branding?.primaryColor ?? DEFAULTS.primaryColor,
      primaryForeground: branding?.primaryForeground ?? DEFAULTS.primaryForeground,
      secondaryColor: branding?.secondaryColor ?? DEFAULTS.secondaryColor,
      secondaryForeground: branding?.secondaryForeground ?? DEFAULTS.secondaryForeground,
      accentColor: branding?.accentColor ?? DEFAULTS.accentColor,
      accentForeground: branding?.accentForeground ?? DEFAULTS.accentForeground,
      navigationBackground: branding?.navigationBackground ?? DEFAULTS.navigationBackground,
      navigationForeground: branding?.navigationForeground ?? DEFAULTS.navigationForeground,
    });
  }, [brandingResponse]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    const input: UpdateTenantBrandingInput = {
      companyDisplayName: form.companyDisplayName || undefined,
      logoUrl: form.logoUrl || undefined,
      logoMarkUrl: form.logoMarkUrl || undefined,
      primaryColor: form.primaryColor,
      primaryForeground: form.primaryForeground,
      secondaryColor: form.secondaryColor,
      secondaryForeground: form.secondaryForeground,
      accentColor: form.accentColor,
      accentForeground: form.accentForeground,
      navigationBackground: form.navigationBackground,
      navigationForeground: form.navigationForeground,
    };
    try {
      await update.mutateAsync(input);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Das Branding konnte nicht gespeichert werden.');
    }
  }

  async function handleReset() {
    setError(null);
    try {
      await reset.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Das Zurücksetzen ist fehlgeschlagen.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Branding &amp; Erscheinungsbild</h1>
      <p className="mt-1 text-sm text-slate-500">
        Logo und Farben Ihres Tenants — wirkt sofort auf die gesamte Anwendung, ohne Code-Änderung. Ohne eigene
        Konfiguration gilt das Standard-ORION-Theme.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="mt-6 text-sm text-slate-400">Wird geladen …</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Firmenname &amp; Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="branding-name">Firmenname (Anzeige)</Label>
                <Input
                  id="branding-name"
                  value={form.companyDisplayName}
                  onChange={(event) => set('companyDisplayName', event.target.value)}
                  placeholder="z. B. ACME GmbH"
                />
              </div>
              <div>
                <Label htmlFor="branding-logo">Logo-URL</Label>
                <Input
                  id="branding-logo"
                  value={form.logoUrl}
                  onChange={(event) => set('logoUrl', event.target.value)}
                  placeholder="https://…/logo.svg"
                />
              </div>
              <div>
                <Label htmlFor="branding-logo-mark">Kompaktes Logo/Zeichen-URL (optional)</Label>
                <Input
                  id="branding-logo-mark"
                  value={form.logoMarkUrl}
                  onChange={(event) => set('logoMarkUrl', event.target.value)}
                  placeholder="https://…/mark.svg"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vorschau</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-slate-200">
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: form.navigationBackground }}>
                  <span className="text-xs font-semibold" style={{ color: form.navigationForeground }}>
                    {form.companyDisplayName || 'Project ORBIT'}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs font-medium"
                    style={{ backgroundColor: form.primaryColor, color: form.primaryForeground }}
                  >
                    Primärer Button
                  </button>
                  <button
                    type="button"
                    className="ml-2 rounded-md px-3 py-1.5 text-xs font-medium"
                    style={{ backgroundColor: form.accentColor, color: form.accentForeground }}
                  >
                    Sonde-Akzent
                  </button>
                  <div>
                    <Badge tone="success">Automatisiert</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Primärfarbe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField label="Hintergrund" value={form.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField label="Vordergrund (Text/Icons)" value={form.primaryForeground} onChange={(v) => set('primaryForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Akzentfarbe (Sonde)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField label="Hintergrund" value={form.accentColor} onChange={(v) => set('accentColor', v)} />
              <ColorField label="Vordergrund" value={form.accentForeground} onChange={(v) => set('accentForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sekundärfarbe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField label="Hintergrund" value={form.secondaryColor} onChange={(v) => set('secondaryColor', v)} />
              <ColorField label="Vordergrund" value={form.secondaryForeground} onChange={(v) => set('secondaryForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Navigation (Sidebar)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField label="Hintergrund" value={form.navigationBackground} onChange={(v) => set('navigationBackground', v)} />
              <ColorField label="Vordergrund" value={form.navigationForeground} onChange={(v) => set('navigationForeground', v)} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={handleSave} disabled={update.isPending}>
          Speichern
        </Button>
        <Button variant="ghost" onClick={handleReset} disabled={reset.isPending}>
          Auf Standard zurücksetzen
        </Button>
      </div>
    </div>
  );
}
