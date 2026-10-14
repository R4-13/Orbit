import { PrismaClient } from '@orbit/domain';

/**
 * Schutz gegen hinterlassene Test-Mandanten (TEC-07): jede E2E-Suite legt Mandanten mit dem Slug-Präfix `e2e-` an. Räumt eine Suite nicht auf (Absturz, vergessenes
 * `afterAll`), blieben sie in der gemeinsam genutzten Entwicklungsdatenbank liegen und verlangsamen jede Mandantenabfrage (so lagen dort einmal 381). Nach dem Lauf werden
 * alle Mandanten mit diesem Präfix gelöscht, die seit dem Start des Laufs entstanden sind – ältere Reste und echte Mandanten bleiben unberührt.
 * Abschalten: `E2E_KEEP_TENANTS=1` (zum Untersuchen eines Fehlers).
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_TENANTS === '1' || !process.env.E2E_RUN_STARTED_AT) return;
  const since = new Date(process.env.E2E_RUN_STARTED_AT);
  const prisma = new PrismaClient();
  try {
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.tenant.deleteMany({ where: { slug: { startsWith: 'e2e-' }, createdAt: { gte: since } } });
    });
    if (removed.count > 0) console.log(`[e2e] ${removed.count} hinterlassene Test-Mandanten entfernt.`);
  } catch (error) {
    // Aufräumen ist Komfort, kein Testergebnis: ist die Datenbank weg, steht der Fehler schon in den Tests selbst.
    console.warn(`[e2e] Aufräumen der Test-Mandanten übersprungen: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}
