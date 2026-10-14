import type { INestApplication } from '@nestjs/common';
import type { ToolRegistry } from '@orbit/agent-core';
import { DEFAULT_CAPABILITIES } from '@orbit/shared';
import { z } from 'zod';
import { TOOL_REGISTRY } from '../src/agent/agent.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Die Steckbriefe der Fähigkeiten (`contract`) sind das, was die KI beim Planen liest und die Prüfung erzwingt. Sie dürfen nicht von den echten Werkzeugen abweichen –
 * sonst würde ein Plan entweder zu Unrecht abgelehnt oder (schlimmer) bestätigt und scheitert dann bei der Ausführung.
 */
describe('Steckbriefe der Fähigkeiten stimmen mit den Werkzeugen überein (e2e)', () => {
  let app: INestApplication;
  let registry: ToolRegistry;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    registry = app.get<ToolRegistry>(TOOL_REGISTRY);
  });
  afterAll(async () => {
    await app.close();
  });

  for (const capability of DEFAULT_CAPABILITIES) {
    it(`${capability.key}: Eingaben (Name und Pflicht) entsprechen dem Schema des Werkzeugs`, () => {
      expect(capability.contract).toBeDefined();
      const tool = registry.get(capability.toolBindings[0] as string);
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as unknown;
      expect(schema instanceof z.ZodObject).toBe(true);
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      // `purpose` setzt die Ausführung aus `config.purpose` – es ist keine Eingabe des Plans.
      const toolInputs = Object.keys(shape).filter((k) => k !== 'purpose');
      const contractInputs = capability.contract!.inputs;
      expect(contractInputs.map((i) => i.name).sort()).toEqual(toolInputs.sort());
      for (const input of contractInputs) {
        expect({ name: input.name, required: input.required }).toEqual({ name: input.name, required: !shape[input.name]!.isOptional() });
      }
    });
  }
});
