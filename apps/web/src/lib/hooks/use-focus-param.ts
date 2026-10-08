'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Absprung aus der Suche auf genau einen Eintrag: `?focus=<id>` (bzw. ein anderer Parametername wie `company`) beschränkt eine Übersicht auf diesen
 * Treffer. `clear` hebt die Beschränkung auf und zeigt wieder die ganze Liste.
 */
export function useFocusParam(name = 'focus'): { value: string | null; clear: () => void } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return { value: params?.get(name) || null, clear: () => router.replace(pathname) };
}
