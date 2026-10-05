'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

/**
 * Root route. Per §58 of the master spec, the app's home is a work
 * dashboard, not a chat window — this just routes to it (or /login).
 */
export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [isLoading, isAuthenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-slate-600">
      Wird geladen …
    </main>
  );
}
