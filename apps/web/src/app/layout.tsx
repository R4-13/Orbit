import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';
import { QueryProvider } from '../lib/query-provider';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT',
  description: 'Administrative Prozessautomatisierung für Finance & Sales',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de-DE">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
