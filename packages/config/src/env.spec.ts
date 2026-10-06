import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const MINIMAL_VALID_ENV = {
  DATABASE_URL: 'postgresql://orbit:orbit@localhost:5432/orbit',
  DATABASE_URL_APP: 'postgresql://orbit_app:orbit_app@localhost:5432/orbit',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  JWT_SECRET: 'a'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadEnv', () => {
  it('parses a minimal valid env and fills in documented defaults', () => {
    const env = loadEnv(MINIMAL_VALID_ENV);

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.FINANCE_CONNECTOR).toBe('mock');
    expect(env.CRM_CONNECTOR).toBe('mock');
  });

  it('coerces numeric and boolean string env vars to the correct type', () => {
    const env = loadEnv({
      ...MINIMAL_VALID_ENV,
      API_PORT: '4000',
      S3_FORCE_PATH_STYLE: 'false',
      OTEL_ENABLED: 'true',
    });

    expect(env.API_PORT).toBe(4000);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.OTEL_ENABLED).toBe(true);
  });

  it('fails fast with a descriptive, per-field error when required vars are missing', () => {
    expect(() => loadEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('rejects a JWT_SECRET shorter than 16 characters', () => {
    expect(() =>
      loadEnv({ ...MINIMAL_VALID_ENV, JWT_SECRET: 'too-short' }),
    ).toThrowError(/JWT_SECRET/);
  });

  it('rejects an unknown enum value for a connector selection', () => {
    expect(() =>
      loadEnv({ ...MINIMAL_VALID_ENV, FINANCE_CONNECTOR: 'sap' }),
    ).toThrow();
  });
});

describe('Plattformdomäne (Amendment 03)', () => {
  it('ist ohne PLATFORM_JWT_SECRET ausgeschaltet, nicht mit einem Standardwert aktiv', () => {
    const env = loadEnv(MINIMAL_VALID_ENV);
    expect(env.PLATFORM_JWT_SECRET).toBeUndefined();
    expect(env.ORBIT_ENVIRONMENT).toBe('development');
  });

  it('verlangt ein eigenes, ausreichend langes Secret', () => {
    expect(() => loadEnv({ ...MINIMAL_VALID_ENV, PLATFORM_JWT_SECRET: 'short' })).toThrow(/PLATFORM_JWT_SECRET/);
    expect(() => loadEnv({ ...MINIMAL_VALID_ENV, PLATFORM_JWT_SECRET: MINIMAL_VALID_ENV.JWT_SECRET })).toThrow(/must differ from JWT_SECRET/);
    expect(loadEnv({ ...MINIMAL_VALID_ENV, PLATFORM_JWT_SECRET: 'p'.repeat(40) }).PLATFORM_JWT_SECRET).toBe('p'.repeat(40));
  });
});
