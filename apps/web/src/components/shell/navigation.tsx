'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  Home,
  Inbox,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { MODULE_LABELS, PERMISSIONS, type ModuleKey } from '@orbit/shared';
import { TenantLogo } from './tenant-logo';
import type { NavMode } from '../../lib/shell-layout';

interface NavLeaf {
  href: string;
  label: string;
  permission?: string;
}

interface NavItem {
  key: ModuleKey;
  icon: LucideIcon;
  /** Übersichtsseite des Bereichs: der Gruppenname navigiert dorthin (§5.2), der Chevron klappt nur auf/zu. */
  href: string;
  permission?: string;
  children?: NavLeaf[];
  /** Dezenter Trenner oberhalb (Systeme & Verbindungen / Administration, §5.2). */
  separatorBefore?: boolean;
}

/**
 * UI/UX v2 §3.1/§5: die zehn Bereiche in der festen Reihenfolge, mit deutschen Labels aus der zentralen Registry.
 * Bestehende Routen bleiben erhalten; es entsteht kein elftes Hauptmodul.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', icon: Home, href: '/dashboard' },
  { key: 'inbox', icon: Inbox, href: '/inbox', permission: PERMISSIONS.EMAIL_READ },
  {
    key: 'finance',
    icon: Wallet,
    href: '/finance/invoices',
    children: [
      { href: '/finance/invoices', label: 'Rechnungen', permission: PERMISSIONS.INVOICE_READ },
      { href: '/finance/suppliers', label: 'Lieferanten', permission: PERMISSIONS.SUPPLIER_MANAGE },
    ],
  },
  {
    key: 'sales',
    icon: TrendingUp,
    href: '/sales/leads',
    children: [
      { href: '/sales/leads', label: 'Interessenten', permission: PERMISSIONS.CRM_CONTACT_READ },
      { href: '/sales/opportunities', label: 'Verkaufschancen', permission: PERMISSIONS.CRM_OPPORTUNITY_MANAGE },
      { href: '/sales/contacts', label: 'Kontakte', permission: PERMISSIONS.CRM_CONTACT_READ },
    ],
  },
  { key: 'approvals', icon: CheckSquare, href: '/approvals', permission: PERMISSIONS.APPROVAL_READ },
  { key: 'tasks', icon: ListTodo, href: '/tasks', permission: PERMISSIONS.TASK_READ },
  { key: 'cases', icon: Folder, href: '/cases', permission: PERMISSIONS.CASE_READ },
  { key: 'activity', icon: Activity, href: '/activity', permission: PERMISSIONS.CASE_READ },
  { key: 'integrations', icon: Plug, href: '/integrations', permission: PERMISSIONS.INTEGRATION_CONFIGURE, separatorBefore: true },
  {
    key: 'administration',
    icon: Settings,
    href: '/admin',
    children: [
      { href: '/admin/settings', label: 'Unternehmen & Einstellungen', permission: PERMISSIONS.TENANT_MANAGE },
      { href: '/admin/branding', label: 'Erscheinungsbild', permission: PERMISSIONS.TENANT_BRANDING_CONFIGURE },
      { href: '/admin/users', label: 'Benutzer & Rollen', permission: PERMISSIONS.USER_MANAGE },
      { href: '/admin/policies', label: 'Regeln & Freigaben', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/ai-providers', label: 'KI & Modelle', permission: PERMISSIONS.INTEGRATION_CONFIGURE },
      { href: '/admin/processes', label: 'Prozesse', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/agents', label: 'Agenten', permission: PERMISSIONS.AGENT_MANAGE },
      { href: '/admin/workflows', label: 'Abläufe', permission: PERMISSIONS.AGENT_MANAGE },
      { href: '/admin/retention', label: 'Datenaufbewahrung', permission: PERMISSIONS.POLICY_MANAGE },
    ],
  },
];

/** Welche Gruppe gehört zur aktuellen Route? Auch Detailrouten ohne eigenen Menüeintrag behalten ihre Hauptgruppe (§5.2). */
export function activeGroupFor(pathname: string | null): ModuleKey | null {
  if (!pathname) return null;
  for (const item of NAV_ITEMS) {
    if (!item.children) continue;
    const prefix = item.href.split('/').slice(0, 2).join('/'); // '/finance' | '/sales' | '/admin'
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return item.key;
  }
  return null;
}

