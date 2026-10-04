import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from './capability';
import { validateBlueprintDefinition } from './blueprint-validator';

const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, ...extra });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

const base = () => ({
  schemaVersion: '1.0',
  key: 'REQUEST_FOR_QUOTE',
  version: '1.0.0',
  title: 'Angebotsanfrage',
  goals: ['quote.delivered'],
  triggers: [{ type: 'communication.received' }],
  requiredFacts: [{ key: 'request.quantity', type: 'number' }],
  allowedCapabilities: ['requirements.resolve', 'communication.draft', 'email.send'],
  planMode: 'CONSTRAINED_ADAPTIVE',
  referenceGraph: {
    nodes: [
      node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      node('draft', 'PREPARE', { capability: { key: 'communication.draft' } }),
      node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' } } }),
      node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 48 } }),
    ],
    edges: [edge('e1', 'resolve', 'draft'), edge('e2', 'draft', 'ask'), edge('e3', 'ask', 'wait')],
  },
  completionCriteria: { receiptConfirmed: { purpose: 'QUOTE_DELIVERY' } },
});

const codes = (input: unknown) => validateBlueprintDefinition(input, catalogue).issues.filter((i) => i.severity === 'ERROR').map((i) => i.code);

describe('validateBlueprintDefinition', () => {
  it('accepts a coherent blueprint', () => {
    // `sender.email` is not declared, but binding an unknown fact on an external write must be reported ...
    expect(codes(base())).toContain('BINDING_UNKNOWN_FACT');
    // ... and is fixed by declaring the fact as collectable requirement.
    const declared = base();
    declared.requiredFacts.push({ key: 'sender.email', type: 'email' });
    expect(codes(declared)).toEqual([]);
  });

  it('rejects unknown capabilities, unknown constraints and free-form keys', () => {
    const unknownCap = base();
    unknownCap.allowedCapabilities.push('payment.execute');
    expect(codes(unknownCap)).toContain('CAPABILITY_UNKNOWN');
    expect(codes({ ...base(), constraints: { run_anything: true } })).toContain('SCHEMA_INVALID');
    expect(codes({ ...base(), onStart: 'curl evil' })).toContain('SCHEMA_INVALID');
  });

  it('requires a reference graph unless the blueprint is ad hoc', () => {
    const withoutGraph: Record<string, unknown> = { ...base() };
    delete withoutGraph.referenceGraph;
    expect(codes(withoutGraph)).toContain('REFERENCE_GRAPH_MISSING');
    expect(codes({ ...withoutGraph, planMode: 'AD_HOC' })).not.toContain('REFERENCE_GRAPH_MISSING');
  });

  it('requires checkable completion criteria', () => {
    expect(codes({ ...base(), completionCriteria: { capabilityAvailable: 'email.send' } })).toContain('COMPLETION_NOT_CHECKABLE');
  });

  it('checks the reference graph with the plan validator (cycle, invented recipient)', () => {
    const cyclic = base();
    cyclic.referenceGraph.edges.push(edge('e4', 'ask', 'draft'));
    expect(codes(cyclic)).toContain('CYCLE');
    const invented = base();
    invented.referenceGraph.nodes[2] = node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { literal: 'a@b.example' } } });
    expect(codes(invented)).toContain('INVENTED_PARAMETER');
  });
});
