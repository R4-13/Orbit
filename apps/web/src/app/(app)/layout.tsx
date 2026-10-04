'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  CheckSquare,
  Folder,
  Home,
  Inbox,
  ListTodo,
  Plug,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@orbit/shared';
import { AppHeader } from '../../components/shell/app-header';
import { SondePanel } from '../../components/shell/sonde-panel';
import { SondeContextProvider } from '../../lib/sonde-context';
import { TenantLogo } from '../../components/shell/tenant-logo';
import { useAuth } from '../../lib/auth-context';
import { useApplyTenantTheme, useTenantBranding } from '../../lib/hooks/use-tenant-branding';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

interface NavLeaf {
  href: string;
  label: string;
  permission?: string;
}

type NavEntry =
  | ({ kind: 'leaf'; icon: LucideIcon } & NavLeaf)
  | { kind: 'group'; label: string; icon: LucideIcon; children: NavLeaf[] };

/**
 * §2/§4.2 der UI/UX-Spezifikation — exakte, vorgeschriebene
 * Top-Level-Reihenfolge (Home/Inbox/Finance/Sales/Approvals/Tasks/Cases/
 * Activity/Integrations/Administration). Finance/Sales/Administration
 * bleiben Gruppen mit bereits bestehenden Unterseiten (§16 der UI-Spec
 * verlangt keine flache Struktur, nur diese Top-Level-Reihenfolge).
 */
