'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PERMISSIONS } from '@orbit/shared';
import { Button } from '@orbit/ui';
import { useAuth } from '../../lib/auth-context';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: '',
    items: [
      { href: '/dashboard', label: 'Übersicht' },
      { href: '/cases', label: 'Vorgänge', permission: PERMISSIONS.CASE_READ },
      { href: '/activity', label: 'Activity', permission: PERMISSIONS.CASE_READ },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/finance/invoices', label: 'Rechnungen', permission: PERMISSIONS.INVOICE_READ },
      { href: '/finance/suppliers', label: 'Lieferanten', permission: PERMISSIONS.SUPPLIER_MANAGE },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/sales/leads', label: 'Leads', permission: PERMISSIONS.CRM_CONTACT_READ },
      { href: '/sales/opportunities', label: 'Opportunities', permission: PERMISSIONS.CRM_OPPORTUNITY_MANAGE },
      { href: '/sales/contacts', label: 'Kontakte', permission: PERMISSIONS.CRM_CONTACT_READ },
    ],
  },
  {
    title: '',
    items: [
      { href: '/tasks', label: 'Aufgaben', permission: PERMISSIONS.TASK_READ },
      { href: '/approvals', label: 'Freigaben', permission: PERMISSIONS.APPROVAL_READ },
    ],
  },
  {
    title: 'Administration',
    items: [{ href: '/admin/policies', label: 'Agent-Autonomie', permission: PERMISSIONS.POLICY_MANAGE }],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, hasPermission, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Wird geladen …
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <span className="text-sm font-semibold text-slate-900">{BRAND_NAME}</span>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.permission || hasPermission(item.permission),
            );
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.title || section.items[0]?.href}>
                {section.title ? (
                  <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {section.title}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = pathname?.startsWith(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-md px-2 py-1.5 text-sm font-medium ${
                            active
                              ? 'bg-brand/10 text-brand'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start px-0 text-xs text-slate-500 hover:text-slate-900"
            onClick={() => {
              void logout().then(() => router.replace('/login'));
            }}
          >
            Abmelden
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-slate-50 px-8 py-6">{children}</main>
    </div>
  );
}
