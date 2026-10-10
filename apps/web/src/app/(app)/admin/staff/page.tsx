'use client';

import { useRef, useState } from 'react';
import {
  LIVE_DELIVERY_CHANNELS,
  STAFF_CHANNEL_LABELS,
  STAFF_CONTACT_CHANNELS,
  STAFF_CSV_TEMPLATE,
  STAFF_RESPONSIBILITIES,
  STAFF_RESPONSIBILITY_LABELS,
  STAFF_ROLE_KINDS,
  STAFF_ROLE_LABELS,
  type StaffContactChannel,
  type StaffResponsibility,
  type StaffRoleKind,
} from '@orbit/shared';
import { Badge, Button, Card, ErrorState, Input, Label, type BadgeTone } from '@orbit/ui';
import { OnboardingChecklist } from '../../../../components/common/onboarding-checklist';
import { errorMessage } from '../../../../lib/api-client';
import {
  useCreateStaff,
  useDeactivateStaff,
  useImportStaff,
  usePreviewStaffImport,
  useStaff,
  useTenantProfile,
  useUpdateStaff,
  type StaffImportResult,
  type StaffView,
} from '../../../../lib/hooks/use-organization';

interface FormState {
  externalId: string;
  firstName: string;
  lastName: string;
  roleKind: StaffRoleKind;
  roleTitle: string;
  email: string;
  phone: string;
  teamsAddress: string;
  whatsappNumber: string;
  preferredChannel: StaffContactChannel;
  responsibilities: StaffResponsibility[];
  calendarId: string;
  availabilityNote: string;
  supervisorRef: string;
  deputyRef: string;
}

const EMPTY: FormState = {
  externalId: '',
  firstName: '',
  lastName: '',
  roleKind: 'OFFICE',
  roleTitle: '',
  email: '',
  phone: '',
  teamsAddress: '',
  whatsappNumber: '',
  preferredChannel: 'EMAIL',
  responsibilities: [],
  calendarId: '',
  availabilityNote: '',
  supervisorRef: '',
  deputyRef: '',
};

const ACTION_LABELS: Record<StaffImportResult['rows'][number]['action'], { label: string; tone: BadgeTone }> = {
  CREATE: { label: 'Neu', tone: 'success' },
  UPDATE: { label: 'Geändert', tone: 'warning' },
  UNCHANGED: { label: 'Unverändert', tone: 'neutral' },
  DEACTIVATE: { label: 'Wird deaktiviert', tone: 'danger' },
  ERROR: { label: 'Fehler', tone: 'danger' },
};

const select = 'block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

function toForm(person: StaffView): FormState {
  return {
    externalId: person.externalId ?? '',
    firstName: person.firstName,
    lastName: person.lastName,
    roleKind: person.roleKind as StaffRoleKind,
    roleTitle: person.roleTitle ?? '',
    email: person.email ?? '',
    phone: person.phone ?? '',
    teamsAddress: person.teamsAddress ?? '',
    whatsappNumber: person.whatsappNumber ?? '',
    preferredChannel: person.preferredChannel as StaffContactChannel,
    responsibilities: person.responsibilities as StaffResponsibility[],
    calendarId: person.calendarId ?? '',
    availabilityNote: person.availabilityNote ?? '',
    supervisorRef: person.supervisorId ?? '',
    deputyRef: person.deputyId ?? '',
  };
}

/** Excel speichert CSV oft in Windows-1252; UTF-8 zuerst versuchen, bei Ersatzzeichen auf Windows-1252 zurückfallen. */
async function readCsvFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

