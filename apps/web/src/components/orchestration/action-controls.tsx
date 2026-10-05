'use client';

import { useEffect, useRef, useState } from 'react';
import type { ActionDescriptor, ActionPreview } from '@orbit/shared';
import { Button } from '@orbit/ui';
import { errorMessage } from '../../lib/api-client';
import { StaleViewError, useCaseCommand } from '../../lib/hooks/use-case-orchestration';

export function PreviewBlock({ preview }: { preview: ActionPreview }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      {preview.recipient ? (
        <p>
          <span className="font-medium text-slate-700">Empfänger: </span>
          {preview.recipient}
        </p>
      ) : null}
      {preview.subject ? (
        <p>
          <span className="font-medium text-slate-700">Betreff: </span>
          {preview.subject}
        </p>
      ) : null}
      {preview.bodyText ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-sans text-sm text-slate-800">{preview.bodyText}</pre> : null}
      {preview.attachments && preview.attachments.length > 0 ? (
        <p>
          <span className="font-medium text-slate-700">Anhang: </span>
          {preview.attachments.map((a) => a.fileName).join(', ')}
        </p>
      ) : null}
      {preview.quote ? (
        <div>
          <p className="font-medium text-slate-700">
            Angebot {preview.quote.number} · gültig bis {new Date(preview.quote.validUntil).toLocaleDateString('de-DE')}
          </p>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-1 pr-2 font-medium">Position</th>
                <th className="py-1 pr-2 font-medium">Menge</th>
                <th className="py-1 pr-2 text-right font-medium">Einzelpreis</th>
                <th className="py-1 text-right font-medium">Netto</th>
              </tr>
            </thead>
            <tbody>
              {preview.quote.lines.map((l) => (
                <tr key={l.sku} className="border-t border-slate-200">
                  <td className="py-1 pr-2">{l.name}</td>
                  <td className="py-1 pr-2">
                    {l.quantity} {l.unit}
                  </td>
                  <td className="py-1 pr-2 text-right">{l.unitPrice}</td>
                  <td className="py-1 text-right">{l.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-right text-sm">
            Netto {Number(preview.quote.netAmount).toLocaleString('de-DE', { style: 'currency', currency: preview.quote.currency })} · USt.{' '}
            {Number(preview.quote.taxAmount).toLocaleString('de-DE', { style: 'currency', currency: preview.quote.currency })} ·{' '}
            <strong>Brutto {Number(preview.quote.grossAmount).toLocaleString('de-DE', { style: 'currency', currency: preview.quote.currency })}</strong>
          </p>
        </div>
      ) : null}
      {preview.sourceNote ? <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{preview.sourceNote}</p> : null}
    </div>
  );
}

function ActionDialog({
  action,
  preview,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  action: ActionDescriptor;
  preview?: ActionPreview;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(action.fields.map((f) => [f.name, f.initialValue ?? ''])));
  const firstFocus = useRef<HTMLButtonElement>(null);
  const missing = action.fields.some((f) => f.required && !(values[f.name] ?? '').trim());

  useEffect(() => {
    firstFocus.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label={action.title} className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl">
        <h2 className="text-base font-semibold text-slate-900">{action.title}</h2>
        {action.requiresPreview ? <p className="mt-1 text-xs text-slate-600">Bitte prüfen Sie Empfänger, Text, Anhang und Beträge, bevor Sie bestätigen.</p> : null}
        {preview && action.requiresPreview ? (
          <div className="mt-3">
            <PreviewBlock preview={preview} />
          </div>
        ) : null}
        {action.fields.length > 0 ? (
          <div className="mt-4 space-y-3">
            {action.fields.map((field) => (
              <label key={field.name} className="block text-sm">
                <span className="font-medium text-slate-700">
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    rows={field.name === 'bodyText' ? 10 : 3}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  />
                ) : (
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={firstFocus} variant="secondary" onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant={action.destructive ? 'danger' : 'primary'} onClick={() => onSubmit(values)} disabled={pending || missing}>
            {pending ? 'Wird gesendet …' : action.requiresPreview ? 'Bestätigen' : 'Ausführen'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders exactly the actions the server computed for this viewer and revision (§17.2). Nothing is offered on the basis of
 * a client-side guess; if the case moved on in the meantime the server answers 409 and the fresh actions replace these.
 */
export function ActionButtons({ caseId, actions, preview }: { caseId: string; actions: ActionDescriptor[]; preview?: ActionPreview }) {
  const command = useCaseCommand(caseId);
  const [active, setActive] = useState<ActionDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (actions.length === 0) return null;

  const run = (action: ActionDescriptor, values: Record<string, string> = {}): void => {
    setError(null);
    command.mutate(
      { action, values },
      {
        onSuccess: () => setActive(null),
        onError: (err) => {
          setError(err instanceof StaleViewError ? err.message : errorMessage(err, 'Die Aktion konnte nicht ausgeführt werden.'));
          if (err instanceof StaleViewError) setActive(null);
        },
      },
    );
  };

  const needsDialog = (a: ActionDescriptor): boolean => a.requiresPreview || a.fields.length > 0 || Boolean(a.destructive);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <Button
            key={`${action.commandKey}-${index}`}
            variant={action.destructive ? 'danger' : index === 0 ? 'primary' : 'secondary'}
            disabled={command.isPending}
            onClick={() => (needsDialog(action) ? (setError(null), setActive(action)) : run(action))}
          >
            {action.title}
          </Button>
        ))}
      </div>
      {!active && error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {active ? <ActionDialog action={active} preview={preview} pending={command.isPending} error={error} onCancel={() => setActive(null)} onSubmit={(values) => run(active, values)} /> : null}
    </div>
  );
}
