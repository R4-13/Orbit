'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PLATFORM_SCOPES } from '@orbit/shared';
import { Badge, Button } from '@orbit/ui';
import { usePlatformAuth } from '../../lib/platform/platform-auth';
import { platformRoleLabel } from '../../lib/platform/role-labels';
import { useRuntimeHealth } from '../../lib/platform/use-platform-data';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

const NAV: Array<{ href: string; label: string; scope: string }> = [
  { href: '/platform', label: 'Übersicht', scope: PLATFORM_SCOPES.TENANTS_READ },
  { href: '/platform/tenants', label: 'Mandanten', scope: PLATFORM_SCOPES.TENANTS_READ },
  { href: '/platform/ai', label: 'KI-Steuerung', scope: PLATFORM_SCOPES.AI_READ },
  { href: '/platform/control', label: 'Notschalter und Anbindungen', scope: PLATFORM_SCOPES.FEATURES_READ },
  { href: '/platform/features', label: 'Feature-Flags', scope: PLATFORM_SCOPES.FEATURES_READ },
  { href: '/platform/support', label: 'Support', scope: PLATFORM_SCOPES.SUPPORT_SESSION_READ },
  { href: '/platform/identities', label: 'Zugänge', scope: PLATFORM_SCOPES.IDENTITY_MANAGE },
  { href: '/platform/audit', label: 'Audit', scope: PLATFORM_SCOPES.AUDIT_READ },
];

/** Die Umgebung ist immer sichtbar: ein Betreiber muss auf einen Blick wissen, ob er gerade Produktion bedient. */
function EnvironmentBadge({ environment }: { environment: string }) {
  const tone = environment === 'production' ? 'danger' : environment === 'staging' ? 'warning' : 'info';
  return <Badge tone={tone}>Umgebung: {environment}</Badge>;
}

/**
 * Sobald die Hintergrundverarbeitung nicht in Ordnung ist, steht das auf **jeder** Plattformseite – nicht erst auf der Übersicht. Ein Stillstand bedeutet:
 * Vorgänge und Postfach-Abgleich werden nicht bearbeitet. Wer die Laufzeit nicht lesen darf, sieht kein Banner (der Server verweigert die Messung ohnehin).
 */
function RuntimeBanner() {
  const { hasScope } = usePlatformAuth();
  const allowed = hasScope(PLATFORM_SCOPES.RUNTIME_READ);
  const runtime = useRuntimeHealth(allowed);
  if (!allowed || !runtime.data || runtime.data.status === 'OK') return null;
  const down = runtime.data.status === 'DOWN';
  const affected = runtime.data.queues.filter((q) => q.status !== 'OK');
  return (
    <div role={down ? 'alert' : 'status'} className={`border-b px-4 py-2 text-sm ${down ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{down ? 'Hintergrundverarbeitung steht still.' : 'Hintergrundverarbeitung ist eingeschränkt.'}</strong> {affected.map((q) => q.note).filter(Boolean).join(' ')}
        </span>
        <Link href="/platform" className="underline">Zur Übersicht</Link>
      </div>
    </div>
  );
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { principal, isAuthenticated, isLoading, logout, hasScope } = usePlatformAuth();
  const onLogin = pathname === '/platform/login';

  const mustChangePassword = principal?.passwordChangeRequired === true;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated && !onLogin) router.replace('/platform/login');
    if (isAuthenticated && onLogin) router.replace(mustChangePassword ? '/platform/account' : '/platform');
    // Solange ein Passwortwechsel aussteht, ist nur „Mein Zugang“ erreichbar (der Server sperrt alles andere ohnehin).
    if (isAuthenticated && mustChangePassword && pathname !== '/platform/account' && !onLogin) router.replace('/platform/account');
  }, [isLoading, isAuthenticated, onLogin, mustChangePassword, pathname, router]);

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
            <Link href="/platform/account" className="underline-offset-2 hover:underline" aria-label="Mein Zugang und Passwort">
              {principal.displayName} · {principal.platformRoles.map(platformRoleLabel).join(', ')}
            </Link>
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
          {NAV.filter((item) => !mustChangePassword && hasScope(item.scope)).map((item) => {
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
      <RuntimeBanner />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
