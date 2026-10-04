import { NODE_STATE_PRESENTATION, type NodeState, type PresentationTone } from '@orbit/shared';

export const TONE_STYLES: Record<PresentationTone, { chip: string; node: string }> = {
  neutral: { chip: 'bg-slate-100 text-slate-700 ring-slate-200', node: 'border-slate-300 bg-white' },
  info: { chip: 'bg-blue-50 text-blue-800 ring-blue-200', node: 'border-blue-400 bg-blue-50/60' },
  warning: { chip: 'bg-amber-50 text-amber-900 ring-amber-300', node: 'border-amber-500 bg-amber-50/70' },
  success: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', node: 'border-emerald-500 bg-emerald-50/60' },
  danger: { chip: 'bg-red-50 text-red-800 ring-red-300', node: 'border-red-500 bg-red-50/70' },
};

/**
 * Colour is never the only carrier of meaning (Amendment 02 §16.5): every state has a symbol and a business label from
 * the same table the server uses.
 */
export function StateChip({ state, className = '' }: { state: NodeState; className?: string }) {
  const presentation = NODE_STATE_PRESENTATION[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_STYLES[presentation.tone].chip} ${className}`}>
      <span aria-hidden="true">{presentation.symbol}</span>
      {presentation.label}
    </span>
  );
}

export function ExecutionModeTag({ mode }: { mode?: 'LIVE' | 'SIMULATED' }) {
  if (!mode) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        mode === 'LIVE' ? 'bg-slate-900 text-white' : 'border border-dashed border-slate-400 text-slate-600'
      }`}
      title={mode === 'LIVE' ? 'Echt ausgeführt' : 'Simuliert – kein echtes Zielsystem'}
    >
      {mode === 'LIVE' ? 'Live' : 'Simuliert'}
    </span>
  );
}
