'use client';

import { useState } from 'react';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

/**
 * §5.3 der UI/UX-Spezifikation — Logo im oberen Sidebar-Bereich, ersetzbar
 * ohne Deployment (via TenantBranding.logoUrl), mit textbasiertem Fallback
 * bei fehlendem/defektem Logo statt eines kaputten Bild-Icons.
 */
export function TenantLogo({ logoUrl, companyDisplayName }: { logoUrl?: string | null; companyDisplayName?: string | null }) {
  const [failed, setFailed] = useState(false);
  const displayName = companyDisplayName || BRAND_NAME;

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied external URL, next/image would require remotePatterns config per tenant
      <img
        src={logoUrl}
        alt={displayName}
        className="max-h-10 max-w-[160px] object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className="text-sm font-semibold text-white">{displayName}</span>;
}
