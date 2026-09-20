/**
 * Root route. Per §58 of the master spec, the app's home is a work
 * dashboard, not a chat window. This placeholder redirects to /dashboard
 * once auth (Phase 3) exists; the full Dashboard UI lands in Phase 12.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">
        {process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT'}
      </h1>
      <p className="max-w-md text-center text-sm text-slate-600">
        Arbeit wird erledigt: automatisierte Finance- und Sales-Prozesse mit
        vollständigem Audit Trail. Das Dashboard wird in Phase 12 der
        Entwicklung ausgeliefert.
      </p>
    </main>
  );
}
