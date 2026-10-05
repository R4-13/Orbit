'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@orbit/shared';
import { useAuth } from '../../lib/auth-context';
import { useViewportWidth } from '../../lib/hooks/use-element-size';
import { useProfile } from '../../lib/hooks/use-profile';
import { useApprovalCount } from '../../lib/hooks/use-approvals';
import { useApplyTenantTheme, useTenantBranding } from '../../lib/hooks/use-tenant-branding';
import { HEADER_HEIGHT, NAV_DRAWER_BREAKPOINT, clampSondeWidth, defaultSondeOpen, maxDockableSondeWidth, resolveShellGeometry } from '../../lib/shell-layout';
import { useSondeCaseContext } from '../../lib/sonde-context';
import { useSondeWorkspace } from '../../lib/sonde-workspace';
import { useUiPreferences } from '../../lib/ui-preferences';
import { EntityPreviewDrawer } from '../common/entity-preview-drawer';
import { AppHeader } from './app-header';
import { GlobalSearch } from './global-search';
import { NavigationTree, pageLabelFor } from './navigation';
import { SondePanel } from './sonde-panel';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

/**
 * UI/UX v2 §4: der gemeinsame Shell-Rahmen. Der Rahmen richtet sich nach der tatsächlich verfügbaren CSS-Viewportgröße:
 * kein Body-Scroll (der Arbeitsbereich scrollt selbst), Hauptinhalt nutzt die zugewiesene Breite, und Sonde bleibt nur
 * dann angedockt, wenn der Hauptinhalt dabei mindestens 800 px netto behält – sonst öffnet sie als Overlay (nie in eine zu
 * schmale Arbeitsfläche gezwängt).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, hasPermission, logout } = useAuth();
  const { data: brandingResponse } = useTenantBranding();
  const { data: profile } = useProfile();
  const { preferences, update } = useUiPreferences();
  const workspace = useSondeWorkspace();
  const { setPageLabel } = useSondeCaseContext();
  const viewportWidth = useViewportWidth();
  const canSeeApprovals = hasPermission(PERMISSIONS.APPROVAL_READ);
  const approvalCount = useApprovalCount(canSeeApprovals);
  useApplyTenantTheme(brandingResponse?.branding);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [liveSondeWidth, setLiveSondeWidth] = useState<number | null>(null);
  const sondeTriggerRef = useRef<HTMLElement | null>(null);

  const isDrawerLayout = viewportWidth > 0 && viewportWidth < NAV_DRAWER_BREAKPOINT;
  const geometry = resolveShellGeometry({
    viewportWidth: viewportWidth || 1440,
    navMode: preferences.navMode,
    sondeWidth: liveSondeWidth ?? preferences.sondeWidth,
  });
  const docked = geometry.sondeDisplay === 'docked';
  const dockedOpen = preferences.sondeOpen ?? defaultSondeOpen(geometry);
  const sondeOpen = docked ? dockedOpen : overlayOpen;
  const branding = brandingResponse?.branding ?? null;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  // Rücksprung erhält die Scrollposition (UI v2 §9.4, AC-12): je Route merken. Ein Klick auf einen Link ist eine neue Navigation (oben
  // beginnen); jeder andere Routenwechsel – Browser-Zurück/-Vor – stellt die gemerkte Position wieder her. Auf popstate kann man sich dafür
  // nicht verlassen: im Produktionsbuild ist der Routenwechsel samt Effekten schon durch, bevor das Ereignis eintrifft.
  const search = useSearchParams()?.toString() ?? '';
  const scrollPositions = useRef(new Map<string, number>());
  const linkNavigationRef = useRef(false);
  // Der Hauptbereich existiert erst, nachdem die Anmeldung geprüft wurde – daher als State-Referenz, damit der Effekt dann (erneut) läuft.
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const main = mainEl;
    if (!main) return;
    const key = `${pathname}?${search}`;
    const target = linkNavigationRef.current ? 0 : (scrollPositions.current.get(key) ?? 0);
    linkNavigationRef.current = false;
    main.scrollTop = 0;
    if (target > 0) {
      // Inhalte laden asynchron: bis zu ~1,5 s warten, bis die Seite hoch genug ist.
      let attempts = 0;
      const tryRestore = () => {
        if (main.scrollHeight - main.clientHeight >= target || attempts > 30) main.scrollTop = target;
        else {
          attempts += 1;
          window.setTimeout(tryRestore, 50);
        }
      };
      tryRestore();
    }
    // Die Position wird beim Verlassen festgehalten (Klick auf einen Link), nicht fortlaufend: sobald die neue Seite eingeblendet ist,
    // setzt der Browser den Scrollwert wegen der kürzeren Inhalte selbst auf 0 und würde die Merkung sonst überschreiben.
    let resetTimer: number | undefined;
    const onClickCapture = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
      scrollPositions.current.set(key, main.scrollTop);
      linkNavigationRef.current = true;
      // Führt der Klick nicht zu einem Routenwechsel (z. B. Anker), darf die Markierung ein späteres Zurück nicht verfälschen.
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        linkNavigationRef.current = false;
      }, 3000);
    };
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.clearTimeout(resetTimer);
    };
  }, [pathname, search, mainEl]);
  useEffect(() => setPageLabel(pageLabelFor(pathname)), [pathname, setPageLabel]);

  // Layout wechselt (z. B. Fenster verkleinert): ein offenes Overlay verschwindet nicht, wenn Dock wieder möglich ist – der Zustand folgt der Präferenz.
  useEffect(() => {
    if (docked) setOverlayOpen(false);
  }, [docked]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const openSonde = useCallback(() => {
    sondeTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (docked) update({ sondeOpen: true });
    else setOverlayOpen(true);
  }, [docked, update]);

  const closeSonde = useCallback(() => {
    if (docked) update({ sondeOpen: false });
    else {
      setOverlayOpen(false);
      sondeTriggerRef.current?.focus();
    }
  }, [docked, update]);

  // Escape schließt das (modale) Overlay; das angedockte Panel ist nicht modal.
  useEffect(() => {
    if (docked || !overlayOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSonde();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, overlayOpen, closeSonde]);

  if (isLoading || !isAuthenticated || !user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-600">Wird geladen …</div>;
  }

  // ----- Größenänderung der angedockten Sonde (Maus und Tastatur), nie unter 800 px Hauptinhalt -----
  const maxWidth = maxDockableSondeWidth(viewportWidth || 1440, geometry.navWidth, geometry.mainPadding);
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => setLiveSondeWidth(Math.min(maxWidth, clampSondeWidth(window.innerWidth - move.clientX)));
    const onUp = (up: PointerEvent) => {
      target.releasePointerCapture(up.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      const finalWidth = Math.min(maxWidth, clampSondeWidth(window.innerWidth - up.clientX));
      setLiveSondeWidth(null);
      update({ sondeWidth: finalWidth });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }
  function resizeByKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    update({ sondeWidth: Math.min(maxWidth, clampSondeWidth(geometry.dockedSondeWidth + delta)) });
  }

  const navWidth = isDrawerLayout ? 288 : geometry.navWidth;
  const sheetFullScreen = viewportWidth > 0 && viewportWidth < 640;

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-page">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow-lg">
        Zum Inhalt springen
      </a>
      {isDrawerLayout && drawerOpen ? <div className="fixed inset-0 z-30 bg-black/40" aria-hidden="true" onClick={() => setDrawerOpen(false)} /> : null}

      <aside
        id="app-navigation"
        aria-label="Navigation"
        style={{ width: navWidth }}
        className={`${isDrawerLayout ? `fixed inset-y-0 left-0 z-40 transition-transform duration-200 motion-reduce:transition-none ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}` : 'relative shrink-0'} bg-nav`}
        {...(isDrawerLayout && !drawerOpen ? { inert: true } : {})}
      >
        <NavigationTree
          navMode={preferences.navMode}
          isDrawer={isDrawerLayout}
          hasPermission={hasPermission}
          approvalCount={canSeeApprovals ? (approvalCount ?? null) : null}
          companyDisplayName={branding?.companyDisplayName}
          logoUrl={branding?.logoMarkUrl && preferences.navMode === 'rail' && !isDrawerLayout ? branding.logoMarkUrl : (branding?.logoUrl ?? null)}
          brandName={BRAND_NAME}
          onToggleMode={() => update({ navMode: preferences.navMode === 'rail' ? 'labels' : 'rail' })}
          onNavigate={() => setDrawerOpen(false)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          user={user}
          profile={profile}
          companyDisplayName={branding?.companyDisplayName}
          sondeOpen={sondeOpen}
          sondeUnread={workspace.unreadReply}
          showDrawerButton={isDrawerLayout}
          onToggleDrawer={() => setDrawerOpen((open) => !open)}
          onToggleSonde={() => (sondeOpen ? closeSonde() : openSonde())}
          onLogout={() => {
            // Der Cache gehört zur Sitzung: nach der Abmeldung bleiben weder Listen noch Erscheinungsbild des Mandanten im Speicher.
            void logout().then(() => {
              queryClient.clear();
              router.replace('/login');
            });
          }}
          search={<GlobalSearch />}
        />
        <div className="flex min-h-0 flex-1">
          <main ref={setMainEl} id="main" tabIndex={-1} aria-label="Arbeitsbereich" data-shell-main style={{ padding: geometry.mainPadding }} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface-page outline-none">
            {children}
          </main>
          {docked && sondeOpen ? (
            <aside aria-label="Sonde" data-sonde="docked" style={{ width: geometry.dockedSondeWidth }} className="relative shrink-0 border-l border-slate-200 bg-white">
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Breite von Sonde ändern"
                aria-valuemin={360}
                aria-valuemax={Math.max(360, maxWidth)}
                aria-valuenow={geometry.dockedSondeWidth}
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={resizeByKey}
                className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-brand/30 focus-visible:bg-brand/40 focus-visible:outline-none"
              />
              <SondePanel onClose={closeSonde} />
            </aside>
          ) : null}
        </div>
      </div>

      <EntityPreviewDrawer />

      {!docked && overlayOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onClick={closeSonde} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sonde"
            data-sonde="overlay"
            style={sheetFullScreen ? undefined : { top: HEADER_HEIGHT, width: 'min(480px, 100vw)' }}
            className={`fixed z-50 border-l border-slate-200 bg-white shadow-xl ${sheetFullScreen ? 'inset-0 h-dvh' : 'bottom-0 right-0'}`}
          >
            <SondePanel onClose={closeSonde} autoFocus />
          </div>
        </>
      ) : null}
    </div>
  );
}
