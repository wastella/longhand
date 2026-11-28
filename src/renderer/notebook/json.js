// JSON read and written the way Jupyter writes it, so saving an untouched notebook gives back
// the same bytes. Python's json.dumps(sort_keys=True, indent=1, ensure_ascii=False) differs from
// JSON.stringify in ways that show up in a diff: keys are sorted, numbers keep Python's spelling
// (1e-05, 1.0), and only control characters are escaped. Numbers therefore stay as the text they
// were read as (a JsonNumber), so a float in metadata is written back exactly as it was.

/** A number as it was spelled in the file. */
export class JsonNumber {
  constructor(raw) {
    this.raw = raw;
  }
  valueOf() {
    return Number(this.raw);
  }
}

/** The number a parsed value holds, whether it was read (JsonNumber) or made here (number). */
export const numberOf = (value) => (value instanceof JsonNumber ? Number(value.raw) : value);

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const SPACE = /[ \t\n\r]*/y;

/** Parses JSON text, keeping each number as a JsonNumber. Throws a SyntaxError on bad input. */
export function parseJson(text) {
  let at = 0;
  const fail = (what) => {
    throw new SyntaxError(`${what} at character ${at}`);
  };
  const skip = () => {
    SPACE.lastIndex = at;
    SPACE.exec(text);
    at = SPACE.lastIndex;
  };
  const string = () => {
    const start = at;
    let end = at + 1;
    for (;;) {
      const quote = text.indexOf('"', end);
      if (quote < 0) fail('Unterminated string');
      let slashes = 0;
      while (text[quote - 1 - slashes] === '\\') slashes++;
      end = quote + 1;
      if (slashes % 2 === 0) break;
    }
    at = end;
    const body = text.slice(start + 1, end - 1);
    // JSON.parse does the escapes (and refuses raw control characters); plain strings, nearly
    // all of them, are sliced as they are.
    return /[\\\u0000-\u001f]/.test(body) ? JSON.parse(text.slice(start, end)) : body;
  };
  const value = () => {
    skip();
    const c = text[at];
    if (c === '{') {
      at++;
      const object = {};
      skip();
      if (text[at] === '}') return (at++, object);
      for (;;) {
        skip();
        if (text[at] !== '"') fail('Expected a key');
        const key = string();
        skip();
        if (text[at++] !== ':') fail('Expected ":"');
        Object.defineProperty(object, key, { value: value(), enumerable: true, writable: true, configurable: true });
        skip();
        const next = text[at++];
        if (next === '}') return object;
        if (next !== ',') fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      at++;
      const array = [];
      skip();
      if (text[at] === ']') return (at++, array);
      for (;;) {
        array.push(value());
        skip();
        const next = text[at++];
        if (next === ']') return array;
        if (next !== ',') fail('Expected "," or "]"');
      }
    }
    if (c === '"') return string();
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ])
      if (text.startsWith(word, at)) return ((at += word.length), result);
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) fail('Unexpected character');
    at = NUMBER.lastIndex;
    return new JsonNumber(match[0]);
  };
  const result = value();
  skip();
  if (at < text.length) fail('Unexpected text after the end');
  return result;
}

/** Python's repr of a float made here (not read from the file): 1e-05, 1.0, 1e+16. */
function pythonNumber(n) {
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : n < 0 ? '-Infinity' : 'NaN';
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  const [digits, exp] = n.toExponential().split('e');
  const e = Number(exp);
  if (e < -4 || e >= 16) return `${digits}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  const plain = String(n);
  return plain.includes('.') ? plain : `${plain}.0`;
}

const SHORT = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

/** A string as Python's json.dumps(ensure_ascii=False) writes it. */
function quote(s) {
  return (
    '"' +
    s.replace(
      /["\\\u0000-\u001f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (c) => SHORT[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ) +
    '"'
  );
}

/** Python sorts keys by code point; JavaScript's default sort compares UTF-16 units. */
const byCodePoint = (a, b) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  return x.length - y.length;
};
const isAscii = (s) => !/[^\x00-\x7f]/.test(s);
const sortKeys = (keys) => (keys.every(isAscii) ? keys.sort() : keys.sort(byCodePoint));

/** `value` as Python's json.dumps(value, sort_keys=True, indent=1, ensure_ascii=False) writes it, with `eol` between lines. */
export function dumpJson(value, eol = '\n') {
  const out = [];
  const write = (v, indent) => {
    if (v === null || v === undefined) return out.push('null');
    if (v === true) return out.push('true');
    if (v === false) return out.push('false');
    if (v instanceof JsonNumber) return out.push(v.raw);
    if (typeof v === 'number') return out.push(pythonNumber(v));
    if (typeof v === 'string') return out.push(quote(v));
    const inner = indent + ' ';
    if (Array.isArray(v)) {
      if (!v.length) return out.push('[]');
      out.push('[');
      v.forEach((item, i) => {
        out.push(i ? ',' : '', eol, inner);
        write(item, inner);
      });
      return out.push(eol, indent, ']');
    }
    const keys = sortKeys(Object.keys(v).filter((key) => v[key] !== undefined));
    if (!keys.length) return out.push('{}');
    out.push('{');
    keys.forEach((key, i) => {
      out.push(i ? ',' : '', eol, inner, quote(key), ': ');
      write(v[key], inner);
    });
    out.push(eol, indent, '}');
  };
  write(value, '');
  return out.join('');
}

// What Python's str.splitlines() breaks at, besides \n and \r\n.
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

/** Python's str.splitlines(True): the lines of `s`, each keeping its line break. */
export function splitLines(s) {
  const lines = [];
  let last = 0;
  for (const match of s.matchAll(LINE_BREAK)) {
    lines.push(s.slice(last, match.index + match[0].length));
    last = match.index + match[0].length;
  }
  if (last < s.length) lines.push(s.slice(last));
  return lines;
}

/** A multi-line field as nbformat stores it (a string or a list of lines), as one string. */
export const joinLines = (value) => (Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '');
