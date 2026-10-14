'use client';

import { Suspense } from 'react';
import { SondeContextProvider } from '../../lib/sonde-context';
import { SondeWorkspaceProvider } from '../../lib/sonde-workspace';
import { UiPreferencesProvider } from '../../lib/ui-preferences';
import { AppShell } from '../../components/shell/app-shell';
import { PreviewProvider } from '../../components/common/preview-context';
import { ForcedPasswordChange } from '../../components/common/forced-password-change';
import { useAuth } from '../../lib/auth-context';

/**
 * Provider-Reihenfolge: Präferenzen → Sonde-Kontext → Sonde-Arbeitsbereich (braucht den Kontext) → Shell. Die Shell (und jede Seite darunter) liest useSearchParams; Next verlangt dafür beim statischen
 * Prerendering eine Suspense-Grenze, sonst bricht `next build` ab.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Startpasswort: der Server lässt bis zum Wechsel nichts anderes zu – die Anwendung zeigt nur die Passwortmaske, ohne dass Seiten Daten abfragen.
  if (user?.passwordChangeRequired) return <ForcedPasswordChange />;
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
