import { describe, expect, it } from 'vitest';
import { RAILS } from '@receipts/core';
import { BRANDS, brandForEmailDomain, getBrand } from '../src';

describe('brand registry', () => {
  it('every brand has at least one rail and a valid default', () => {
    for (const b of BRANDS) {
      expect(b.rails.length).toBeGreaterThan(0);
      expect(RAILS).toContain(b.defaultRail);
      expect(b.rails.map((r) => r.rail)).toContain(b.defaultRail);
    }
  });

  it('ids are unique', () => {
    expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
  });

  it('maps DKIM domains to brands, including subdomains', () => {
    expect(brandForEmailDomain('swiggy.in')?.id).toBe('swiggy');
    expect(brandForEmailDomain('customer.goindigo.in')?.id).toBe('indigo');
    expect(brandForEmailDomain('evil-swiggy.in')).toBeNull();
  });

  it('parses a typical food order email', () => {
    const p = getBrand('swiggy').email!;
    const body = 'Your order from Pizza Corner was delivered.\nOrder No: 168452936512\n2 x Veg Dum Biryani ₹ 340\nGrand Total: ₹ 412.50';
    expect(p.orderId[0]!.exec(body)?.[1]).toBe('168452936512');
    expect(p.total[0]!.exec(body)?.[1]).toBe('412.50');
    expect(p.merchant![0]!.exec(body)?.[1]).toBe('Pizza Corner');
    const items = [...body.matchAll(p.items![0]!)];
    expect(items[0]?.[2]).toBe('Veg Dum Biryani');
  });
});
