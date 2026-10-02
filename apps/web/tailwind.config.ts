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
          // rgb(var(..) / <alpha-value>) — not a bare var(..) — is required for
          // opacity modifiers (bg-brand/10, hover:bg-brand/90, ...) to work; see
          // the comment on --brand-primary in globals.css.
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          foreground: 'var(--brand-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--brand-secondary)',
          foreground: 'var(--brand-secondary-foreground)',
        },
        accent: {
          DEFAULT: 'rgb(var(--brand-accent) / <alpha-value>)',
          foreground: 'var(--brand-accent-foreground)',
        },
        nav: {
          DEFAULT: 'var(--nav-background)',
          foreground: 'rgb(var(--nav-foreground) / <alpha-value>)',
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
