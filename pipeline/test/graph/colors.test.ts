import { describe, expect, it } from 'vitest';
import { buildCategoryColors, CATEGORY_NAMES, colorKey, GROUP_DEFS } from '../../src/graph/categories.ts';

describe('category colors', () => {
  it('assigns 50 unique colors in listed order', () => {
    const { categories, groups } = buildCategoryColors();
    expect(CATEGORY_NAMES).toHaveLength(50);
    expect(categories).toHaveLength(50);
    expect(groups).toHaveLength(13);
    expect(categories.map((c) => c.id)).toEqual([...Array(50).keys()]);
    expect(categories.map((c) => c.name)).toEqual(CATEGORY_NAMES);
    const keys = categories.map((c) => colorKey(c.color));
    expect(new Set(keys).size).toBe(50);
    expect(groups.map((g) => g.name)).toEqual(GROUP_DEFS.map((g) => g.name));
  });
});
