import { describe, expect, it } from 'vitest';
import { parseCaseCommand } from './commands';
import { BLUEPRINT_TRANSITIONS, BlueprintDefinitionSchema, canTransitionBlueprint } from './blueprint';
import { CapabilityDefinitionSchema, DEFAULT_CAPABILITIES } from './capability';

const COMMAND_ID = '3f2b8f0e-6a41-4d0c-9f43-0d5d0f6e2f10';

describe('case commands', () => {
  it('accepts a well-formed command and validates the payload by type', () => {
    const parsed = parseCaseCommand({
      commandId: COMMAND_ID,
      type: 'ADD_FACTS',
      expectedCaseRevision: 3,
      payload: { facts: [{ key: 'delivery.address', value: 'Musterstr. 1' }] },
    });
    expect(parsed.ok).toBe(true);
  });

  it('rejects tenant / actor smuggling and unknown fields (server derives them)', () => {
    const base = { commandId: COMMAND_ID, type: 'PAUSE', expectedCaseRevision: 1, payload: {} };
    expect(parseCaseCommand({ ...base, tenantId: 'other' }).ok).toBe(false);
    expect(parseCaseCommand({ ...base, userId: 'someone' }).ok).toBe(false);
    expect(parseCaseCommand({ ...base, payload: { tenantId: 'other' } }).ok).toBe(false);
  });

  it('requires expectedCaseRevision and a uuid commandId', () => {
    expect(parseCaseCommand({ commandId: COMMAND_ID, type: 'PAUSE', payload: {} }).ok).toBe(false);
    expect(parseCaseCommand({ commandId: 'not-a-uuid', type: 'PAUSE', expectedCaseRevision: 1 }).ok).toBe(false);
  });

  it('rejects unknown command types and empty draft edits', () => {
    expect(parseCaseCommand({ commandId: COMMAND_ID, type: 'DELETE_EVERYTHING', expectedCaseRevision: 1 }).ok).toBe(false);
    expect(parseCaseCommand({ commandId: COMMAND_ID, type: 'EDIT_DRAFT', expectedCaseRevision: 1, payload: { draftId: 'd1' } }).ok).toBe(false);
  });
});

describe('blueprint schema and lifecycle', () => {
  const minimal = {
    schemaVersion: '1.0',
    key: 'REQUEST_FOR_QUOTE',
    version: '1.0.0',
    title: 'Angebotsanfrage',
    goals: ['quote.delivered'],
    triggers: [{ type: 'communication.received' }],
    allowedCapabilities: ['email.send'],
    planMode: 'CONSTRAINED_ADAPTIVE',
    completionCriteria: { receiptConfirmed: { purpose: 'QUOTE_DELIVERY' } },
  };

  it('accepts a minimal blueprint and applies defaults', () => {
    const parsed = BlueprintDefinitionSchema.parse(minimal);
    expect(parsed.requiredFacts).toEqual([]);
    expect(parsed.constraints).toEqual({});
  });

  it('rejects unknown execution-relevant keys and unknown constraints', () => {
    expect(BlueprintDefinitionSchema.safeParse({ ...minimal, shellCommand: 'rm -rf /' }).success).toBe(false);
    expect(BlueprintDefinitionSchema.safeParse({ ...minimal, constraints: { do_whatever: true } }).success).toBe(false);
  });

  it('allows only documented lifecycle transitions; published versions cannot return to draft', () => {
    expect(canTransitionBlueprint('DRAFT', 'VALIDATING')).toBe(true);
    expect(canTransitionBlueprint('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransitionBlueprint('PUBLISHED', 'DRAFT')).toBe(false);
    expect(BLUEPRINT_TRANSITIONS.ARCHIVED).toEqual([]);
  });
});

describe('capability catalogue', () => {
  it('every default capability satisfies the schema and keys are unique', () => {
    for (const capability of DEFAULT_CAPABILITIES) expect(CapabilityDefinitionSchema.safeParse(capability).success).toBe(true);
    const keys = DEFAULT_CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('external writes are high risk, hash-idempotent and need provider confirmation', () => {
    for (const capability of DEFAULT_CAPABILITIES.filter((c) => c.sideEffect === 'EXTERNAL_WRITE')) {
      expect(capability.riskClass).toBe('HIGH');
      expect(capability.idempotencyStrategy).not.toBe('NONE');
      expect(capability.confirmationStrategy).toBe('PROVIDER_RECEIPT');
    }
  });
});
