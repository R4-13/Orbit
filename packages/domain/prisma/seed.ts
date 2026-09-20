/**
 * Demo-data seed script. Populates the "Musterwerk GmbH" demo tenant
 * (§43–§45 of the master spec) once the full schema exists — implemented
 * in Phase 13 (Demo-Daten). Currently a no-op placeholder so `pnpm
 * prisma:seed` has a valid entry point from Phase 1 onward.
 */
async function main() {
  // eslint-disable-next-line no-console
  console.log(
    '[seed] Placeholder — demo data (Musterwerk GmbH) is seeded starting Phase 13.',
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
