import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { isOrbitError } from '@orbit/shared';
import { ToolRegistry } from './tool-registry';
import type { ToolDefinition } from './types';

const ECHO_TOOL: ToolDefinition<{ message: string }, { echoed: string }> = {
  name: 'echo',
  description: 'Echoes the given message back.',
  inputSchema: z.object({ message: z.string().min(1) }),
  policyAction: 'crm.activity.log',
  execute: async (input) => ({ echoed: input.message }),
};

describe('ToolRegistry', () => {
  it('register() rejects a duplicate tool name', () => {
    const registry = new ToolRegistry();
    registry.register(ECHO_TOOL);
    expect(() => registry.register(ECHO_TOOL)).toThrow(/already registered/);
  });

  it('toLLMToolDefinitions() derives a JSON Schema from the Zod schema', () => {
    const registry = new ToolRegistry();
    registry.register(ECHO_TOOL);

    const [definition] = registry.toLLMToolDefinitions();
    expect(definition?.name).toBe('echo');
    expect(definition?.inputSchema).toMatchObject({
      type: 'object',
      properties: { message: { type: 'string', minLength: 1 } },
      required: ['message'],
    });
  });

  it('execute() validates input against the schema and rejects invalid input', async () => {
    const registry = new ToolRegistry();
    registry.register(ECHO_TOOL);

    let caught: unknown;
    try {
      await registry.execute('echo', { message: '' }, { tenantId: 't1', agentRunId: 'r1' });
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('execute() calls the tool with the parsed input on success', async () => {
    const registry = new ToolRegistry();
    registry.register(ECHO_TOOL);

    const result = await registry.execute('echo', { message: 'hi' }, { tenantId: 't1', agentRunId: 'r1' });
    expect(result).toEqual({ echoed: 'hi' });
  });

  it('execute() throws for an unregistered tool name', async () => {
    const registry = new ToolRegistry();
    await expect(
      registry.execute('does-not-exist', {}, { tenantId: 't1', agentRunId: 'r1' }),
    ).rejects.toThrow(/unknown tool/i);
  });
});
