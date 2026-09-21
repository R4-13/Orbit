import { describe, expect, it } from 'vitest';
import { loadBrandingConfig } from './branding';

describe('loadBrandingConfig', () => {
  it('falls back to safe local-development defaults when env is empty', () => {
    const branding = loadBrandingConfig({});

    expect(branding).toEqual({
      appName: 'Project ORBIT',
      brandName: 'Project ORBIT',
      brandLogo: '/branding/logo.svg',
      primaryDomain: 'orbit.local',
      supportEmail: 'support@orbit.local',
    });
  });

  it('reads every value from the provided env record, never hard-coding a brand', () => {
    const branding = loadBrandingConfig({
      APP_NAME: 'Acme Internal',
      BRAND_NAME: 'Acme Automate',
      BRAND_LOGO: 'https://cdn.acme.example/logo.svg',
      PRIMARY_DOMAIN: 'acme.example',
      SUPPORT_EMAIL: 'help@acme.example',
    });

    expect(branding).toEqual({
      appName: 'Acme Internal',
      brandName: 'Acme Automate',
      brandLogo: 'https://cdn.acme.example/logo.svg',
      primaryDomain: 'acme.example',
      supportEmail: 'help@acme.example',
    });
  });

  it('treats blank/whitespace-only env values as unset and falls back to the default', () => {
    const branding = loadBrandingConfig({ BRAND_NAME: '   ' });
    expect(branding.brandName).toBe('Project ORBIT');
  });
});
