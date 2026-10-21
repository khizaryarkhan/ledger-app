/**
 * A tiny, safe arithmetic evaluator for numeric entry fields (Rate, Qty,
 * Amount) — typing "100+5*2" into a field and tabbing out computes 110,
 * the same calculator-in-a-box behaviour QuickBooks' own amount fields have.
 *
 * Deliberately NOT `eval`/`new Function` — this is a hand-written recursive-
 * descent parser over a fixed grammar (+ - * / parentheses, unary minus,
 * decimals only), so there is no way for it to execute anything beyond
 * arithmetic on numbers, regardless of what string reaches it.
 */

const TOKEN_RE = /\s*(?:(\d+\.?\d*|\.\d+)|([+\-*/()]))/y;

type Token = { kind: "num"; value: number } | { kind: "op"; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < input.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(input);
    if (!m || m.index !== pos) return null; // unrecognized character (letters, %, etc.)
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: "op", value: m[2] });
  }
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}
  private peek() { return this.tokens[this.i]; }
  private next() { return this.tokens[this.i++]; }

  parse(): number | null {
    const v = this.expression();
    if (v == null || this.i !== this.tokens.length) return null; // trailing garbage
    return v;
  }
  private expression(): number | null {
    let v = this.term();
    if (v == null) return null;
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const rhs = this.term();
        if (rhs == null) return null;
        v = t.value === "+" ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  }
  private term(): number | null {
    let v = this.factor();
    if (v == null) return null;
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        const rhs = this.factor();
        if (rhs == null) return null;
        if (t.value === "/") { if (rhs === 0) return null; v = v / rhs; }
        else v = v * rhs;
      } else break;
    }
    return v;
  }
  private factor(): number | null {
    const t = this.peek();
    if (!t) return null;
    if (t.kind === "op" && t.value === "-") { this.next(); const v = this.factor(); return v == null ? null : -v; }
    if (t.kind === "op" && t.value === "+") { this.next(); return this.factor(); }
    if (t.kind === "num") { this.next(); return t.value; }
    if (t.kind === "op" && t.value === "(") {
      this.next();
      const v = this.expression();
      const close = this.peek();
      if (v == null || !close || close.kind !== "op" || close.value !== ")") return null;
      this.next();
      return v;
    }
    return null;
  }
}

/**
 * Evaluates a typed arithmetic expression. Returns `null` for anything that
 * isn't valid arithmetic (so the caller can revert to the last good value)
 * rather than throwing — this runs on every blur of a numeric field.
 */
export function evalArithmetic(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length === 0) return null;
  const result = new Parser(tokens).parse();
  if (result == null || !Number.isFinite(result)) return null;
  return result;
}