const NAV: NavEntry[] = [
  { kind: 'leaf', href: '/dashboard', label: 'Home', icon: Home },
  { kind: 'leaf', href: '/inbox', label: 'Inbox', icon: Inbox, permission: PERMISSIONS.EMAIL_READ },
  {
    kind: 'group',
    label: 'Finance',
    icon: Wallet,
    children: [
      { href: '/finance/invoices', label: 'Rechnungen', permission: PERMISSIONS.INVOICE_READ },
      { href: '/finance/suppliers', label: 'Lieferanten', permission: PERMISSIONS.SUPPLIER_MANAGE },
    ],
  },
  {
    kind: 'group',
    label: 'Sales',
    icon: TrendingUp,
    children: [
      { href: '/sales/leads', label: 'Leads', permission: PERMISSIONS.CRM_CONTACT_READ },
      { href: '/sales/opportunities', label: 'Opportunities', permission: PERMISSIONS.CRM_OPPORTUNITY_MANAGE },
      { href: '/sales/contacts', label: 'Kontakte', permission: PERMISSIONS.CRM_CONTACT_READ },
    ],
  },
  { kind: 'leaf', href: '/approvals', label: 'Approvals', icon: CheckSquare, permission: PERMISSIONS.APPROVAL_READ },
  { kind: 'leaf', href: '/tasks', label: 'Tasks', icon: ListTodo, permission: PERMISSIONS.TASK_READ },
  { kind: 'leaf', href: '/cases', label: 'Cases', icon: Folder, permission: PERMISSIONS.CASE_READ },
  { kind: 'leaf', href: '/activity', label: 'Activity', icon: Activity, permission: PERMISSIONS.CASE_READ },
  { kind: 'leaf', href: '/integrations', label: 'Integrations', icon: Plug, permission: PERMISSIONS.INTEGRATION_CONFIGURE },
  {
    kind: 'group',
    label: 'Administration',
    icon: Settings,
    children: [
      { href: '/admin/agents', label: 'Agenten-Konfiguration', permission: PERMISSIONS.AGENT_MANAGE },
      { href: '/admin/workflows', label: 'Orchestrierung', permission: PERMISSIONS.AGENT_MANAGE },
      { href: '/admin/processes', label: 'Prozessdefinitionen', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/policies', label: 'Agent-Autonomie', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/retention', label: 'Datenaufbewahrung', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/ai-providers', label: 'KI-Provider', permission: PERMISSIONS.INTEGRATION_CONFIGURE },
      { href: '/admin/branding', label: 'Branding', permission: PERMISSIONS.TENANT_BRANDING_CONFIGURE },
      { href: '/admin/users', label: 'Nutzerverwaltung', permission: PERMISSIONS.USER_MANAGE },
      { href: '/admin/settings', label: 'Einstellungen', permission: PERMISSIONS.TENANT_MANAGE },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SondeContextProvider>
      <AppShell>{children}</AppShell>
    </SondeContextProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, hasPermission, logout } = useAuth();
  const { data: brandingResponse } = useTenantBranding();
  // Desktop keeps the established "open by default" behaviour (ASSUMPTIONS
  // #268); below the lg breakpoint the panel is a full-screen overlay (see
  // SondePanel's own responsive classes — a fixed 400px side panel at
  // exactly the md/tablet width squeezed the sidebar+main content into an
  // unusably narrow column, so Sonde stays an overlay through tablet sizes
  // and only docks as a static side panel at lg: and up), so opening it by
  // default would immediately hide the dashboard behind Sonde on first
  // load — closed by default there instead. Starts `false` to match the
  // server-rendered markup (no viewport info during SSR) and flips once on
  // mount if the viewport is already desktop-sized.
  const [sondeOpen, setSondeOpen] = useState(false);
  // Below the md breakpoint the sidebar is a closed-by-default slide-in
  // drawer (§28 of the UI-Spec expects a collapsible nav on narrow
  // viewports) — at md: and up this state is simply never read (the
  // sidebar's own classes force it open/static there, see below).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useApplyTenantTheme(brandingResponse?.branding);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // Tailwind's `lg` breakpoint (1024px) — matches SondePanel's own
  // lg:static classes (see comment above). Runs once on mount, not on
  // resize: toggling Sonde open/closed mid-session based on a live resize
  // would be surprising, this only sets the *initial* default.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSondeOpen(true);
    }
  }, []);

  // A route change is the user having picked something from the drawer —
  // close it so the next screen isn't immediately obscured.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSidebarOpen(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen]);

  if (isLoading || !isAuthenticated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Wird geladen …
      </div>
    );
  }

  const branding = brandingResponse?.branding ?? null;

  return (
    <div className="flex h-screen">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-nav transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-5">
          <TenantLogo logoUrl={branding?.logoMarkUrl ?? branding?.logoUrl} companyDisplayName={branding?.companyDisplayName} />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((entry) => {
            if (entry.kind === 'leaf') {
              if (entry.permission && !hasPermission(entry.permission)) return null;
              const active = pathname?.startsWith(entry.href);
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    active ? 'bg-nav-active text-nav-active-foreground' : 'text-nav-foreground hover:bg-white/5 hover:text-nav-active-foreground'
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  {entry.label}
                </Link>
              );
            }

            const visibleChildren = entry.children.filter((child) => !child.permission || hasPermission(child.permission));
            if (visibleChildren.length === 0) return null;
            const groupActive = visibleChildren.some((child) => pathname?.startsWith(child.href));
            const Icon = entry.icon;

            return (
              <div key={entry.label} className="pt-1">
                <div
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium ${
                    groupActive ? 'text-nav-active-foreground' : 'text-nav-foreground'
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  {entry.label}
                </div>
                <ul className="ml-[27px] space-y-0.5 border-l border-white/10 pl-2.5">
                  {visibleChildren.map((child) => {
                    const active = pathname?.startsWith(child.href);
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={`block rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            active ? 'bg-nav-active text-nav-active-foreground' : 'text-nav-foreground/80 hover:bg-white/5 hover:text-nav-active-foreground'
                          }`}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-[11px] font-medium text-nav-foreground">{BRAND_NAME}</p>
          <p className="text-[10px] text-nav-foreground/60">AI Operations Platform</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          user={user}
          companyDisplayName={branding?.companyDisplayName}
          sondeOpen={sondeOpen}
          onToggleSonde={() => setSondeOpen((prev) => !prev)}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onLogout={() => {
            void logout().then(() => router.replace('/login'));
          }}
        />
        <div className="flex min-h-0 flex-1">
          <main className="flex-1 overflow-y-auto bg-surface-page px-4 py-5 sm:px-6 md:px-8 md:py-6">{children}</main>
          {sondeOpen ? <SondePanel onClose={() => setSondeOpen(false)} /> : null}
        </div>
      </div>
    </div>
  );
}
