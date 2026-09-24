/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // `worker/` (apps/api/worker) is a second source tree outside
  // `rootDir` (see apps/api/tsconfig.json's `include: ["src/**/*",
  // "worker/**/*"]`) — without this, its *.spec.ts files are silently
  // never discovered by `pnpm test`. Found live while adding the first
  // real test under worker/ (docs/SCALABILITY_CONCEPT.md,
  // workflow-run.processor.spec.ts).
  roots: ['<rootDir>', '<rootDir>/../worker'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  passWithNoTests: true,
};
