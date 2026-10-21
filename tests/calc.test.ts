import { describe, it, expect } from "vitest";
import { evalArithmetic } from "@/lib/calc";

describe("evalArithmetic — the calculator-in-a-field evaluator", () => {
  it("evaluates a bare number unchanged", () => {
    expect(evalArithmetic("100.01")).toBeCloseTo(100.01);
    expect(evalArithmetic("-5")).toBe(-5);
  });

  it("evaluates +, -, *, / with the usual precedence", () => {
    expect(evalArithmetic("100+5*2")).toBe(110);
    expect(evalArithmetic("(100+5)*2")).toBe(210);
    expect(evalArithmetic("100/4")).toBe(25);
    expect(evalArithmetic("10-2-3")).toBe(5);
  });

  it("handles unary minus and nested parentheses", () => {
    expect(evalArithmetic("-(2+3)*4")).toBe(-20);
    expect(evalArithmetic("((2+3)*(4-1))")).toBe(15);
  });

  it("handles decimals and whitespace", () => {
    expect(evalArithmetic(" 2.5 * 4 ")).toBe(10);
    expect(evalArithmetic(".5+.5")).toBe(1);
  });

  it("rejects division by zero rather than returning Infinity", () => {
    expect(evalArithmetic("5/0")).toBeNull();
  });

  it("rejects anything that isn't arithmetic — never runs arbitrary code", () => {
    expect(evalArithmetic("")).toBeNull();
    expect(evalArithmetic("   ")).toBeNull();
    expect(evalArithmetic("abc")).toBeNull();
    expect(evalArithmetic("1 + ")).toBeNull();
    expect(evalArithmetic("1 + )")).toBeNull();
    expect(evalArithmetic("(1+2")).toBeNull();
    expect(evalArithmetic("process.exit(1)")).toBeNull();
    expect(evalArithmetic("1; alert(1)")).toBeNull();
    expect(evalArithmetic("2**3")).toBeNull(); // no exponent operator in the grammar
    expect(evalArithmetic("5%2")).toBeNull();  // no modulo in the grammar
  });
});
