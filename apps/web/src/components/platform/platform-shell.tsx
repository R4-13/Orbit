'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button } from '@orbit/ui';
import { usePlatformAuth } from '../../lib/platform/platform-auth';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

const NAV: Array<{ href: string; label: string; scope: string }> = [
  { href: '/platform', label: 'Übersicht', scope: PLATFORM_SCOPES.TENANTS_READ },
  { href: '/platform/tenants', label: 'Mandanten', scope: PLATFORM_SCOPES.TENANTS_READ },
  { href: '/platform/ai', label: 'KI-Steuerung', scope: PLATFORM_SCOPES.AI_READ },
  { href: '/platform/control', label: 'Notschalter und Anbindungen', scope: PLATFORM_SCOPES.FEATURES_READ },
  { href: '/platform/features', label: 'Feature-Flags', scope: PLATFORM_SCOPES.FEATURES_READ },
  { href: '/platform/support', label: 'Support', scope: PLATFORM_SCOPES.SUPPORT_SESSION_READ },
  { href: '/platform/audit', label: 'Audit', scope: PLATFORM_SCOPES.AUDIT_READ },
];

/** Die Umgebung ist immer sichtbar: ein Betreiber muss auf einen Blick wissen, ob er gerade Produktion bedient. */
function EnvironmentBadge({ environment }: { environment: string }) {
  const tone = environment === 'production' ? 'danger' : environment === 'staging' ? 'warning' : 'info';
  return <Badge tone={tone}>Umgebung: {environment}</Badge>;
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { principal, isAuthenticated, isLoading, logout, hasScope } = usePlatformAuth();
  const onLogin = pathname === '/platform/login';

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated && !onLogin) router.replace('/platform/login');
    if (isAuthenticated && onLogin) router.replace('/platform');
  }, [isLoading, isAuthenticated, onLogin, router]);

  if (onLogin) return <>{children}</>;
  if (isLoading || !isAuthenticated || !principal) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-slate-600">Wird geladen …</main>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900">{BRAND_NAME} · Plattformbetrieb</span>
            <EnvironmentBadge environment={principal.environment} />
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              {principal.displayName} · {principal.platformRoles.join(', ')}
            </span>
            <Button
              variant="secondary"
              onClick={async () => {
                await logout();
                router.replace('/platform/login');
              }}
            >
              Abmelden
            </Button>
          </div>
        </div>
        <nav aria-label="Plattformbereiche" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {NAV.filter((item) => hasScope(item.scope)).map((item) => {
            const active = item.href === '/platform' ? pathname === '/platform' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
