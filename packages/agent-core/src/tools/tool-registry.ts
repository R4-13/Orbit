import { zodToJsonSchema } from 'zod-to-json-schema';
import { ValidationFailedError } from '@orbit/shared';
import type { LLMToolDefinition } from '../llm/types';
import type { ToolDefinition, ToolExecutionContext } from './types';

// zod-to-json-schema's generic return-type inference can blow up
// TypeScript's instantiation depth limit (TS2589) when the input schema
// type isn't already fully concrete at the call site — which it never is
// here, since ToolRegistry stores heterogeneous ToolDefinition<any, any>
// values. Routing the call through an untyped indirection sidesteps that
// inference entirely; the result is cast to a plain JSON Schema shape
// immediately below, so this doesn't weaken any other type safety.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zodToJsonSchemaUntyped = zodToJsonSchema as (schema: any) => unknown;

/**
 * Holds every tool an agent may call. Each tool declares its input as a
 * Zod schema once; the registry derives both the JSON Schema handed to the
 * LLM (`toLLMToolDefinitions`) and the runtime validation applied to
 * whatever arguments the LLM actually sends back (`execute`) from that
 * single schema, so the two can never drift apart.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns a new registry containing only the named tools — the
   * additive extension point docs/AGENT_STUDIO_CONCEPT.md builds
   * per-agent tool scoping on (AgentDefinition.allowedTools). Fails
   * fast on an unknown name so a bad configuration is caught when it's
   * saved, not silently dropped at agent-run time.
   */
  subset(toolNames: readonly string[]): ToolRegistry {
    const scoped = new ToolRegistry();
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool "${name}" — cannot build a subset registry.`);
      }
      scoped.register(tool);
    }
    return scoped;
  }

  toLLMToolDefinitions(): LLMToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      // No `name` argument: that switches zod-to-json-schema into "named"
      // mode ($ref + definitions), but Anthropic's tool `input_schema`
      // needs the flat, inlined schema.
      inputSchema: zodToJsonSchemaUntyped(tool.inputSchema) as Record<string, unknown>,
    }));
  }

  /**
   * Like `toLLMToolDefinitions()`, but also includes `policyAction` — the
   * capability catalog docs/AGENT_STUDIO_CONCEPT.md's Agent Studio reads
   * to build its tool-selection UI (apps/api's AgentDefinitionsService).
   * Kept here rather than duplicating the zod-to-json-schema workaround
   * above in apps/api.
   */
  describe(): Array<{ name: string; description: string; policyAction: string; inputSchema: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      policyAction: tool.policyAction,
      inputSchema: zodToJsonSchemaUntyped(tool.inputSchema) as Record<string, unknown>,
    }));
  }

  /** Validates `rawInput` against the tool's Zod schema, then executes it. */
  async execute(name: string, rawInput: unknown, context: ToolExecutionContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool "${name}".`);
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationFailedError(`Invalid input for tool "${name}".`, {
        issues: parsed.error.issues,
      });
    }

    return tool.execute(parsed.data, context);
  }
}
