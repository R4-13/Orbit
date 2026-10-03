'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label } from '@orbit/ui';
import { ApiError, errorMessage } from '../../../../lib/api-client';
import {
  ALLOWED_LOGO_CONTENT_TYPES,
  uploadLogoFile,
  useRequestLogoUploadUrl,
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

function LogoField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrl = useRequestLogoUploadUrl();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);
    try {
      const publicUrl = await uploadLogoFile(file, (input) => requestUploadUrl.mutateAsync(input));
      onChange(publicUrl);
    } catch (err) {
      setUploadError(err instanceof ApiError || err instanceof Error ? err.message : 'Der Upload ist fehlgeschlagen.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <Button
          type="button"
          variant="secondary"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? 'Lädt hoch …' : 'Datei hochladen'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_LOGO_CONTENT_TYPES.join(',')}
          className="hidden"
          onChange={(event) => void handleFileSelected(event)}
        />
      </div>
      <p className="mt-1 text-xs text-slate-400">PNG, JPEG oder WebP, maximal 2 MB. Alternativ eine bestehende URL eintragen.</p>
      {uploadError ? <p className="mt-1 text-xs text-red-600">{uploadError}</p> : null}
    </div>
  );
}

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
  const { data: brandingResponse, isLoading, isError, error: loadError, refetch } = useTenantBranding();
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

      {isError ? (
        <ErrorState
          className="mt-6"
          message={errorMessage(loadError, 'Das Branding konnte nicht geladen werden.')}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
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
              <LogoField
                id="branding-logo"
                label="Logo"
                placeholder="https://…/logo.png"
                value={form.logoUrl}
                onChange={(value) => set('logoUrl', value)}
              />
              <LogoField
                id="branding-logo-mark"
                label="Kompaktes Logo/Zeichen (optional)"
                placeholder="https://…/mark.png"
                value={form.logoMarkUrl}
                onChange={(value) => set('logoMarkUrl', value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vorschau</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-slate-200">
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: form.navigationBackground }}>
                  {form.logoMarkUrl || form.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary external/object-storage URL; next/image's fixed remote-pattern allowlist doesn't fit a per-tenant, user-editable source.
                    <img src={form.logoMarkUrl || form.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
                  ) : null}
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
