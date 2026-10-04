import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * Minimal hash router (#/path). Hash URLs work on any static host,
 * GitHub Pages included, with no server-side rewrites.
 */
function current(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h.split("?")[0] : "/";
}

export function useRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => {
      setRoute(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
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

/** Sets document.title for the current page. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
