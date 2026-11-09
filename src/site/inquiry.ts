// Order form -> Supabase table `inquiries` (supabase/schema.sql) over REST.

export interface Inquiry {
  name: string;
  phone: string;
  email: string;
  needed_by: string;
  delivery: boolean;
  address: string;
  message: string;
}

export type Errors = Partial<Record<keyof Inquiry, string>>;

const env = import.meta.env as Record<string, string | undefined>;
const URL_ = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const KEY = env.VITE_SUPABASE_ANON_KEY;
export const connected = Boolean(URL_ && KEY);

export function readForm(form: HTMLFormElement): Inquiry {
  const d = new FormData(form);
  const s = (k: string): string => String(d.get(k) ?? '').trim();
  return {
    name: s('name'),
    phone: s('phone'),
    email: s('email'),
    needed_by: s('needed_by'),
    delivery: s('delivery') === 'yes',
    address: s('address'),
    message: s('message'),
  };
}

/** Mirrors the table's checks. */
export function validate(q: Inquiry): Errors {
  const e: Errors = {};
  if (q.name.length < 2) e.name = 'Įrašykite vardą.';
  else if (q.name.length > 120) e.name = 'Per ilgas vardas.';
  const digits = q.phone.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15 || !/^[+\d\s()-]+$/.test(q.phone)) e.phone = 'Patikrinkite numerį.';
  if (q.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) e.email = 'Patikrinkite el. paštą.';
  if (q.delivery && q.address.length < 5) e.address = 'Įrašykite adresą.';
  if (q.message.length < 5) e.message = 'Parašykite, kokios puokštės norite.';
  else if (q.message.length > 2000) e.message = 'Per ilga žinutė.';
  if (q.needed_by.length > 80) e.needed_by = 'Per ilgas.';
  return e;
}

export async function send(q: Inquiry): Promise<void> {
  if (!URL_ || !KEY) throw new Error('not-connected');
  const res = await fetch(`${URL_}/rest/v1/inquiries`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...q, address: q.delivery ? q.address : '' }),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
}
