'use client';

import Link from 'next/link';
import { PERMISSIONS } from '@orbit/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@orbit/ui';
import { OnboardingChecklist } from '../../../components/common/onboarding-checklist';
import { useAuth } from '../../../lib/auth-context';
import { useTenantProfile } from '../../../lib/hooks/use-organization';

interface AdminLink {
  href: string;
  label: string;
  permission: string;
}

interface AdminGroup {
  title: string;
  purpose: string;
  links: AdminLink[];
}

/** UI v2 §19: wenige Gruppen mit Zweckbeschreibung; die Expertenfunktionen (Prozesse, Agenten, Abläufe) stehen am Ende. */
const GROUPS: AdminGroup[] = [
  {
    title: 'Unternehmen & Erscheinungsbild',
    purpose: 'Name, Logos, Farben und die Stammdaten Ihres Unternehmens.',
    links: [
      { href: '/admin/settings', label: 'Unternehmen & Einstellungen', permission: PERMISSIONS.TENANT_MANAGE },
      { href: '/admin/branding', label: 'Erscheinungsbild', permission: PERMISSIONS.TENANT_BRANDING_CONFIGURE },
    ],
  },
  {
    title: 'Betrieb & Mitarbeiter',
    purpose: 'Branche, Leistungen, Erreichbarkeit – und wen ORBIT wofür und wie erreicht, auch bei Krankheit und Eskalation.',
    links: [
      { href: '/admin/company', label: 'Unternehmensprofil', permission: PERMISSIONS.TENANT_PROFILE_MANAGE },
      { href: '/admin/staff', label: 'Mitarbeiter', permission: PERMISSIONS.TENANT_PROFILE_MANAGE },
    ],
  },
  {
    title: 'Benutzer & Rollen',
    purpose: 'Wer Zugang hat und was jede Person sehen und entscheiden darf.',
    links: [{ href: '/admin/users', label: 'Benutzer & Rollen', permission: PERMISSIONS.USER_MANAGE }],
  },
  {
    title: 'Regeln & Freigaben',
    purpose: 'Was ORBIT selbstständig tun darf und wofür Ihre Freigabe nötig ist.',
    links: [{ href: '/admin/policies', label: 'Regeln & Freigaben', permission: PERMISSIONS.POLICY_MANAGE }],
  },
  {
    title: 'KI & Modelle',
    purpose: 'Welcher KI-Dienst arbeitet, ob er bereit ist, und die sichere Hinterlegung eigener Zugangsdaten.',
    links: [{ href: '/admin/ai-providers', label: 'KI & Modelle', permission: PERMISSIONS.INTEGRATION_CONFIGURE }],
  },
  {
    title: 'Prozesse & Agenten',
    purpose: 'Für Fortgeschrittene: Prozessdefinitionen, Agenten und Abläufe mit Versionen, Tests und Veröffentlichung.',
    links: [
      { href: '/admin/processes', label: 'Prozesse', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/agents', label: 'Agenten', permission: PERMISSIONS.AGENT_MANAGE },
      { href: '/admin/workflows', label: 'Abläufe', permission: PERMISSIONS.AGENT_MANAGE },
    ],
  },
  {
    title: 'Daten & Betrieb',
    purpose: 'Aufbewahrungsfristen, Datenexport und vorhandene Betriebsfunktionen.',
    links: [
      { href: '/admin/retention', label: 'Datenaufbewahrung', permission: PERMISSIONS.POLICY_MANAGE },
      { href: '/admin/settings', label: 'Datenexport & Löschung', permission: PERMISSIONS.TENANT_MANAGE },
    ],
  },
];

export default function AdministrationPage() {
  const { hasPermission } = useAuth();
  const canSeeProfile = hasPermission(PERMISSIONS.TENANT_PROFILE_MANAGE);
  const { data: profileState } = useTenantProfile(canSeeProfile);
  const visible = GROUPS.map((group) => ({ ...group, links: group.links.filter((link) => hasPermission(link.permission)) })).filter((group) => group.links.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Administration</h1>
        <p className="mt-1 text-sm text-slate-600">Hier richten Sie ORBIT für Ihr Unternehmen ein. Wählen Sie einen Bereich.</p>
      </div>
      {canSeeProfile && profileState && !profileState.onboarding.complete ? <OnboardingChecklist state={profileState} compact /> : null}
      {visible.length === 0 ? (
        <p className="text-sm text-slate-600">Für Ihr Konto sind keine Verwaltungsbereiche freigeschaltet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle className="text-base">{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{group.purpose}</p>
                <ul className="space-y-1">
                  {group.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link href={link.href} className="text-sm font-medium text-brand hover:underline">
                        {link.label} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
