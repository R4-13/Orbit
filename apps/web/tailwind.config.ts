import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand-primary)',
          foreground: 'var(--brand-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--brand-secondary)',
          foreground: 'var(--brand-secondary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--brand-accent)',
          foreground: 'var(--brand-accent-foreground)',
        },
        nav: {
          DEFAULT: 'var(--nav-background)',
          foreground: 'var(--nav-foreground)',
          active: 'var(--nav-active-background)',
          'active-foreground': 'var(--nav-active-foreground)',
        },
        surface: {
          page: 'var(--surface-page)',
          card: 'var(--surface-card)',
          muted: 'var(--surface-muted)',
        },
      },
      borderRadius: {
        card: 'var(--radius-card)',
      },
    },
  },
  plugins: [],
};

export default config;