function downloadTemplate() {
  const blob = new Blob(['﻿' + STAFF_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mitarbeiter-vorlage.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function ImportPanel() {
  const preview = usePreviewStaffImport();
  const run = useImportStaff();
  const [csv, setCsv] = useState('');
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [result, setResult] = useState<StaffImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <Card className="space-y-3 p-5" data-testid="staff-import">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Mitarbeiter per Datei einlesen (CSV)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Exportieren Sie Ihre Mitarbeiterliste aus Excel oder Ihrer Personalverwaltung. ORBIT erkennt deutsche und englische Spaltenköpfe, Semikolon oder Komma. Zuerst sehen Sie eine Vorschau –
          gespeichert wird erst nach Ihrer Bestätigung. Erneutes Einlesen aktualisiert über die Personalnummer oder E-Mail-Adresse, ohne Doppelte anzulegen.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadTemplate}>
          Beispieldatei herunterladen
        </Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          Datei auswählen
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          aria-label="CSV-Datei"
          data-testid="staff-csv-file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              setCsv(await readCsvFile(file));
              reset();
            }
          }}
        />
      </div>
      <div>
        <Label htmlFor="staff-csv">Inhalt (CSV)</Label>
        <textarea
          id="staff-csv"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          rows={6}
          value={csv}
          placeholder="Oder hier einfügen: Vorname;Nachname;Rolle;E-Mail;Bevorzugter Kanal;Zuständigkeiten;Vorgesetzter;Vertretung"
          onChange={(event) => {
            setCsv(event.target.value);
            reset();
          }}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={deactivateMissing} onChange={(event) => { setDeactivateMissing(event.target.checked); reset(); }} />
        <span>
          Personen mit Personalnummer, die in der Datei nicht mehr vorkommen, deaktivieren
          <span className="block text-xs text-slate-600">Von Hand erfasste Personen ohne Personalnummer bleiben unberührt. Bei Fehlern in der Datei wird niemand deaktiviert.</span>
        </span>
      </label>
      <div className="flex gap-2">
        <Button
          disabled={!csv.trim() || preview.isPending}
          onClick={async () => {
            reset();
            try {
              setResult(await preview.mutateAsync({ csv, deactivateMissing }));
            } catch (e) {
              setError(errorMessage(e, 'Die Datei konnte nicht geprüft werden.'));
            }
          }}
        >
          {preview.isPending ? 'Wird geprüft …' : 'Vorschau'}
        </Button>
        {result?.dryRun ? (
          <Button
            variant="secondary"
            disabled={run.isPending || result.created + result.updated + result.deactivated === 0}
            onClick={async () => {
              setError(null);
              try {
                setResult(await run.mutateAsync({ csv, deactivateMissing }));
              } catch (e) {
                setError(errorMessage(e, 'Der Import ist fehlgeschlagen.'));
              }
            }}
          >
            {run.isPending ? 'Wird übernommen …' : `Übernehmen (${result.created} neu, ${result.updated} geändert${result.deactivated ? `, ${result.deactivated} deaktiviert` : ''})`}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {result ? (
        <div data-testid="staff-import-result" className="space-y-2">
          <p role="status" className="text-sm text-slate-800">
            {result.dryRun ? 'Vorschau – noch nichts gespeichert: ' : 'Übernommen: '}
            {result.created} neu, {result.updated} geändert, {result.unchanged} unverändert, {result.deactivated} deaktiviert, {result.failed} fehlerhaft.
          </p>
          {result.mapping && result.mapping.some((m) => !m.field) ? (
            <p className="text-xs text-amber-800">Nicht verstandene Spalten (werden ignoriert): {result.mapping.filter((m) => !m.field).map((m) => m.header).join(', ')}</p>
          ) : null}
          <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Zeile</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Ergebnis</th>
                  <th className="px-3 py-2">Hinweise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((row, index) => (
                  <tr key={index} data-action={row.action}>
                    <td className="px-3 py-2 text-slate-600">{row.line || '–'}</td>
                    <td className="px-3 py-2">{row.name || '–'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={ACTION_LABELS[row.action].tone}>{ACTION_LABELS[row.action].label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.errors.map((e) => (
                        <p key={e} className="text-red-700">{e}</p>
                      ))}
                      {row.warnings.map((w) => (
                        <p key={w} className="text-amber-800">{w}</p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <details className="text-sm text-slate-700">
        <summary className="cursor-pointer font-medium">Größere Betriebe: Abgleich über die Schnittstelle</summary>
        <p className="mt-2">
          Ein Personalsystem oder Verzeichnisdienst kann die Liste automatisch senden: <code>PUT /api/v1/staff/sync</code> mit einem Zugriffstoken eines Benutzers mit Berechtigung
          „Unternehmensprofil pflegen“. Schlüssel ist die Personalnummer (<code>externalId</code>); mit <code>dryRun: true</code> lässt sich der Abgleich zunächst nur prüfen.
        </p>
        <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs">{`{
  "staff": [
    { "externalId": "P-001", "firstName": "Anna", "lastName": "Beispiel", "roleKind": "OWNER",
      "email": "anna@betrieb.example", "preferredChannel": "EMAIL",
      "responsibilities": ["EMERGENCY", "QUOTES"], "deputyRef": "P-002" }
  ],
  "deactivateMissing": false,
  "dryRun": true
}`}</pre>
      </details>
    </Card>
  );
}

function StaffForm({ initial, others, onCancel, onSaved, editingId }: { initial: FormState; others: StaffView[]; onCancel: () => void; onSaved: () => void; editingId?: string }) {
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const candidates = others.filter((p) => p.active && p.id !== editingId);
  const pending = create.isPending || update.isPending;

  async function submit() {
    setError(null);
    try {
      if (editingId) await update.mutateAsync({ id: editingId, patch: form });
      else await create.mutateAsync(form);
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Die Person konnte nicht gespeichert werden.'));
    }
  }

  const field = (id: keyof FormState, label: string, props: { type?: string; placeholder?: string } = {}) => (
    <div>
      <Label htmlFor={`staff-${id}`}>{label}</Label>
      <Input id={`staff-${id}`} value={form[id] as string} onChange={(e) => set(id, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <Card className="space-y-4 p-5" data-testid="staff-form">
      <h2 className="text-base font-semibold text-slate-900">{editingId ? 'Person bearbeiten' : 'Person erfassen'}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {field('firstName', 'Vorname')}
        {field('lastName', 'Nachname')}
        {field('externalId', 'Personalnummer (optional)')}
        <div>
          <Label htmlFor="staff-roleKind">Rolle im Betrieb</Label>
          <select id="staff-roleKind" className={select} value={form.roleKind} onChange={(e) => set('roleKind', e.target.value as StaffRoleKind)}>
            {STAFF_ROLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {STAFF_ROLE_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        {field('roleTitle', 'Funktion (Freitext)', { placeholder: 'z. B. Heizungsmonteur' })}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {field('email', 'E-Mail-Adresse', { type: 'email' })}
        {field('phone', 'Mobil-/Rufnummer', { placeholder: '+49 171 1234567' })}
        {field('teamsAddress', 'Teams-Adresse')}
        {field('whatsappNumber', 'WhatsApp-Nummer (falls abweichend)')}
        <div>
          <Label htmlFor="staff-preferredChannel">So darf ORBIT die Person erreichen</Label>
          <select id="staff-preferredChannel" className={select} value={form.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value as StaffContactChannel)}>
            {STAFF_CONTACT_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {STAFF_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
          {!LIVE_DELIVERY_CHANNELS.includes(form.preferredChannel) ? (
            <p className="mt-1 text-xs text-amber-800">Dieser Kanal ist noch nicht angebunden – Meldungen gehen vorerst per E-Mail.</p>
          ) : null}
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Zuständig für</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {STAFF_RESPONSIBILITIES.map((item) => (
            <label key={item} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.responsibilities.includes(item)}
                onChange={(e) => set('responsibilities', e.target.checked ? [...form.responsibilities, item] : form.responsibilities.filter((r) => r !== item))}
              />
              {STAFF_RESPONSIBILITY_LABELS[item]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="staff-supervisorRef">Vorgesetzte/r</Label>
          <select id="staff-supervisorRef" className={select} value={form.supervisorRef} onChange={(e) => set('supervisorRef', e.target.value)}>
            <option value="">– keine Angabe –</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="staff-deputyRef">Vertretung (bei Krankheit/Urlaub)</Label>
          <select id="staff-deputyRef" className={select} value={form.deputyRef} onChange={(e) => set('deputyRef', e.target.value)}>
            <option value="">– keine Angabe –</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </div>
        {field('calendarId', 'Kalender (für Terminvorschläge)', { placeholder: 'Google-Kalender-ID oder E-Mail' })}
        {field('availabilityNote', 'Verfügbarkeit (Hinweis)', { placeholder: 'z. B. Mo–Do 7–16 Uhr' })}
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button disabled={pending || !form.firstName.trim() || !form.lastName.trim()} onClick={() => void submit()}>
          {pending ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}

export default function AdminStaffPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: staff, isLoading, isError, error, refetch } = useStaff(showInactive);
  const { data: profileState } = useTenantProfile();
  const deactivate = useDeactivateStaff();
  const update = useUpdateStaff();
  const [editing, setEditing] = useState<{ id?: string; form: FormState } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isError) return <ErrorState message={errorMessage(error, 'Das Mitarbeiterverzeichnis konnte nicht geladen werden.')} onRetry={() => void refetch()} />;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mitarbeiter</h1>
        <p className="mt-1 text-sm text-slate-600">
          Wen ORBIT wofür informiert und wie die Person erreichbar ist. Mit Vertretung und Vorgesetzten weiß ORBIT, wen es als Nächstes anspricht, wenn niemand reagiert – etwa bei Krankheit.
        </p>
      </div>

      {profileState ? <OnboardingChecklist state={profileState} /> : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {editing ? (
        <StaffForm
          key={editing.id ?? 'new'}
          initial={editing.form}
          editingId={editing.id}
          others={staff ?? []}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setEditing({ form: EMPTY })}>Person erfassen</Button>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Auch deaktivierte anzeigen
          </label>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="staff-table">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Rolle</th>
              <th className="px-4 py-3 font-medium">Erreichbar über</th>
              <th className="px-4 py-3 font-medium">Zuständig für</th>
              <th className="px-4 py-3 font-medium">Vertretung / Vorgesetzte/r</th>
              <th className="px-4 py-3 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={6}>
                  Wird geladen …
                </td>
              </tr>
            ) : staff && staff.length > 0 ? (
              staff.map((person) => (
                <tr key={person.id} className={person.active ? 'hover:bg-slate-50' : 'bg-slate-50 text-slate-500'} data-testid="staff-row">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {person.firstName} {person.lastName}
                    </span>
                    {!person.active ? <Badge tone="neutral" className="ml-2">Deaktiviert</Badge> : null}
                    {person.externalId ? <span className="block text-xs text-slate-500">{person.externalId}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {STAFF_ROLE_LABELS[person.roleKind as StaffRoleKind] ?? person.roleKind}
                    {person.roleTitle ? <span className="block text-xs text-slate-500">{person.roleTitle}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {STAFF_CHANNEL_LABELS[person.preferredChannel as StaffContactChannel] ?? person.preferredChannel}
                    {!LIVE_DELIVERY_CHANNELS.includes(person.preferredChannel as StaffContactChannel) ? <span className="block text-xs text-amber-800">Zustellung vorerst per E-Mail</span> : null}
                  </td>
                  <td className="px-4 py-3 text-xs">{person.responsibilities.map((r) => STAFF_RESPONSIBILITY_LABELS[r as StaffResponsibility] ?? r).join(', ') || '–'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="block">Vertretung: {person.deputyName ?? '–'}</span>
                    <span className="block">Vorgesetzte/r: {person.supervisorName ?? '–'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing({ id: person.id, form: toForm(person) })}>
                        Bearbeiten
                      </Button>
                      {person.active ? (
                        <Button
                          variant="ghost"
                          disabled={deactivate.isPending}
                          onClick={() => {
                            setActionError(null);
                            deactivate.mutate(person.id, { onError: (e) => setActionError(errorMessage(e, 'Die Person konnte nicht deaktiviert werden.')) });
                          }}
                        >
                          Deaktivieren
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={update.isPending}
                          onClick={() => {
                            setActionError(null);
                            update.mutate({ id: person.id, patch: { active: true } }, { onError: (e) => setActionError(errorMessage(e, 'Die Person konnte nicht aktiviert werden.')) });
                          }}
                        >
                          Aktivieren
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-slate-600" colSpan={6}>
                  Noch keine Person erfasst. Erfassen Sie Personen von Hand oder lesen Sie eine Datei ein.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <ImportPanel />
    </div>
  );
}
