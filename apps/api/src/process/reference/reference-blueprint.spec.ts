import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CAPABILITIES, validateBlueprintDefinition } from '@orbit/shared';
import { ReferenceFixtureSchema } from './reference-process.service';

const FIXTURES = join(__dirname, '../../../../../fixtures/process');
const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));

describe('process fixtures', () => {
  it('the request-for-quote reference blueprint passes the blueprint validator without errors', () => {
    const blueprint: unknown = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8'));
    const result = validateBlueprintDefinition(blueprint, catalogue);
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('the reference blueprint holds no prices, recipients or tenant data (it is process data, not content)', () => {
    const text = readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8');
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d+[.,]\d{2}\s?(EUR|€)/);
  });

  it('the test system-of-record fixture matches its schema', () => {
    const data: unknown = JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8'));
    const parsed = ReferenceFixtureSchema.parse(data);
    expect(parsed.catalog.length).toBeGreaterThan(0);
    expect(new Set(parsed.catalog.map((c) => c.sku)).size).toBe(parsed.catalog.length);
  });
});
