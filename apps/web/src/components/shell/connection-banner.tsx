'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@orbit/shared';
import { apiFetch } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { useConnectors, type IntegrationSummary } from '../../lib/hooks/use-integrations';

/** Zustände, in denen eine Verbindung nichts mehr tut: abgemeldet (Zustimmung abgelaufen/widerrufen) oder gestört. */
export const BROKEN_CONNECTION_STATUSES = ['AUTH_REQUIRED', 'ERROR'] as const;

/**
 * Hinweis auf jeder Seite, solange eine Verbindung unterbrochen ist. Ohne ihn blieben Abruf und Versand unbemerkt stehen: Mails kämen nicht an, freigegebene
 * E-Mails gingen nicht hinaus. Nur wer Verbindungen verwalten darf, sieht ihn – er kann die Ursache auch beheben.
 */
export function ConnectionBanner() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission(PERMISSIONS.INTEGRATION_CONFIGURE);
  const integrations = useQuery({ queryKey: ['integrations', 'banner'], queryFn: () => apiFetch<IntegrationSummary[]>('/v1/integrations'), enabled: allowed, refetchInterval: 60_000 });
  const connectors = useConnectors();
  if (!allowed) return null;

  const broken = (integrations.data ?? []).filter((i) => (BROKEN_CONNECTION_STATUSES as readonly string[]).includes(i.status));
  if (broken.length === 0) return null;
  const nameOf = (type: string) => connectors.data?.find((c) => c.id === type)?.name ?? type;
  const names = broken.map((i) => nameOf(i.connectorType)).join(', ');

  return (
    <div role="alert" data-testid="connection-banner" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        <strong>{broken.length === 1 ? `Die Verbindung zu ${names} ist unterbrochen.` : `Verbindungen unterbrochen: ${names}.`}</strong>{' '}
        Solange sie getrennt ist, werden keine E-Mails abgerufen und freigegebene E-Mails nicht gesendet; Freigaben bleiben dann offen.
      </span>
      <Link href="/integrations" className="rounded-md bg-amber-900 px-3 py-1 font-medium text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900">
        Jetzt erneuern
      </Link>
    </div>
  );
}
