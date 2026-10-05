'use client';

import { Suspense } from 'react';
import { SondeContextProvider } from '../../lib/sonde-context';
import { SondeWorkspaceProvider } from '../../lib/sonde-workspace';
import { UiPreferencesProvider } from '../../lib/ui-preferences';
import { AppShell } from '../../components/shell/app-shell';
import { PreviewProvider } from '../../components/common/preview-context';

/**
 * Provider-Reihenfolge: Präferenzen → Sonde-Kontext → Sonde-Arbeitsbereich (braucht den Kontext) → Shell. Die Shell (und jede Seite darunter) liest useSearchParams; Next verlangt dafür beim statischen
 * Prerendering eine Suspense-Grenze, sonst bricht `next build` ab.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UiPreferencesProvider>
      <SondeContextProvider>
        <SondeWorkspaceProvider>
          <PreviewProvider>
            <Suspense fallback={null}>
              <AppShell>{children}</AppShell>
            </Suspense>
          </PreviewProvider>
        </SondeWorkspaceProvider>
      </SondeContextProvider>
    </UiPreferencesProvider>
  );
}
