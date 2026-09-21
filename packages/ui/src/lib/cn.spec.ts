import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    const zero = 0;
    expect(cn('a', false, undefined, 'b', null, zero && 'c')).toBe('a b');
  });

  it('resolves conflicting Tailwind utility classes, keeping the last one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
