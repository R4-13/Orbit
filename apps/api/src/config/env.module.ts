import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@orbit/config';
import { ORBIT_ENV } from './env.token';

/**
 * Provides the Zod-validated OrbitEnv (see @orbit/config) as an injectable,
 * typed alternative to NestJS's untyped ConfigService. Loaded once at
 * bootstrap (see main.ts, which also calls loadEnv() directly to fail fast
 * before Nest's DI container even spins up) and reused via DI everywhere
 * else, instead of every service reading `process.env` ad hoc.
 */
@Global()
@Module({
  providers: [{ provide: ORBIT_ENV, useFactory: () => loadEnv() }],
  exports: [ORBIT_ENV],
})
export class EnvModule {}
