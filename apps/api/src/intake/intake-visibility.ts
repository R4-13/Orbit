import type { OrbitEnv } from '@orbit/config';

/**
 * Whether sicher ausgefilterte Eingänge ("Kein Geschäftsprozess ausgelöst") are shown by default (Testbetrieb) or only as
 * an explicit filter (Produktivbetrieb). One definition for the intake decisions API, the inbox and the home preview.
 */
export function showExcludedIntakeByDefault(env: Pick<OrbitEnv, 'UI_SHOW_EXCLUDED_INTAKE'>): boolean {
  const configured = env.UI_SHOW_EXCLUDED_INTAKE;
  return configured ? configured === 'true' : process.env.NODE_ENV !== 'production';
}
