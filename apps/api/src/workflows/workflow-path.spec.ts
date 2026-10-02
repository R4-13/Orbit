import { UNTRUSTED_CONTENT_TAG } from '@orbit/agent-core';
import { buildWorkflowStepMessage, evaluateWorkflowCondition, resolveWorkflowPath, type WorkflowPathContext } from './workflow-path';

/** Strips the `wrapUntrustedContent()` tags buildWorkflowStepMessage() now applies, so tests can assert on the underlying JSON. */
function parseWrappedMessage(message: string): unknown {
  expect(message.startsWith(`<${UNTRUSTED_CONTENT_TAG}>\n`)).toBe(true);
  expect(message.endsWith(`\n</${UNTRUSTED_CONTENT_TAG}>`)).toBe(true);
  const inner = message.slice(`<${UNTRUSTED_CONTENT_TAG}>\n`.length, -`\n</${UNTRUSTED_CONTENT_TAG}>`.length);
  return JSON.parse(inner);
}

describe('resolveWorkflowPath', () => {
  const context: WorkflowPathContext = {
    trigger: { input: { subject: 'Anfrage zu Ihrem Angebot', fromAddress: 'kunde@example.com' } },
    steps: {
      1: { output: { classify_message: { category: 'SALES' } } },
      2: { output: { create_company: { id: 'company_1' }, create_contact: { id: 'contact_1' } } },
    },
  };

  it('resolves a $.trigger.input.<field> path', () => {
    expect(resolveWorkflowPath(context, '$.trigger.input.subject')).toBe('Anfrage zu Ihrem Angebot');
  });

  it('resolves a $.steps[N].output.<toolName>.<field> path', () => {
    expect(resolveWorkflowPath(context, '$.steps[1].output.classify_message.category')).toBe('SALES');
    expect(resolveWorkflowPath(context, '$.steps[2].output.create_company.id')).toBe('company_1');
  });

  it('returns undefined for a non-existent step', () => {
    expect(resolveWorkflowPath(context, '$.steps[99].output.create_lead.id')).toBeUndefined();
  });

  it('returns undefined for a non-existent field', () => {
    expect(resolveWorkflowPath(context, '$.trigger.input.doesNotExist')).toBeUndefined();
  });

  it('returns undefined for a malformed path instead of throwing', () => {
    expect(resolveWorkflowPath(context, '$.trigger.input!!')).toBeUndefined();
    expect(resolveWorkflowPath(context, '$.steps[1].output.classify_message.category.tooDeep')).toBeUndefined();
  });
});

describe('evaluateWorkflowCondition', () => {
  const context: WorkflowPathContext = {
    trigger: { input: {} },
    steps: { 1: { output: { classify_message: { category: 'FINANCE' } } } },
  };

  it('returns true when the resolved value equals the expected string', () => {
    expect(
      evaluateWorkflowCondition(context, { field: '$.steps[1].output.classify_message.category', equals: 'FINANCE' }),
    ).toBe(true);
  });

  it('returns false when it does not match', () => {
    expect(
      evaluateWorkflowCondition(context, { field: '$.steps[1].output.classify_message.category', equals: 'SALES' }),
    ).toBe(false);
  });

  it('returns false (not throws) when the path resolves to undefined', () => {
    expect(evaluateWorkflowCondition(context, { field: '$.steps[99].output.x.y', equals: 'SALES' })).toBe(false);
  });
});

describe('buildWorkflowStepMessage', () => {
  const context: WorkflowPathContext = {
    trigger: { input: { subject: 'Hallo', bodyText: 'Text' } },
    steps: { 1: { output: { create_company: { id: 'company_1' } } } },
  };

  it('passes the full trigger input through when there is no mapping', () => {
    expect(parseWrappedMessage(buildWorkflowStepMessage(context, undefined))).toEqual({ subject: 'Hallo', bodyText: 'Text' });
    expect(parseWrappedMessage(buildWorkflowStepMessage(context, {}))).toEqual({ subject: 'Hallo', bodyText: 'Text' });
  });

  it('resolves every mapping entry into a flat object', () => {
    const message = buildWorkflowStepMessage(context, {
      companyId: '$.steps[1].output.create_company.id',
      subject: '$.trigger.input.subject',
    });
    expect(parseWrappedMessage(message)).toEqual({ companyId: 'company_1', subject: 'Hallo' });
  });

  it('wraps the serialized message so the receiving agent treats it as data, not instructions', () => {
    const message = buildWorkflowStepMessage(context, undefined);
    expect(message).toBe(`<${UNTRUSTED_CONTENT_TAG}>\n${JSON.stringify(context.trigger.input)}\n</${UNTRUSTED_CONTENT_TAG}>`);
  });
});
