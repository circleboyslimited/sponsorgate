import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

export interface Location {
  /** Page route, e.g. "/docs". */
  path: string;
  /** Section inside the page for "#/docs/<section>" links, else null. */
  section: string | null;
}

/** Parse a location hash like "#/docs/faq?x=1" into a page path and an optional section. */
export function parseHash(hash: string): Location {
  const h = hash.replace(/^#/, "");
  if (!h.startsWith("/")) return { path: "/", section: null };
  const clean = h.split("?")[0];
  const m = clean.match(/^\/docs\/([\w-]+)\/?$/);
  return m ? { path: "/docs", section: m[1] } : { path: clean, section: null };
}

function useLocation(): Location {
  const [loc, setLoc] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () =>
      setLoc((prev) => {
        const next = parseHash(window.location.hash);
        // New page: start at the top. Same page, new section: let the page scroll to it.
        if (next.path !== prev.path && !next.section) window.scrollTo({ top: 0 });
        return next;
      });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return loc;
}

export function useRoute(): string {
  return useLocation().path;
}

export function useSection(): string | null {
  return useLocation().section;
}

/** Query parameters after the route, e.g. "#/app?vault=C…" → { vault: "C…" }. */
export function routeParams(hash = window.location.hash): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i === -1 ? "" : hash.slice(i + 1));
}

export function navigate(to: string) {
  window.location.hash = to;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
