'use client';

import { Bell, Search, Sparkles } from 'lucide-react';
import { Button } from '@orbit/ui';
import type { AuthUser } from '../../lib/token-store';

function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

/**
 * §7 der UI/UX-Spezifikation ("Main header"). Die globale Suche ist
 * bewusst deaktiviert gerendert statt funktional simuliert (§7.2: "If
 * global search is not yet implemented: keep the visual component behind
 * a feature flag, do not ship a fake interactive search") — es gibt noch
 * keinen Such-Endpunkt, der tatsächlich tenant-/berechtigungsgefiltert
 * über alle Domänen sucht.
 */
export function AppHeader({
  user,
  companyDisplayName,
  onLogout,
  sondeOpen,
  onToggleSonde,
}: {
  user: AuthUser;
  companyDisplayName?: string | null;
  onLogout: () => void;
  sondeOpen: boolean;
  onToggleSonde: () => void;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex flex-1 items-center">
        <div className="relative w-full max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            disabled
            title="Globale Suche ist noch nicht verfügbar."
            placeholder="Suche in ORBIT …"
            className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-400"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant={sondeOpen ? 'secondary' : 'ghost'}
          className="gap-1.5 px-2.5"
          onClick={onToggleSonde}
          aria-pressed={sondeOpen}
        >
          <Sparkles size={16} />
          Sonde
        </Button>

        <button
          type="button"
          disabled
          title="Benachrichtigungen sind noch nicht verfügbar."
          className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full text-slate-300"
        >
          <Bell size={18} />
        </button>

        <div className="h-6 w-px bg-slate-200" />

        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
            {initialsFor(user.email)}
          </span>
          <div className="hidden text-right sm:block">
            <p className="truncate text-xs font-medium text-slate-900">{user.email}</p>
            {companyDisplayName ? <p className="truncate text-[11px] text-slate-400">{companyDisplayName}</p> : null}
          </div>
        </div>

        <Button variant="ghost" className="px-2 text-xs text-slate-500 hover:text-slate-900" onClick={onLogout}>
          Abmelden
        </Button>
      </div>
    </header>
  );
}
