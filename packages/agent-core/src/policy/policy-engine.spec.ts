import { describe, expect, it } from 'vitest';
import { decidePolicyAction } from './policy-engine';

describe('decidePolicyAction', () => {
  it.each([
    ['DISABLED', 'DENY'],
    ['SUGGEST_ONLY', 'SUGGEST_ONLY'],
    ['REQUIRE_APPROVAL', 'REQUIRE_APPROVAL'],
    ['AUTONOMOUS', 'ALLOW'],
  ] as const)('maps PolicyMode %s to decision %s', (mode, expected) => {
    expect(decidePolicyAction(mode)).toBe(expected);
  });
});
