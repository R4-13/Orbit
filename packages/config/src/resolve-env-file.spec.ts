import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRepoRootEnvFile } from './resolve-env-file';

describe('findRepoRootEnvFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orbit-env-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the root .env when starting several directories deep', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgresql://example\n');
    const deepDir = join(root, 'apps', 'api', 'dist', 'src');
    mkdirSync(deepDir, { recursive: true });

    expect(findRepoRootEnvFile(deepDir)).toBe(join(root, '.env'));
  });

  it('returns undefined when pnpm-workspace.yaml is found but .env is not (e.g. a Docker image)', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    const deepDir = join(root, 'apps', 'api', 'dist', 'src');
    mkdirSync(deepDir, { recursive: true });

    expect(findRepoRootEnvFile(deepDir)).toBeUndefined();
  });

  it('returns undefined when no pnpm-workspace.yaml exists within maxLevels', () => {
    const deepDir = join(root, 'a', 'b', 'c');
    mkdirSync(deepDir, { recursive: true });

    expect(findRepoRootEnvFile(deepDir, 2)).toBeUndefined();
  });
});
