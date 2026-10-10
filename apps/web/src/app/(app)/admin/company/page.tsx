'use client';

import { useEffect, useMemo, useState } from 'react';
import { PROFILE_TONES, PROFILE_TONE_LABELS, WEEKDAYS, WEEKDAY_LABELS, type ProfileTone, type Weekday } from '@orbit/shared';
import { Button, Card, ErrorState, Input, Label } from '@orbit/ui';
import { OnboardingChecklist } from '../../../../components/common/onboarding-checklist';
import { errorMessage } from '../../../../lib/api-client';
import { useTenantProfile, useUpdateTenantProfile } from '../../../../lib/hooks/use-organization';

interface HoursRow {
  days: Weekday[];
  from: string;
  to: string;
}
interface Faq {
  question: string;
  answer: string;
}
interface FormState {
  industry: string;
  description: string;
  services: string;
  exclusions: string;
  serviceArea: string;
  openingHours: HoursRow[];
  emergencyService: boolean;
  emergencyNote: string;
  tone: ProfileTone;
  languages: string[];
  faqs: Faq[];
  reminderHours: string;
  escalateHours: string;
  emergencyReminderMinutes: string;
  emergencyEscalateMinutes: string;
}

const LANGUAGES: Array<[string, string]> = [
  ['de', 'Deutsch'],
  ['en', 'Englisch'],
  ['tr', 'Türkisch'],
  ['pl', 'Polnisch'],
  ['ru', 'Russisch'],
  ['fr', 'Französisch'],
  ['es', 'Spanisch'],
  ['it', 'Italienisch'],
];

const lines = (value: string): string[] => value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const textarea =
  'block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

