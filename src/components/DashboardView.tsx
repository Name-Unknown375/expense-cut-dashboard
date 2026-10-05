"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { money, moneyExact, pct } from "@/lib/categories";
import type { DashboardData } from "@/lib/analytics";
import type { Verdict } from "@/lib/insights";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PeriodFilter } from "./PeriodFilter";
import { AiInsightPanel } from "./AiInsightPanel";

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

export function DashboardView({
  data,
  readOnly = false,
}: {
  data: DashboardData;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [weekly, setWeekly] = useState(data.weekly);
  const [nextAction, setNextAction] = useState(data.disposition.nextAction);
  const overTarget = data.spentThisPeriod > data.target;
  const periodQs = new URLSearchParams(data.period.query).toString();
  const showMonthTrend = (data.byMonth?.length ?? 0) > 1;
  const showDay = (data.byDay?.length ?? 0) > 1;
  const showWeek = (data.byWeek?.length ?? 0) > 1 && !showDay;

  useEffect(() => {
    setNextAction(data.disposition.nextAction);
    let cancelled = false;
    fetch(`/api/ai-insights?${periodQs}`)
      .then((r) => r.json())
      .then((body) => {
        const line = body?.insight?.nextAction;
        if (cancelled || typeof line !== "string") return;
        if (/\$\s?\d/.test(line) && !/import more|tighten one want/i.test(line)) {
          setNextAction(line);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [periodQs, data.disposition.nextAction]);

  function openCategory(categoryId: string) {
    if (readOnly) return;
    router.push(`/category/${categoryId}?${periodQs}`);
  }

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
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-[var(--accent)]">
          {data.period.label}
        </p>
        <h1 className="font-display text-3xl text-[var(--ink)] sm:text-4xl">
          Cut waste. Hit your target.
        </h1>
        <p className="mt-1 max-w-xl text-[var(--muted)]">
          Verdicts first — then the charts. Every line should answer what to do next.
        </p>
      </div>

      {!readOnly && (
        <PeriodFilter
          initial={{
            mode: data.period.mode,
            month: data.period.query.month,
            year: data.period.query.year,
            from: data.period.query.from,
            to: data.period.query.to,
          }}
        />
      )}

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-[var(--ink)] px-6 py-7 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[var(--accent)]/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-20 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat label="Usual monthly spend" value={money(data.baseline)} hint="Avg of recent months" />
          <HeroStat
            label="Target (50%)"
            value={money(data.target)}
            hint={
              data.period.mode === "month"
                ? "Half of usual"
                : "Half of usual, scaled to this period"
            }
          />
          <HeroStat
            label="Spent in this period"
            value={money(data.spentThisPeriod)}
            hint={`${pct(data.targetUsedPct)} of target`}
            warn={overTarget}
          />
          <HeroStat
            label={data.period.mode === "month" ? "Still can spend" : "vs prior period"}
            value={
              data.period.mode === "month"
                ? money(data.remaining)
                : money(data.spentThisPeriod - data.spentPrevPeriod)
            }
            hint={
              data.period.mode === "month"
                ? `Projected period-end ${money(data.projected)}`
                : `Prior window ${money(data.spentPrevPeriod)}`
            }
            warn={
              data.period.mode === "month"
                ? data.projected > data.target
                : data.spentThisPeriod > data.spentPrevPeriod
            }
          />
        </div>
        <div className="relative mt-5 rounded-xl bg-white/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-white/50">Do this next</p>
          <p className="mt-1 text-lg">{nextAction}</p>
        </div>
        <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-white/15">
          <div
            className={`h-full rounded-full transition-all ${
              overTarget ? "bg-rose-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(100, data.targetUsedPct)}%` }}
          />
        </div>
      </section>

      {/* Disposition table — primary actionable insight */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl text-[var(--ink)]">What to do with this spend</h2>
            <p className="text-sm text-[var(--muted)]">
              What · Amount · Verdict — plain calls, not a dump
            </p>
          </div>
        </div>
        {data.disposition.note && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {data.disposition.note}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="pb-2 font-medium">What</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.disposition.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3">
                    {readOnly || !row.categoryId ? (
                      <span className="text-[var(--ink)]">{row.what}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openCategory(row.categoryId!)}
                        className="text-left text-[var(--ink)] hover:underline"
                      >
                        {row.what}
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 font-medium tabular-nums">
                    {moneyExact(row.amount)}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${verdictStyle[row.verdict]}`}
                    >
                      {row.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!readOnly && <AiInsightPanel periodQuery={periodQs} />}

      {/* Where the taps are */}
      {data.taps.lines.length > 0 && (
        <section className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--ink)] px-6 py-6 text-white shadow-lg">
          <div className="pointer-events-none absolute -left-8 top-0 h-40 w-40 rounded-full bg-[var(--accent)]/25 blur-3xl" />
          <h2 className="font-display relative text-2xl">Where the taps are</h2>
          <p className="relative mt-2 max-w-2xl text-sm text-white/75">{data.taps.intro}</p>
          <ul className="relative mt-4 space-y-2">
            {data.taps.lines.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2 text-sm last:border-0"
              >
                {readOnly || !line.categoryId ? (
                  <span>
                    <span className="font-medium">{line.merchant}</span>
                    <span className="text-white/60">, {line.phrase}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openCategory(line.categoryId!)}
                    className="text-left hover:underline"
                  >
                    <span className="font-medium">{line.merchant}</span>
                    <span className="text-white/60">, {line.phrase}</span>
                  </button>
                )}
                <span className="font-display text-base tabular-nums">
                  {moneyExact(line.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="relative mt-4 text-sm text-white/80">{data.taps.outro}</p>
        </section>
      )}

      {/* Waste / cut list — keep, actionable */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">Waste & cut list</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Ranked moves that close the gap to your 50% target
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
                  <div className="text-xs text-[var(--muted)]">est. savings</div>
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

      {/* Trend charts — polish */}
      {(showMonthTrend || showDay || showWeek) && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">
            {showMonthTrend ? "Spend by month" : showDay ? "Spend by day" : "Spend by week"}
          </h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Pattern check for {data.period.label}
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              {showMonthTrend || showWeek ? (
                <BarChart data={showMonthTrend ? data.byMonth : data.byWeek}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => moneyExact(Number(v))} />
                  <Bar dataKey="amount" fill="#c45c26" radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => moneyExact(Number(v))} />
                  <Line type="monotone" dataKey="amount" stroke="#c45c26" strokeWidth={2} dot={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">By category</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Click a bar or name for taps, one-offs, and what to cut
          </p>
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
              <BarChart
                data={data.byCategory.slice(0, 8)}
                style={{ cursor: readOnly ? "default" : "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => moneyExact(Number(v))} />
                <Bar
                  dataKey="amount"
                  radius={[4, 4, 0, 0]}
                  onClick={(entry) => {
                    const id = (entry as { id?: string })?.id;
                    if (id) openCategory(id);
                  }}
                >
                  {data.byCategory.slice(0, 8).map((c) => (
                    <Cell key={c.id} fill={c.color} cursor={readOnly ? "default" : "pointer"} />
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
                  <button
                    type="button"
                    onClick={() => openCategory(c.id)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                    <span className="text-[var(--muted)]">{c.bucket}</span>
                    <span className="text-xs text-[var(--accent)]">Open →</span>
                  </button>
                )}
                <span className="font-medium">
                  {moneyExact(c.amount)} · {pct(c.pct)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Top merchants</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Click through to every purchase at that place
          </p>
          <ul className="space-y-2">
            {data.topMerchants.map((m) => (
              <li
                key={m.merchant}
                className="flex items-center justify-between rounded-lg bg-[var(--wash)] px-3 py-2 text-sm"
              >
                <div>
                  {readOnly ? (
                    <div className="font-medium text-[var(--ink)]">
                      {m.merchant}
                      {m.recurring && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          Recurring
                        </span>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={`/transactions?merchant=${encodeURIComponent(m.merchant)}&${periodQs}`}
                      className="font-medium text-[var(--ink)] hover:underline"
                    >
                      {m.merchant}
                      {m.recurring && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          Recurring
                        </span>
                      )}
                    </Link>
                  )}
                  <div className="text-xs text-[var(--muted)]">
                    {m.count} purchase{m.count === 1 ? "" : "s"}
                    {m.category ? ` · ${m.category}` : ""}
                  </div>
                </div>
                <div className="font-medium">{moneyExact(m.amount)}</div>
              </li>
            ))}
            {data.topMerchants.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No spend in this period yet.</p>
            )}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">Period comparison</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          This period vs prior window vs usual monthly ({money(data.baseline)} baseline)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">This period</th>
                <th className="pb-2 font-medium">Prior period</th>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Spending rules</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            On track or over — from purchases in this period
          </p>
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
                ["importDone", "Import new spend (auto-categorized)"],
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
                  <span
                    className={
                      weekly[field] ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"
                    }
                  >
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
