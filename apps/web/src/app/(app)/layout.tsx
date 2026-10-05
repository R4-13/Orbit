'use client';

import { SondeContextProvider } from '../../lib/sonde-context';
import { SondeWorkspaceProvider } from '../../lib/sonde-workspace';
import { UiPreferencesProvider } from '../../lib/ui-preferences';
import { AppShell } from '../../components/shell/app-shell';
import { PreviewProvider } from '../../components/common/preview-context';

/** Provider-Reihenfolge: Präferenzen → Sonde-Kontext → Sonde-Arbeitsbereich (braucht den Kontext) → Shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UiPreferencesProvider>
      <SondeContextProvider>
        <SondeWorkspaceProvider>
          <PreviewProvider>
            <AppShell>{children}</AppShell>
          </PreviewProvider>
        </SondeWorkspaceProvider>
      </SondeContextProvider>
    </UiPreferencesProvider>
  );
}
