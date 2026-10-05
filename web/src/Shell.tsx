import { useEffect, useRef, useState, type ReactNode } from "react";

import { Link, useTitle } from "./lib/router";

const NAV = [
  ["/", "Home"],
  ["/app", "Policy console"],
  ["/docs", "Docs"],
] as const;

const REPO = "https://github.com/circleboyslimited/sponsorgate";

function HeaderAction() {
  return (
    <a className="act act-ind inline-block" href={REPO} target="_blank" rel="noreferrer">
      GitHub ↗
    </a>
  );
}

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Close on navigation; Escape closes and hands focus back to the toggle.
  useEffect(() => setOpen(false), [route]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
            <span className="text-lg font-extrabold text-carbon">sponsorgate</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} className={`rounded-lg px-3.5 py-2 text-sm font-bold ${route === to ? "bg-indigo text-white" : "text-gray hover:bg-indigo-soft hover:text-indigo"}`}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block">
            <HeaderAction />
          </div>
          <button className="act act-out px-3 py-2 md:hidden" onClick={() => setOpen((v) => !v)} ref={toggleRef} aria-label="Menu" aria-controls="mobile-menu" aria-expanded={open}>
            {open ? "✕" : "☰"}
          </button>
        </div>
        {open && (
          <div id="mobile-menu" ref={menuRef} className="space-y-1 border-t border-border px-5 py-4 md:hidden" onClick={() => setOpen(false)}>
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} className={`block rounded-lg px-3.5 py-2 text-sm font-bold ${route === to ? "bg-indigo text-white" : "text-gray hover:bg-indigo-soft hover:text-indigo"}`}>
                {label}
              </Link>
            ))}
            <div className="pt-2">
              <HeaderAction />
            </div>
          </div>
        )}
        
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-border bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-lg font-extrabold text-carbon">sponsorgate</p>
            <p className="mt-2 max-w-xs text-sm text-gray">Policy-checked fee sponsorship for Stellar. Gasless UX without an open wallet.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-carbon">Product</p>
            <ul className="mt-3 space-y-2 text-gray">
              <li><Link to="/app" className="hover:underline">Policy console</Link></li>
              <li><Link to="/docs" className="hover:underline">Documentation</Link></li>
              <li><Link to="/docs/faq" className="hover:underline">FAQ</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-carbon">Open source</p>
            <ul className="mt-3 space-y-2 text-gray">
              <li><a href={REPO} target="_blank" rel="noreferrer" className="hover:underline">GitHub</a></li>
              
              <li><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="hover:underline">MIT license</a></li>
            </ul>
          </div>
        </div>
        <p className="pb-8 text-center text-xs text-gray opacity-80">The console runs entirely in your browser. Fund a sponsor account only with what you intend to spend.</p>
      </footer>
    </div>
  );
}

export function NotFound() {
  useTitle("Not found · sponsorgate");
  return (
    <section className="mx-auto max-w-xl px-5 py-28 text-center">
      <p className="text-8xl font-extrabold tracking-tight text-indigo">404</p>
      <p className="mt-4 text-lg text-gray">There’s nothing at this address.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/" className="act act-ind inline-block">Back home</Link>
        <Link to="/docs" className="act act-out inline-block">Read the docs</Link>
      </div>
    </section>
  );
}