export default function AdminCompanyPage() {
  const { data, isLoading, isError, error, refetch } = useTenantProfile();
  const update = useUpdateTenantProfile();
  const [form, setForm] = useState<FormState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const baseline = useMemo<FormState | null>(() => {
    if (!data) return null;
    const p = data.profile;
    return {
      industry: p?.industry ?? '',
      description: p?.description ?? '',
      services: (p?.services ?? []).join('\n'),
      exclusions: (p?.exclusions ?? []).join('\n'),
      serviceArea: p?.serviceArea ?? '',
      openingHours: (p?.openingHours ?? []).map((h) => ({ days: h.days as Weekday[], from: h.from, to: h.to })),
      emergencyService: p?.emergencyService ?? false,
      emergencyNote: p?.emergencyNote ?? '',
      tone: (p?.tone as ProfileTone | undefined) ?? 'FORMAL',
      languages: p?.languages ?? ['de'],
      faqs: p?.faqs ?? [],
      reminderHours: String(data.escalationPolicy.reminderAfterMinutes / 60),
      escalateHours: String(data.escalationPolicy.escalateAfterMinutes / 60),
      emergencyReminderMinutes: String(data.escalationPolicy.emergencyReminderMinutes),
      emergencyEscalateMinutes: String(data.escalationPolicy.emergencyEscalateMinutes),
    };
  }, [data]);

  useEffect(() => {
    if (baseline) setForm(baseline);
  }, [baseline]);

  const dirty = useMemo(() => form !== null && baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (isError) return <ErrorState message={errorMessage(error, 'Das Betriebsprofil konnte nicht geladen werden.')} onRetry={() => void refetch()} />;
  if (isLoading || !data || !form) return <p className="text-sm text-slate-600">Wird geladen …</p>;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false);
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  async function save() {
    if (!form) return;
    setSaveError(null);
    const toMinutes = (hours: string) => Math.round(Number(hours.replace(',', '.')) * 60);
    try {
      await update.mutateAsync({
        industry: form.industry,
        description: form.description,
        services: lines(form.services),
        exclusions: lines(form.exclusions),
        serviceArea: form.serviceArea,
        openingHours: form.openingHours.filter((h) => h.days.length > 0),
        emergencyService: form.emergencyService,
        emergencyNote: form.emergencyNote,
        tone: form.tone,
        languages: form.languages.length > 0 ? form.languages : ['de'],
        faqs: form.faqs.filter((f) => f.question.trim().length >= 3 && f.answer.trim().length >= 3),
        escalationPolicy: {
          reminderAfterMinutes: toMinutes(form.reminderHours),
          escalateAfterMinutes: toMinutes(form.escalateHours),
          emergencyReminderMinutes: Number(form.emergencyReminderMinutes),
          emergencyEscalateMinutes: Number(form.emergencyEscalateMinutes),
        },
      });
      setSaved(true);
    } catch (e) {
      setSaveError(errorMessage(e, 'Das Profil konnte nicht gespeichert werden.'));
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Unternehmensprofil</h1>
        <p className="mt-1 text-sm text-slate-600">
          Das Wissen, mit dem ORBIT im Sinne Ihres Betriebs entscheidet: was Sie anbieten, wann Sie erreichbar sind, wie Sie auftreten und wie schnell Menschen informiert werden, wenn
          etwas liegen bleibt.
        </p>
      </div>

      <OnboardingChecklist state={data} />

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Betrieb und Leistungen</h2>
        <div>
          <Label htmlFor="industry">Branche / Gewerk</Label>
          <Input id="industry" value={form.industry} maxLength={120} placeholder="z. B. Heizung und Sanitär, Dachdecker, KFZ-Werkstatt" onChange={(e) => set('industry', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="description">Kurzbeschreibung</Label>
          <textarea id="description" className={textarea} rows={3} maxLength={1500} value={form.description} placeholder="Was macht Ihr Betrieb in wenigen Sätzen?" onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="services">Leistungen (eine pro Zeile)</Label>
            <textarea id="services" className={textarea} rows={5} value={form.services} placeholder={'Heizungswartung\nBadsanierung'} onChange={(e) => set('services', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="exclusions">Nicht im Angebot (eine pro Zeile)</Label>
            <textarea id="exclusions" className={textarea} rows={5} value={form.exclusions} placeholder="Elektroarbeiten" onChange={(e) => set('exclusions', e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="serviceArea">Einsatzgebiet</Label>
          <Input id="serviceArea" value={form.serviceArea} maxLength={300} placeholder="z. B. Köln und Umgebung (30 km)" onChange={(e) => set('serviceArea', e.target.value)} />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Erreichbarkeit und Notdienst</h2>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Öffnungszeiten</legend>
          <div className="space-y-2">
            {form.openingHours.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" data-testid="hours-row">
                <div className="flex gap-1" role="group" aria-label={`Wochentage, Zeile ${index + 1}`}>
                  {WEEKDAYS.map((day) => (
                    <label key={day} className={`cursor-pointer rounded border px-2 py-1 text-xs ${row.days.includes(day) ? 'border-brand bg-brand/10 text-slate-900' : 'border-slate-300 text-slate-600'}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={row.days.includes(day)}
                        onChange={(e) => set('openingHours', form.openingHours.map((r, i) => (i === index ? { ...r, days: e.target.checked ? [...r.days, day] : r.days.filter((d) => d !== day) } : r)))}
                      />
                      {WEEKDAY_LABELS[day]}
                    </label>
                  ))}
                </div>
                <Input type="time" aria-label={`Von, Zeile ${index + 1}`} className="w-28" value={row.from} onChange={(e) => set('openingHours', form.openingHours.map((r, i) => (i === index ? { ...r, from: e.target.value } : r)))} />
                <span aria-hidden>–</span>
                <Input type="time" aria-label={`Bis, Zeile ${index + 1}`} className="w-28" value={row.to} onChange={(e) => set('openingHours', form.openingHours.map((r, i) => (i === index ? { ...r, to: e.target.value } : r)))} />
                <Button variant="ghost" onClick={() => set('openingHours', form.openingHours.filter((_, i) => i !== index))}>
                  Entfernen
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => set('openingHours', [...form.openingHours, { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '08:00', to: '17:00' }])}>
            Zeit hinzufügen
          </Button>
        </fieldset>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.emergencyService} onChange={(e) => set('emergencyService', e.target.checked)} />
            Wir bieten einen Notdienst an
          </label>
          {form.emergencyService ? (
            <div className="mt-2">
              <Label htmlFor="emergencyNote">Hinweis zum Notdienst</Label>
              <Input id="emergencyNote" value={form.emergencyNote} maxLength={500} placeholder="z. B. rund um die Uhr unter der Notdienst-Nummer" onChange={(e) => set('emergencyNote', e.target.value)} />
              <p className="mt-1 text-xs text-slate-600">Bestimmen Sie unter „Mitarbeiter“, wer für Notfälle zuständig ist.</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Auftreten gegenüber der Kundschaft</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="tone">Tonalität der Antworten</Label>
            <select id="tone" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={form.tone} onChange={(e) => set('tone', e.target.value as ProfileTone)}>
              {PROFILE_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {PROFILE_TONE_LABELS[tone]}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Sprachen, in denen Sie antworten können</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {LANGUAGES.map(([code, label]) => (
                <label key={code} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" checked={form.languages.includes(code)} onChange={(e) => set('languages', e.target.checked ? [...form.languages, code] : form.languages.filter((l) => l !== code))} />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-600">ORBIT antwortet in der Sprache der Anfrage, sonst in der ersten gewählten.</p>
          </fieldset>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Häufige Fragen mit freigegebenen Antworten</legend>
          <div className="space-y-3">
            {form.faqs.map((faq, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]" data-testid="faq-row">
                <Input aria-label={`Frage ${index + 1}`} placeholder="Frage" value={faq.question} onChange={(e) => set('faqs', form.faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))} />
                <Input aria-label={`Antwort ${index + 1}`} placeholder="Antwort" value={faq.answer} onChange={(e) => set('faqs', form.faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))} />
                <Button variant="ghost" onClick={() => set('faqs', form.faqs.filter((_, i) => i !== index))}>
                  Entfernen
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => set('faqs', [...form.faqs, { question: '', answer: '' }])}>
            Frage hinzufügen
          </Button>
        </fieldset>
      </Card>

      <Card className="space-y-4 p-5" data-testid="escalation-card">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Erinnerung und Eskalation</h2>
          <p className="mt-1 text-sm text-slate-600">
            Kommt auf eine Meldung keine Reaktion – weder von Ihnen noch aus den angeschlossenen Systemen –, erinnert ORBIT die zuständige Person und deren Vertretung und informiert später
            den Vorgesetzten und die Leitung. Die Vertretung und der Vorgesetzte legen Sie unter „Mitarbeiter“ fest.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="reminderHours">Erinnerung nach (Stunden)</Label>
            <Input id="reminderHours" inputMode="decimal" value={form.reminderHours} onChange={(e) => set('reminderHours', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="escalateHours">Eskalation an Vorgesetzte nach (Stunden)</Label>
            <Input id="escalateHours" inputMode="decimal" value={form.escalateHours} onChange={(e) => set('escalateHours', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="emergencyReminder">Notfall: Erinnerung nach (Minuten)</Label>
            <Input id="emergencyReminder" inputMode="numeric" value={form.emergencyReminderMinutes} onChange={(e) => set('emergencyReminderMinutes', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="emergencyEscalate">Notfall: Eskalation nach (Minuten)</Label>
            <Input id="emergencyEscalate" inputMode="numeric" value={form.emergencyEscalateMinutes} onChange={(e) => set('emergencyEscalateMinutes', e.target.value)} />
          </div>
        </div>
      </Card>

      {saveError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={update.isPending || !dirty}>
          {update.isPending ? 'Wird gespeichert …' : 'Profil speichern'}
        </Button>
        {dirty ? <span className="text-sm text-amber-700">Ungespeicherte Änderungen</span> : null}
        {saved && !dirty ? (
          <span role="status" className="text-sm text-emerald-700">
            Gespeichert.
          </span>
        ) : null}
      </div>
    </div>
  );
}
