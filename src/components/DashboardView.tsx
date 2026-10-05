"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { money, moneyExact, pct } from "@/lib/categories";
import type { DashboardData } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DashboardView({
  data,
  readOnly = false,
}: {
  data: DashboardData;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [weekly, setWeekly] = useState(data.weekly);
  const overTarget = data.spentThisMonth > data.target;

  async function toggleWeekly(field: "importDone" | "cutDone" | "paceDone") {
    if (readOnly) return;
    const next = { ...weekly, [field]: !weekly[field] };
    setWeekly(next);
    await fetch("/api/weekly", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekStart: weekly.weekStart,
        [field]: next[field],
      }),
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.14em] text-[var(--accent)]">
            {data.monthLabel}
          </p>
          <h1 className="font-display text-3xl text-[var(--ink)] sm:text-4xl">
            Cut waste. Hit your target.
          </h1>
          <p className="mt-1 max-w-xl text-[var(--muted)]">
            Usual spend sets the bar. Target is half of that. Stay under it.
          </p>
        </div>
        {!readOnly && (
          <label className="text-sm text-[var(--muted)]">
            Month{" "}
            <input
              type="month"
              defaultValue={data.month}
              className="ml-2 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[var(--ink)]"
              onChange={(e) => router.push(`/?month=${e.target.value}`)}
            />
          </label>
        )}
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-[var(--ink)] px-6 py-7 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[var(--accent)]/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-20 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat label="Usual monthly spend" value={money(data.baseline)} hint="Avg of recent months" />
          <HeroStat label="Target (50%)" value={money(data.target)} hint="Half of usual" />
          <HeroStat
            label="Spent this month"
            value={money(data.spentThisMonth)}
            hint={`${pct(data.targetUsedPct)} of target`}
            warn={overTarget}
          />
          <HeroStat
            label="Still can spend"
            value={money(data.remaining)}
            hint={`Projected month-end ${money(data.projected)}`}
            warn={data.projected > data.target}
          />
        </div>
        {data.spendOfIncome != null && (
          <p className="relative mt-4 text-sm text-white/70">
            Spend is {pct(data.spendOfIncome)} of your monthly income
            {data.income ? ` (${money(data.income)})` : ""}.
          </p>
        )}
        <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-white/15">
          <div
            className={`h-full rounded-full transition-all ${
              overTarget ? "bg-rose-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(100, data.targetUsedPct)}%` }}
          />
        </div>
        <p className="relative mt-2 text-sm text-white/70">
          {data.gapToClose > 0
            ? `Pace is above target by about ${money(data.gapToClose)} this month.`
            : "Pace looks on track for the 50% target."}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Categories */}
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">By category</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">Dollars and share of spend</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {data.byBucket.map((b) => (
              <span
                key={b.bucket}
                className="rounded-md bg-[var(--wash)] px-2.5 py-1 text-xs text-[var(--ink)]"
              >
                {b.bucket}: {money(b.amount)} ({pct(b.pct)})
              </span>
            ))}
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byCategory.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => moneyExact(Number(v))} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {data.byCategory.slice(0, 8).map((c) => (
                    <Cell key={c.id} fill={c.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {data.byCategory.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                {readOnly ? (
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                    <span className="text-[var(--muted)]">{c.bucket}</span>
                  </span>
                ) : (
                  <Link
                    href={`/transactions?categoryId=${c.id}&month=${data.month}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                    <span className="text-[var(--muted)]">{c.bucket}</span>
                  </Link>
                )}
                <span className="font-medium">
                  {moneyExact(c.amount)} · {pct(c.pct)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Merchants */}
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Top merchants</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">Where the money went</p>
          <ul className="space-y-2">
            {data.topMerchants.map((m) => (
              <li
                key={m.merchant}
                className="flex items-center justify-between rounded-lg bg-[var(--wash)] px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium text-[var(--ink)]">
                    {m.merchant}
                    {m.recurring && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                        Recurring
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {m.count} purchase{m.count === 1 ? "" : "s"}
                    {m.category ? ` · ${m.category}` : ""}
                  </div>
                </div>
                <div className="font-medium">{moneyExact(m.amount)}</div>
              </li>
            ))}
            {data.topMerchants.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No spend this month yet.</p>
            )}
          </ul>
        </section>
      </div>

      {/* Waste / cut list */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">Waste & cut list</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Ranked actions that close the gap to your 50% target
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {data.cutList.map((item, i) => (
            <article
              key={item.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--wash)] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                    #{i + 1} · {item.kind}
                  </p>
                  <h3 className="font-medium text-[var(--ink)]">{item.title}</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">{item.detail}</p>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg text-[var(--ink)]">
                    {money(item.estimatedMonthly)}
                  </div>
                  <div className="text-xs text-[var(--muted)]">/mo savings</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-[var(--ink)]">
                <span className="font-medium">Do this:</span> {item.action}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Closes ~{pct(item.gapContribution)} of the gap
              </p>
            </article>
          ))}
          {data.cutList.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No clear waste signals yet — keep importing.</p>
          )}
        </div>
      </section>

      {/* Month comparison */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">Month comparison</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          This month vs last month vs usual ({money(data.baseline)} baseline)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">This month</th>
                <th className="pb-2 font-medium">Last month</th>
                <th className="pb-2 font-medium">Usual</th>
              </tr>
            </thead>
            <tbody>
              {data.monthComparison.map((row) => (
                <tr key={row.name} className="border-t border-[var(--line)]">
                  <td className="py-2">{row.name}</td>
                  <td className="py-2">{moneyExact(row.thisMonth)}</td>
                  <td className="py-2">{moneyExact(row.lastMonth)}</td>
                  <td className="py-2">{moneyExact(row.usual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Habits */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Spending rules</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">On track or over — from real transactions</p>
          <ul className="space-y-2">
            {data.ruleStatus.map((r) => (
              <li
                key={r.id}
                className={`rounded-lg border px-3 py-3 text-sm ${
                  r.status === "over"
                    ? "border-rose-200 bg-rose-50"
                    : "border-emerald-200 bg-emerald-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--ink)]">{r.name}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                      r.status === "over"
                        ? "bg-rose-200 text-rose-900"
                        : "bg-emerald-200 text-emerald-900"
                    }`}
                  >
                    {r.status === "over" ? "Over" : "On track"}
                  </span>
                </div>
                <p className="mt-1 text-[var(--muted)]">{r.detail}</p>
              </li>
            ))}
            {data.ruleStatus.length === 0 && (
              <p className="text-sm text-[var(--muted)]">
                {readOnly ? "No rules set." : "Add rules in Settings."}
              </p>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Weekly review</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Week of {weekly.weekStart} — three quick checks
          </p>
          <ul className="space-y-3">
            {(
              [
                ["importDone", "Import and categorize new spend"],
                ["cutDone", "Cut or cap one waste item"],
                ["paceDone", "Check pace vs your 50% target"],
              ] as const
            ).map(([field, label]) => (
              <li key={field}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-[var(--wash)] px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={Boolean(weekly[field])}
                    onChange={() => toggleWeekly(field)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className={weekly[field] ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"}>
                    {label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-white/60">{label}</p>
      <p className={`font-display text-3xl ${warn ? "text-rose-300" : "text-white"}`}>{value}</p>
      <p className="text-xs text-white/60">{hint}</p>
    </div>
  );
}
