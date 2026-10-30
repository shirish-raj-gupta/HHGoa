import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { CategoryConfig } from '@receipts/core';
import { CATEGORY_CONFIGS, guessCategory, reviewJsonSchema } from '../src';

describe('categories', () => {
  it('the generated file matches the YAML (run pnpm categories:gen after editing)', () => {
    const dir = join(__dirname, '..', 'configs');
    const fromYaml = readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .sort()
      .map((f) => CategoryConfig.parse(parse(readFileSync(join(dir, f), 'utf8'))));
    expect(CATEGORY_CONFIGS).toEqual(fromYaml);
  });

  it('covers the eight categories in the plan', () => {
    expect(CATEGORY_CONFIGS.map((c) => c.category).sort()).toEqual(
      ['agents_apis', 'food', 'groceries', 'landlords', 'local_services', 'products', 'subscriptions', 'travel'].sort(),
    );
  });

  it('routes stage questions to the right category', () => {
    expect(guessCategory('best veg biryani under ₹400 near Calangute')?.category).toBe('food');
    expect(guessCategory('quietest hotel near Calangute for remote work')?.category).toBe('travel');
    expect(guessCategory('best power bank under ₹1,500')?.category).toBe('products');
  });

  it('review schemas list every aspect', () => {
    const food = CATEGORY_CONFIGS.find((c) => c.category === 'food')!;
    const schema = reviewJsonSchema(food);
    expect(schema.properties.aspects.required).toEqual(food.aspects);
  });
});
