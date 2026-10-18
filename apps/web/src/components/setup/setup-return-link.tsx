'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/** Merkt sich im Tab, dass jemand aus dem Einrichtungsassistenten kommt – es überlebt auch die Weiterleitung von Google bei der Anmeldung. */
export const SETUP_FLAG = 'orbit.setup.active';

export function markSetupActive(active: boolean): void {
  try {
    if (active) window.sessionStorage.setItem(SETUP_FLAG, '1');
    else window.sessionStorage.removeItem(SETUP_FLAG);
  } catch {
    // Ohne Browserspeicher gibt es einfach keinen Rückweg-Link; der Assistent bleibt über das Menü erreichbar.
  }
}

/** Seiten, zu denen der Assistent führt; nur dort erscheint der Rückweg (Home bleibt unberührt). */
const SETUP_TARGETS = ['/integrations', '/admin/company', '/admin/staff', '/admin/policies'];

/** Schmaler Rückweg „← Zurück zum Einrichtungsassistenten“ auf den Seiten, zu denen der Assistent geführt hat. */
export function SetupReturnLink() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  useEffect(() => {
    try {
      setActive(window.sessionStorage.getItem(SETUP_FLAG) === '1');
    } catch {
      setActive(false);
    }
  }, [pathname]);
  if (!active || !pathname || !SETUP_TARGETS.some((target) => pathname === target || pathname.startsWith(`${target}/`))) return null;
  return (
    <div className="mb-3" data-testid="setup-return">
      <Link href="/admin/setup" className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
        <ArrowLeft size={14} aria-hidden /> Zurück zum Einrichtungsassistenten
      </Link>
    </div>
  );
}
