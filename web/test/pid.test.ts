import { describe, expect, it } from 'vitest';
import { pidToJa } from '../lib/pid';

describe('pidToJa', () => {
  it('m.a398_2.p1.i2 → 第三百九十八条の二第一項第二号', () => {
    expect(pidToJa('m.a398_2.p1.i2')).toBe('第三百九十八条の二第一項第二号');
  });
});
