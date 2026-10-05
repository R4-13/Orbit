'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, LogOut, Menu, Sparkles } from 'lucide-react';
import type { AuthUser } from '../../lib/token-store';
import type { UserProfile } from '../../lib/hooks/use-profile';
import { HEADER_HEIGHT } from '../../lib/shell-layout';

function initialsFor(user: AuthUser, profile?: UserProfile): string {
  if (profile?.firstName || profile?.lastName) {
    return `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  }
  const local = user.email.split('@')[0] ?? user.email;
  const parts = local.split(/[._-]/).filter(Boolean);
  return ((parts[0]?.[0] ?? local[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * UI v2 §4.1/§7: der einzeilige Header (56 px). Links die Navigation (als Schublade, wenn der Platz fehlt) und die globale
 * Suche, rechts Sonde und Profil. Der Profilname steht vor der E-Mail-Adresse (GAP-08); eine technische Adresse ist nie die
 * Überschrift, sondern nur der Zweittext im Profilmenü.
 */
export function AppHeader({
  user,
  profile,
  companyDisplayName,
  onLogout,
  sondeOpen,
  sondeUnread,
  onToggleSonde,
  onToggleDrawer,
  showDrawerButton,
  search,
}: {
  user: AuthUser;
  profile?: UserProfile;
  companyDisplayName?: string | null;
  onLogout: () => void;
  sondeOpen: boolean;
  sondeUnread: boolean;
  onToggleSonde: () => void;
  onToggleDrawer: () => void;
  showDrawerButton: boolean;
  search: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = profile && `${profile.firstName} ${profile.lastName}`.trim() ? `${profile.firstName} ${profile.lastName}`.trim() : null;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [menuOpen]);

  return (
    <header style={{ height: HEADER_HEIGHT }} className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
      {showDrawerButton ? (
        <button type="button" onClick={onToggleDrawer} aria-label="Navigation öffnen" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
          <Menu size={22} />
        </button>
      ) : null}

      <div className="min-w-0 flex-1">{search}</div>

      <button
        type="button"
        onClick={onToggleSonde}
        aria-pressed={sondeOpen}
        className={`relative flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors ${
          sondeOpen ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
        }`}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>Sonde</span>
        {sondeUnread && !sondeOpen ? (
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-amber-500" role="status" aria-label="Neue Antwort von Sonde" />
        ) : null}
      </button>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Profilmenü"
          className="flex h-10 items-center gap-2 rounded-md px-1.5 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand" aria-hidden="true">
            {initialsFor(user, profile)}
          </span>
          {displayName ? <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-900 xl:block">{displayName}</span> : null}
          <ChevronDown size={14} className="hidden text-slate-500 sm:block" aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div role="menu" className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <div className="px-3 py-2">
              {displayName ? <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p> : null}
              <p className="truncate text-xs text-slate-600">{user.email}</p>
              {companyDisplayName ? <p className="mt-0.5 truncate text-xs text-slate-500">{companyDisplayName}</p> : null}
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-md border-t border-slate-100 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-100"
            >
              <LogOut size={15} aria-hidden="true" /> Abmelden
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
