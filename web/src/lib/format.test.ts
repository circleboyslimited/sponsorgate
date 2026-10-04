import { describe, expect, it } from "vitest";
import { fromUnits, short, timeLeft, toUnits } from "./format";

describe("format", () => {
  it("round-trips amounts", () => {
    expect(fromUnits(12_345_000_000n)).toBe("1,234.5");
    expect(toUnits("1,234.5")).toBe(12_345_000_000n);
    expect(toUnits(".0000001")).toBe(1n);
  });
  it("rejects bad amounts", () => {
    expect(() => toUnits("1.00000001")).toThrow();
    expect(() => toUnits("-1")).toThrow();
    expect(() => toUnits("abc")).toThrow();
  });
  it("shortens addresses and formats relative time", () => {
    expect(short("GABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("GABC…WXYZ");
    expect(timeLeft(1000 + 3 * 86_400, 1000)).toBe("in 3d");
    expect(timeLeft(1000 - 7200, 1000)).toBe("2h ago");
  });
});
