import { describe, expect, it } from 'vitest';
import { CONNECTOR_REGISTRY, getConnectorMetadata } from './connector-registry';

/** Every `IntegrationConnectorType` enum value (packages/domain/prisma/schema.prisma) — duplicated here deliberately rather than imported, see connector-registry.ts's own header comment on why this package has no @orbit/domain dependency. */
const EXPECTED_CONNECTOR_IDS = ['DATEV', 'LEXWARE', 'MICROSOFT', 'GMAIL', 'GOOGLE_CALENDAR', 'HUBSPOT', 'TWILIO'] as const;

describe('CONNECTOR_REGISTRY', () => {
  it('has exactly one entry per known IntegrationConnectorType value, no more, no fewer', () => {
    expect(CONNECTOR_REGISTRY.map((c) => c.id).sort()).toEqual([...EXPECTED_CONNECTOR_IDS].sort());
  });

  it('has no duplicate ids', () => {
    const ids = CONNECTOR_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry declares at least one capability', () => {
    for (const connector of CONNECTOR_REGISTRY) {
      expect(connector.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('api_key connectors declare their required fields; oauth2 connectors need none (the OAuth button is the whole form)', () => {
    for (const connector of CONNECTOR_REGISTRY) {
      if (connector.authentication.type === 'api_key') {
        expect(connector.requiredFields.length).toBeGreaterThan(0);
      } else if (connector.authentication.type === 'oauth2') {
        expect(connector.requiredFields).toEqual([]);
      }
    }
  });
});

describe('getConnectorMetadata', () => {
  it('returns the matching entry by id', () => {
    expect(getConnectorMetadata('GMAIL')?.provider).toBe('Google');
  });

  it('returns undefined for an unknown id', () => {
    expect(getConnectorMetadata('NOT_A_REAL_CONNECTOR')).toBeUndefined();
  });
});
