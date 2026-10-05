"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ readOnly = false }: { readOnly?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href={readOnly ? "#" : "/"} className="font-display text-lg tracking-tight text-[var(--ink)]">
          Expense Cut
        </Link>
        {!readOnly && (
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 transition ${
                    active
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="ml-1 rounded-md px-3 py-1.5 text-[var(--muted)] hover:bg-[var(--wash)]"
            >
              Sign out
            </button>
          </nav>
        )}
        {readOnly && (
          <span className="rounded-md bg-[var(--wash)] px-3 py-1 text-xs text-[var(--muted)]">
            Read-only share
          </span>
        )}
      </div>
    </header>
  );
}
