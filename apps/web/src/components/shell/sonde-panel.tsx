'use client';

import { Sparkles, X } from 'lucide-react';
import { Badge, Button } from '@orbit/ui';

const SONDE_MODES = ['Ask', 'Prepare', 'Act', 'Delegate', 'Navigate'] as const;

/**
 * §15/§37 der UI/UX-Spezifikation ("Sonde right-side copilot panel") —
 * strukturelle Platzhalter-Region, damit das Drei-Regionen-Layout aus
 * §3.1 vollständig ist. Bewusst KEINE simulierte Konversation/Funktion
 * (§33: "must not simulate functionality that does not exist") — das
 * Sonde-Backend (Conversation-Modell, CopilotModule) existiert noch
 * nicht, siehe docs/ORBIT_MASTER_IMPLEMENTATION_PLAN.md Abschnitt A.
 * Diese Komponente wird ersetzt, sobald Phase 6 (Sonde Conversation
 * Foundation) implementiert ist.
 */
export function SondePanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="flex h-screen w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sparkles size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Sonde</p>
            <p className="text-xs text-slate-400">Demnächst verfügbar</p>
          </div>
        </div>
        <Button variant="ghost" className="px-1.5" onClick={onClose} aria-label="Sonde schließen">
          <X size={16} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
        {SONDE_MODES.map((mode) => (
          <Badge key={mode} tone="neutral">
            {mode}
          </Badge>
        ))}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-300">
          <Sparkles size={22} />
        </span>
        <p className="text-sm font-medium text-slate-700">Sonde ist in Kürze verfügbar</p>
        <p className="text-xs text-slate-400">
          Der anwendungsweite Copilot befindet sich in Entwicklung — siehe
          docs/ORBIT_MASTER_IMPLEMENTATION_PLAN.md.
        </p>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <input
          disabled
          placeholder="Fragen Sie Sonde etwas …"
          className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
        />
      </div>
    </aside>
  );
}
