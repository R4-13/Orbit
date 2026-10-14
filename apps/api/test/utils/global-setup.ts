/** Merkt sich den Start des Laufs; `global-teardown.ts` räumt danach alle Test-Mandanten dieses Laufs weg (TEC-07). */
export default function globalSetup(): void {
  process.env.E2E_RUN_STARTED_AT = new Date().toISOString();
}
