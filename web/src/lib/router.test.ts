import { describe, expect, it } from "vitest";
import { parseHash, routeParams } from "./router";

describe("parseHash", () => {
  it("maps empty and non-route hashes to home", () => {
    expect(parseHash("")).toEqual({ path: "/", section: null });
    expect(parseHash("#features")).toEqual({ path: "/", section: null });
  });
  it("keeps the path and drops query strings", () => {
    expect(parseHash("#/docs").path).toBe("/docs");
    expect(parseHash("#/app?vault=C123").path).toBe("/app");
  });
  it("splits docs sections off the path", () => {
    expect(parseHash("#/docs/faq")).toEqual({ path: "/docs", section: "faq" });
    expect(parseHash("#/docs/getting-started/")).toEqual({ path: "/docs", section: "getting-started" });
  });
  it("leaves other nested paths alone", () => {
    expect(parseHash("#/app/extra")).toEqual({ path: "/app/extra", section: null });
  });
});

describe("routeParams", () => {
  it("reads parameters after the route", () => {
    expect(routeParams("#/app?vault=C123&tab=pay").get("vault")).toBe("C123");
    expect(routeParams("#/app").get("vault")).toBeNull();
  });
});
