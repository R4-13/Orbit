'use client';

import { useState } from 'react';

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Project ORBIT';

/**
 * UI v2 §21.3: das Logo bewahrt sein Seitenverhältnis, sitzt in einem festen, sicheren Container und fällt bei fehlendem oder
 * defektem Bild auf den Firmennamen als Text zurück (nie ein kaputtes Bild-Symbol). Im Rail-Modus (72 px) zeigt der Container
 * das kompakte Zeichen bzw. den Anfangsbuchstaben.
 */
export function TenantLogo({
  logoUrl,
  companyDisplayName,
  collapsed = false,
}: {
  logoUrl?: string | null;
  companyDisplayName?: string | null;
  collapsed?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const displayName = companyDisplayName || BRAND_NAME;
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;

  if (showImage) {
    return (
      <div className={`flex h-10 items-center ${collapsed ? 'w-full justify-center' : 'max-w-[176px]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Mandanten-URL: next/image würde pro Mandant remotePatterns brauchen */}
        <img src={logoUrl as string} alt={displayName} className={`object-contain ${collapsed ? 'max-h-8 max-w-[44px]' : 'max-h-10 max-w-[176px]'}`} onError={() => setFailedUrl(logoUrl ?? null)} />
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="flex h-10 w-full items-center justify-center" title={displayName}>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-base font-semibold text-white" aria-hidden="true">
          {displayName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="sr-only">{displayName}</span>
      </div>
    );
  }

  return (
    <div className="flex h-10 items-center">
      <span className="line-clamp-2 break-words text-base font-semibold leading-tight text-white">{displayName}</span>
    </div>
  );
}
