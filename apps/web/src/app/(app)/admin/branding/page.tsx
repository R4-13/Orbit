'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label } from '@orbit/ui';
import { Notice, StatusBadge } from '../../../../components/common/primitives';
import { normalizeTheme } from '../../../../lib/theme-contrast';
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
  primaryColor: '#1666d8',
  primaryForeground: '#ffffff',
  secondaryColor: '#14243b',
  secondaryForeground: '#ffffff',
  accentColor: '#0891b2',
  accentForeground: '#ecfeff',
  navigationBackground: '#0b2340',
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
      <p className="mt-1 text-xs text-slate-600">PNG, JPEG oder WebP, maximal 2 MB. Alternativ eine bestehende URL eintragen.</p>
      {uploadError ? <p className="mt-1 text-xs text-red-600">{uploadError}</p> : null}
    </div>
  );
}

function ColorField({
  group,
  label,
  value,
  onChange,
}: {
  group: string;
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
          aria-label={`${group}, ${label}: Farbwähler`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300"
        />
        <Input aria-label={`${group}, ${label}: Hex-Wert`} value={value} onChange={(event) => onChange(event.target.value)} className="font-mono text-xs" />
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
  const [saved, setSaved] = useState(false);

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
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Ungespeichert-Hinweis (UI v2 §19): Änderungen gegenüber dem gespeicherten Stand.
  const savedBranding = brandingResponse?.branding;
  const baseline: FormState = {
    companyDisplayName: savedBranding?.companyDisplayName ?? '',
    logoUrl: savedBranding?.logoUrl ?? '',
    logoMarkUrl: savedBranding?.logoMarkUrl ?? '',
    primaryColor: savedBranding?.primaryColor ?? DEFAULTS.primaryColor,
    primaryForeground: savedBranding?.primaryForeground ?? DEFAULTS.primaryForeground,
    secondaryColor: savedBranding?.secondaryColor ?? DEFAULTS.secondaryColor,
    secondaryForeground: savedBranding?.secondaryForeground ?? DEFAULTS.secondaryForeground,
    accentColor: savedBranding?.accentColor ?? DEFAULTS.accentColor,
    accentForeground: savedBranding?.accentForeground ?? DEFAULTS.accentForeground,
    navigationBackground: savedBranding?.navigationBackground ?? DEFAULTS.navigationBackground,
    navigationForeground: savedBranding?.navigationForeground ?? DEFAULTS.navigationForeground,
  };
  const dirty = (Object.keys(baseline) as Array<keyof FormState>).some((key) => baseline[key] !== form[key]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Genau so wird das Erscheinungsbild angezeigt: unlesbare Kombinationen werden korrigiert (nicht verborgen) und hier erklärt.
  const theme = normalizeTheme({
    primaryColor: form.primaryColor,
    primaryForeground: form.primaryForeground,
    accentColor: form.accentColor,
    accentForeground: form.accentForeground,
    navigationBackground: form.navigationBackground,
    navigationForeground: form.navigationForeground,
  });

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
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Das Branding konnte nicht gespeichert werden.');
    }
  }

  async function handleReset() {
    setError(null);
    try {
      await reset.mutateAsync();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Das Zurücksetzen ist fehlgeschlagen.');
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Erscheinungsbild</h1>
      <p className="mt-1 text-sm text-slate-600">
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
        <p className="mt-6 text-sm text-slate-600">Wird geladen …</p>
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
            <CardContent className="space-y-3">
              <div className="overflow-hidden rounded-md border border-slate-200" aria-label="Vorschau des Erscheinungsbilds">
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: form.navigationBackground }}>
                  {form.logoMarkUrl || form.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary external/object-storage URL; next/image's fixed remote-pattern allowlist doesn't fit a per-tenant, user-editable source.
                    <img src={form.logoMarkUrl || form.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
                  ) : null}
                  <span className="text-xs font-semibold" style={{ color: theme.values.navigationForeground ?? form.navigationForeground }}>
                    {form.companyDisplayName || 'Project ORBIT'}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: theme.values.navigationForeground ?? form.navigationForeground }}>
                    Navigation
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: theme.values.primaryColor ?? form.primaryColor, color: theme.values.primaryForeground ?? form.primaryForeground }}>
                      Primäre Aktion
                    </button>
                    <button type="button" className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: form.accentColor, color: theme.values.accentForeground ?? form.accentForeground }}>
                      Sonde
                    </button>
                    <span className="rounded-md px-3 py-1.5 text-xs font-medium outline outline-2 outline-offset-2" style={{ outlineColor: theme.values.primaryColor ?? form.primaryColor }}>
                      Fokus
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="success">Erledigt</StatusBadge>
                    <StatusBadge tone="warning">Freigabe erforderlich</StatusBadge>
                    <StatusBadge tone="danger">Fehlgeschlagen</StatusBadge>
                  </div>
                  <div className="rounded-md border border-slate-200 p-2 text-xs text-slate-800">Karte mit Beispieltext in der Standard-Schriftfarbe.</div>
                  <p className="text-xs text-slate-600">Statusfarben (Erfolg, Warnung, Fehler) gehören ORBIT und werden nie durch Ihre Farben ersetzt – Status steht immer mit Symbol und Text.</p>
                </div>
              </div>
              {theme.corrections.length > 0 ? (
                <Notice tone="warning">
                  <p className="font-medium">ORBIT korrigiert, damit alles lesbar bleibt:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {theme.corrections.map((correction) => (
                      <li key={correction.field}>{correction.reason}</li>
                    ))}
                  </ul>
                </Notice>
              ) : (
                <p className="text-xs text-slate-600">Alle Kontraste erreichen mindestens 4,5 : 1.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Primärfarbe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField group="Primärfarbe" label="Hintergrund" value={form.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField group="Primärfarbe" label="Vordergrund (Text/Icons)" value={form.primaryForeground} onChange={(v) => set('primaryForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Akzentfarbe (Sonde)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField group="Akzentfarbe" label="Hintergrund" value={form.accentColor} onChange={(v) => set('accentColor', v)} />
              <ColorField group="Akzentfarbe" label="Vordergrund" value={form.accentForeground} onChange={(v) => set('accentForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sekundärfarbe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField group="Sekundärfarbe" label="Hintergrund" value={form.secondaryColor} onChange={(v) => set('secondaryColor', v)} />
              <ColorField group="Sekundärfarbe" label="Vordergrund" value={form.secondaryForeground} onChange={(v) => set('secondaryForeground', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Navigation (Sidebar)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ColorField group="Navigation" label="Hintergrund" value={form.navigationBackground} onChange={(v) => set('navigationBackground', v)} />
              <ColorField group="Navigation" label="Vordergrund" value={form.navigationForeground} onChange={(v) => set('navigationForeground', v)} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={update.isPending || !dirty}>
          {update.isPending ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        {dirty ? (
          <span className="text-sm font-medium text-amber-800" role="status">
            Ungespeicherte Änderungen
          </span>
        ) : saved ? (
          <span className="text-sm font-medium text-emerald-800" role="status">
            Gespeichert
          </span>
        ) : null}
        <Button variant="ghost" onClick={handleReset} disabled={reset.isPending}>
          Auf Standard zurücksetzen
        </Button>
      </div>
    </div>
  );
}
