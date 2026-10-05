// @vitest-environment happy-dom
// (happy-dom shares Node's realm, so the SDK's crypto sees its own Uint8Array; jsdom breaks Keypair.random())
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// Pages render with the network unavailable: every request fails fast.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in tests"))));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function at(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

describe("pages", () => {
  it("renders Home with its headline and title", () => {
    at("#/");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(document.title).toMatch(/·/);
  });

  it("renders the App page", () => {
    at("#/app");
    expect(document.title).toMatch(/^(App|Dashboard|Studio|Claim|Policy console) ·/);
  });

  it("renders Docs with its sections", () => {
    at("#/docs");
    for (const name of [/Getting started/, /Concepts/, /FAQ/]) {
      expect(screen.getAllByRole("heading", { name }).length).toBeGreaterThan(0);
    }
  });

  it("shows the 404 page for unknown routes", () => {
    at("#/nope");
    expect(screen.getByText("404")).toBeTruthy();
    expect(document.title).toMatch(/^Not found/);
  });

  it("has exactly one main landmark on every page", () => {
    for (const hash of ["#/", "#/app", "#/docs", "#/nope"]) {
      at(hash);
      expect(document.querySelectorAll("main")).toHaveLength(1);
      cleanup();
    }
  });
});
