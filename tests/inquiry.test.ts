import { describe, expect, it } from 'vitest';
import { validate, type Inquiry } from '../src/site/inquiry';

const ok: Inquiry = { name: 'Ona', phone: '+370 600 12345', email: '', needed_by: '', delivery: false, address: '', message: 'Rožių puokštė gimtadieniui' };

describe('inquiry validation', () => {
  it('accepts a minimal order', () => expect(validate(ok)).toEqual({}));
  it('flags each bad field by name', () => {
    const e = validate({ ...ok, name: 'O', phone: 'skambinkit', email: 'ona@', delivery: true, address: '', message: '' });
    expect(Object.keys(e).sort()).toEqual(['address', 'email', 'message', 'name', 'phone']);
  });
  it('needs an address only for delivery', () => {
    expect(validate({ ...ok, delivery: true, address: 'Artojų g. 3, Teleičiai' })).toEqual({});
  });
});
