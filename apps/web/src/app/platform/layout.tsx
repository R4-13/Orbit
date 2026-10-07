'use client';

import { PlatformShell } from '../../components/platform/platform-shell';
import { PlatformAuthProvider } from '../../lib/platform/platform-auth';

/**
 * Eigener Bereich für den Plattformbetrieb (Amendment 03): keine Mandanten-Shell, keine Mandanten-Navigation, keine Sonde, eigene Sitzung.
 * Die Zugriffsprüfung der Oberfläche (Weiterleitung, ausgeblendete Bereiche) ist Komfort – maßgeblich ist immer die Prüfung der API.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformAuthProvider>
      <PlatformShell>{children}</PlatformShell>
    </PlatformAuthProvider>
  );
}
