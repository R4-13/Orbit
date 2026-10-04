/**
 * Maintenance entry point for FalseSuccessRepairService (Amendment 02 §24.3).
 *
 *   pnpm --filter @orbit/api exec ts-node scripts/repair-false-success.ts <target.json>
 *
 * `<target.json>` holds a FalseSuccessRepairTarget (tenant, connection,
 * source message id, intake event, workflow run, agent run, failed tool,
 * reason, executedBy). Requires DATABASE_URL_APP in the environment
 * (`source .env`). Prints the before/after status; changes nothing if the
 * persisted evidence does not prove the failure.
 */
import { readFileSync } from 'node:fs';
import type { OrbitEnv } from '@orbit/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { FalseSuccessRepairService, type FalseSuccessRepairTarget } from '../src/repair/false-success-repair.service';

async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) throw new Error('Usage: ts-node scripts/repair-false-success.ts <target.json>');
  const databaseUrl = process.env.DATABASE_URL_APP;
  if (!databaseUrl) throw new Error('DATABASE_URL_APP is not set (source .env first).');

  const target = JSON.parse(readFileSync(targetPath, 'utf8')) as FalseSuccessRepairTarget;
  const prisma = new PrismaService({ DATABASE_URL_APP: databaseUrl } as OrbitEnv);
  try {
    const result = await new FalseSuccessRepairService(prisma).repair(target);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
