import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walks up from `startDir` to find the monorepo root (marked by
 * `pnpm-workspace.yaml`) and returns the path to its `.env` file, if both
 * the root and that file exist.
 *
 * Used so `ConfigModule.forRoot({ envFilePath })` in `apps/api` reliably
 * loads the repo's single root `.env` no matter where the process's cwd
 * happens to be (`apps/api/src` under `nest start --watch`,
 * `apps/api/dist/src` when compiled, `apps/api/worker` for the queue
 * processor) — NestJS's own default (`.env` relative to `process.cwd()`)
 * silently loads nothing in all of those cases, which previously only
 * worked because a dev shell happened to already have the variables
 * exported. In a Docker image, `.env` is never shipped (real secrets come
 * from the container's own environment), so this correctly returns
 * `undefined` there and `ConfigModule` falls back to its harmless default.
 */
export function findRepoRootEnvFile(startDir: string, maxLevels = 8): string | undefined {
  let dir = startDir;
  for (let i = 0; i < maxLevels; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const envPath = join(dir, '.env');
      return existsSync(envPath) ? envPath : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}