/** Seitenbezeichnung für die Sonde-Kontextzeile, z. B. „Finanzen › Rechnungen“. */
export function pageLabelFor(pathname: string | null): string | null {
  if (!pathname) return null;
  for (const item of NAV_ITEMS) {
    const child = item.children?.find((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
    if (child) return `${MODULE_LABELS[item.key].label} › ${child.label}`;
  }
  const direct = NAV_ITEMS.find((item) => !item.children && (item.key === 'home' ? pathname === '/dashboard' : pathname === item.href || pathname.startsWith(`${item.href}/`)));
  if (direct) return MODULE_LABELS[direct.key].label;
  if (pathname.startsWith('/admin')) return MODULE_LABELS.administration.label;
  return null;
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function moduleActive(item: NavItem, pathname: string | null): boolean {
  if (item.key === 'home') return pathname === '/dashboard';
  if (item.children) return activeGroupFor(pathname) === item.key;
  return isActive(pathname, item.href);
}

export function NavigationTree({
  navMode,
  hasPermission,
  approvalCount,
  companyDisplayName,
  logoUrl,
  brandName,
  onToggleMode,
  onNavigate,
  isDrawer,
}: {
  navMode: NavMode;
  hasPermission: (permission: string) => boolean;
  approvalCount: number | null;
  companyDisplayName?: string | null;
  logoUrl?: string | null;
  brandName: string;
  onToggleMode: () => void;
  onNavigate?: () => void;
  isDrawer: boolean;
}) {
  const pathname = usePathname();
  const rail = navMode === 'rail' && !isDrawer;
  // NAV-01..03: Beim Einstieg ist jede Untergruppe geschlossen; nur die Gruppe der aktiven Route ist die Ausnahme.
  // Ein manuelles Öffnen/Schließen gilt nur für die aktuelle Route – bei jedem Routenwechsel zählt wieder die Regel (zurück auf Home: alles zu).
  const [override, setOverride] = useState<{ path: string | null; open: ModuleKey | null } | null>(null);
  const activeGroup = activeGroupFor(pathname);
  const openGroup = override && override.path === pathname ? override.open : activeGroup;
  const [flyout, setFlyout] = useState<ModuleKey | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => setFlyout(null), [pathname]);
  useEffect(() => {
    if (!flyout) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && navRef.current?.contains(event.target as Node)) return;
      setFlyout(null);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [flyout]);

  function toggleGroup(key: ModuleKey) {
    // Höchstens eine manuell geöffnete Gruppe (§5.2).
    setOverride({ path: pathname, open: openGroup === key ? null : key });
  }

  const rowBase = 'flex h-10 items-center gap-2.5 rounded-md text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white';
  const tone = (active: boolean) => (active ? 'bg-nav-active text-nav-active-foreground' : 'text-nav-foreground hover:bg-white/10 hover:text-nav-active-foreground');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={rail ? 'px-2 py-4' : 'px-4 py-4'}>
        <TenantLogo logoUrl={logoUrl} companyDisplayName={companyDisplayName} collapsed={rail} />
      </div>

      <nav ref={navRef} aria-label="Hauptnavigation" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const label = MODULE_LABELS[item.key].label;
            const Icon = item.icon;
            const visibleChildren = item.children?.filter((child) => !child.permission || hasPermission(child.permission));
            if (item.children) {
              if (!visibleChildren || visibleChildren.length === 0) return null;
            } else if (item.permission && !hasPermission(item.permission)) {
              return null;
            }
            const active = moduleActive(item, pathname);
            const isOpen = !rail && openGroup === item.key;
            const badge = item.key === 'approvals' && approvalCount ? (approvalCount > 99 ? '99+' : String(approvalCount)) : null;
            // Der Gruppenname führt zur Übersicht des ersten sichtbaren Unterpunkts, wenn die eigene Übersicht nicht existiert.
            const target = item.key === 'administration' ? '/admin' : (visibleChildren?.[0]?.href ?? item.href);

            return (
              <li key={item.key} className={item.separatorBefore ? 'mt-2 border-t border-white/10 pt-2' : undefined}>
                <div className="relative flex items-center">
                  <Link
                    href={target}
                    onClick={onNavigate}
                    aria-current={active && !item.children ? 'page' : undefined}
                    title={rail ? label : undefined}
                    className={`${rowBase} min-w-0 flex-1 ${rail ? 'justify-center px-0' : 'px-3'} ${tone(active)}`}
                  >
                    <Icon size={18} className="shrink-0" aria-hidden="true" />
                    {rail ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
                    {badge ? (
                      <span className={`${rail ? 'absolute right-1 top-0.5' : 'ml-auto'} rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold leading-5 text-slate-900`} aria-label={`${badge} offen`}>
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                  {item.children && !rail ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(item.key)}
                      aria-expanded={isOpen}
                      aria-controls={`nav-sub-${item.key}`}
                      aria-label={`${label}: Unterseiten ${isOpen ? 'schließen' : 'öffnen'}`}
                      className="ml-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-nav-foreground hover:bg-white/10 hover:text-nav-active-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
                    >
                      {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    </button>
                  ) : null}
                  {item.children && rail ? (
                    <button
                      type="button"
                      onClick={() => setFlyout(flyout === item.key ? null : item.key)}
                      aria-expanded={flyout === item.key}
                      aria-label={`${label}: Unterseiten anzeigen`}
                      className="absolute inset-y-0 right-0 w-4 rounded-r-md text-nav-foreground hover:bg-white/10"
                    >
                      <ChevronRight size={12} className="mx-auto" aria-hidden="true" />
                    </button>
                  ) : null}
                  {item.children && rail && flyout === item.key ? (
                    <ul role="menu" aria-label={label} className="absolute left-full top-0 z-40 ml-1 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
                      {visibleChildren?.map((child) => (
                        <li key={child.href} role="none">
                          <Link role="menuitem" href={child.href} className="block rounded-md px-3 py-2 text-slate-800 hover:bg-slate-100">
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {item.children && isOpen ? (
                  <ul id={`nav-sub-${item.key}`} className="ml-5 mt-0.5 space-y-0.5 border-l border-white/15 pl-2">
                    {visibleChildren?.map((child) => {
                      const childActive = isActive(pathname, child.href);
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            onClick={onNavigate}
                            aria-current={childActive ? 'page' : undefined}
                            className={`flex h-9 items-center rounded-md px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white ${tone(childActive)}`}
                          >
                            <span className="truncate">{child.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-2 py-2">
        {!isDrawer ? (
          <button
            type="button"
            onClick={onToggleMode}
            aria-label={rail ? 'Navigation mit Beschriftungen anzeigen' : 'Navigation verkleinern'}
            title={rail ? 'Navigation mit Beschriftungen anzeigen' : 'Navigation verkleinern'}
            className={`${rowBase} w-full ${rail ? 'justify-center px-0' : 'px-3'} text-nav-foreground hover:bg-white/10 hover:text-nav-active-foreground`}
          >
            {rail ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            {rail ? null : <span>Verkleinern</span>}
          </button>
        ) : null}
        {!rail ? (
          <div className="px-3 pb-1 pt-2">
            <p className="truncate text-xs font-medium text-nav-foreground">{brandName}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
