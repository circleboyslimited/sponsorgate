import { describe, expect, it } from "vitest";

// The router reads window.location.hash; check the parsing rule in isolation.
const parse = (hash: string) => {
  const h = hash.replace(/^#/, "");
  return h.startsWith("/") ? h.split("?")[0] : "/";
};

describe("hash route parsing", () => {
  it("maps empty and non-route hashes to home", () => {
    expect(parse("")).toBe("/");
    expect(parse("#features")).toBe("/");
  });
  it("keeps the path and drops query strings", () => {
    expect(parse("#/docs")).toBe("/docs");
    expect(parse("#/app?vault=C123")).toBe("/app");
  });
});
