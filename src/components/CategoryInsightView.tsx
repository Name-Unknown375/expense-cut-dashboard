"use client";

import Link from "next/link";
import { money, moneyExact } from "@/lib/categories";
import type { CategoryInsight, Verdict } from "@/lib/insights";

const verdictStyle: Record<Verdict, string> = {
  Fixed: "bg-slate-200 text-slate-800",
  "One-time": "bg-sky-100 text-sky-900",
  "Main leak": "bg-rose-200 text-rose-900",
  "Cap it": "bg-orange-200 text-orange-950",
  "Pick one": "bg-amber-200 text-amber-950",
  Fine: "bg-emerald-100 text-emerald-900",
  Keep: "bg-teal-100 text-teal-900",
  "Skip next month": "bg-fuchsia-100 text-fuchsia-900",
  Watch: "bg-yellow-100 text-yellow-900",
};

export function CategoryInsightView({
  insight,
  periodQuery,
}: {
  insight: CategoryInsight;
  periodQuery: string;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/?${periodQuery}`}
        className="text-sm text-[var(--accent)] hover:underline"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-4 overflow-hidden rounded-2xl bg-[var(--ink)] px-6 py-7 text-white shadow-lg">
        <p className="text-xs uppercase tracking-[0.14em] text-white/60">
          {insight.periodLabel} · {insight.bucket}
        </p>
        <h1 className="font-display mt-1 text-3xl sm:text-4xl">{insight.categoryName}</h1>
        <p className="mt-2 text-white/75">{insight.summary}</p>
        <p className="font-display mt-4 text-4xl">{money(insight.total)}</p>
        <div className="mt-5 rounded-xl bg-white/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-white/50">Do this next</p>
          <p className="mt-1 text-lg text-white">{insight.nextAction}</p>
        </div>
      </div>

      {insight.repeats.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Repeat purchases / taps</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Same place, more than once — this is usually where cuts stick
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {insight.repeats.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link
                    href={`/transactions?merchant=${encodeURIComponent(r.merchant)}&${periodQuery}`}
                    className="font-medium text-[var(--ink)] hover:underline"
                  >
                    {r.merchant}
                  </Link>
                  <p className="text-sm text-[var(--muted)]">
                    {r.count} · {r.phrase}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${verdictStyle[r.verdict]}`}
                  >
                    {r.verdict}
                  </span>
                  <span className="w-20 text-right font-medium">{moneyExact(r.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {insight.oneOffs.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">One-offs</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">Single hits — decide keep, skip, or one-time</p>
          <ul className="divide-y divide-[var(--line)]">
            {insight.oneOffs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-[var(--ink)]">{o.merchant}</p>
                  <p className="text-sm text-[var(--muted)]">{o.date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${verdictStyle[o.verdict]}`}
                  >
                    {o.verdict}
                  </span>
                  <span className="w-20 text-right font-medium">{moneyExact(o.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-center text-sm">
        <Link
          href={`/transactions?categoryId=${insight.categoryId}&${periodQuery}`}
          className="text-[var(--accent)] underline"
        >
          See every purchase in {insight.categoryName}
        </Link>
      </p>
    </main>
  );
}
