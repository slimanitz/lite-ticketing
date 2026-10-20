export type FlagValue = string | boolean | string[];

export interface Parsed {
  positional: string[];
  flags: Record<string, FlagValue>;
}

export interface ArgSpec {
  /** short -> long, e.g. { d: 'desc' } */
  aliases?: Record<string, string>;
  /** flags that never take a value */
  booleans?: string[];
  /** flags that may be repeated and collect into an array */
  multi?: string[];
}

export function parseArgs(argv: string[], spec: ArgSpec = {}): Parsed {
  const aliases = spec.aliases ?? {};
  const booleans = new Set(spec.booleans ?? []);
  const multi = new Set(spec.multi ?? []);
  const flags: Record<string, FlagValue> = {};
  const positional: string[] = [];

  const set = (key: string, value: string | boolean) => {
    if (multi.has(key)) {
      const cur = flags[key];
      const arr = Array.isArray(cur) ? cur : [];
      if (typeof value === 'string') arr.push(value);
      flags[key] = arr;
    } else {
      flags[key] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      let key = tok.slice(2);
      let value: string | undefined;
      const eq = key.indexOf('=');
      if (eq !== -1) {
        value = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      if (key.startsWith('no-') && value === undefined) {
        set(key.slice(3), false);
        continue;
      }
      if (value !== undefined) {
        set(key, value);
      } else if (booleans.has(key)) {
        set(key, true);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !(next.startsWith('-') && next.length > 1 && !/^-\d/.test(next))) {
          set(key, next);
          i++;
        } else {
          set(key, true);
        }
      }
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
      // short flags: -d value, -dvalue, -ab (two booleans)
      const body = tok.slice(1);
      const first = body[0]!;
      const long = aliases[first] ?? first;
      if (body.length > 1 && !booleans.has(long)) {
        set(long, body.slice(1));
        continue;
      }
      if (booleans.has(long)) {
        for (const ch of body) set(aliases[ch] ?? ch, true);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !(next.startsWith('-') && next.length > 1 && !/^-\d/.test(next))) {
        set(long, next);
        i++;
      } else {
        set(long, true);
      }
      continue;
    }
    positional.push(tok);
  }
  return { positional, flags };
}

export function str(flags: Record<string, FlagValue>, key: string): string | undefined {
  const v = flags[key];
  if (v === undefined || v === false) return undefined;
  if (v === true) return '';
  if (Array.isArray(v)) return v[v.length - 1];
  return v;
}

export function bool(flags: Record<string, FlagValue>, key: string): boolean {
  const v = flags[key];
  return v === true || v === 'true' || v === '1';
}

export function list(flags: Record<string, FlagValue>, key: string): string[] {
  const v = flags[key];
  if (v === undefined || v === false || v === true) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
}
