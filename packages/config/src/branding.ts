/**
 * Branding configuration.
 *
 * IMPORTANT: "ORBIT" is a working/project codename only. The final product
 * and company name has not been decided. Nothing in domain models, database
 * schemas, API routes, or business logic may hard-code the name "ORBIT" or
 * any other brand name. Anything user-facing must go through this module.
 *
 * All values are sourced from environment variables so a white-label
 * deployment only needs different env values, never a code change.
 */

export interface BrandingConfig {
  /** Internal/technical app name, e.g. shown in logs, package metadata. */
  appName: string;
  /** Customer-facing brand name, shown in the UI, emails, PDFs. */
  brandName: string;
  /** Path or URL to the brand logo asset. */
  brandLogo: string;
  /** Primary domain the app is served from (used for links, cookies, emails). */
  primaryDomain: string;
  /** Support contact address shown in error states and emails. */
  supportEmail: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  appName: 'Project ORBIT',
  brandName: 'Project ORBIT',
  brandLogo: '/branding/logo.svg',
  primaryDomain: 'orbit.local',
  supportEmail: 'support@orbit.local',
};

/**
 * Reads branding configuration from environment variables, falling back to
 * safe local-development defaults. Call once at process start and pass the
 * result down (dependency injection), rather than re-reading env vars
 * throughout the codebase.
 */
export function loadBrandingConfig(
  env: Record<string, string | undefined> = process.env,
): BrandingConfig {
  return {
    appName: env.APP_NAME?.trim() || DEFAULT_BRANDING.appName,
    brandName: env.BRAND_NAME?.trim() || DEFAULT_BRANDING.brandName,
    brandLogo: env.BRAND_LOGO?.trim() || DEFAULT_BRANDING.brandLogo,
    primaryDomain: env.PRIMARY_DOMAIN?.trim() || DEFAULT_BRANDING.primaryDomain,
    supportEmail: env.SUPPORT_EMAIL?.trim() || DEFAULT_BRANDING.supportEmail,
  };
}
