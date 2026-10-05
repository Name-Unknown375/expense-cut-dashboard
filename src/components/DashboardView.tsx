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
import { useState } from "react";
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
  "Name this": "bg-violet-100 text-violet-950",
};

export function DashboardView({
  data,
  readOnly = false,
}: {
  data: DashboardData;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [cutLabel, setCutLabel] = useState("Uber Eats");
  const periodQs = new URLSearchParams(data.period.query).toString();
  const showMonthTrend = (data.byMonth?.length ?? 0) > 1;
  const showDay = (data.byDay?.length ?? 0) > 1;
  const showWeek = (data.byWeek?.length ?? 0) > 1 && !showDay;

  function openCategory(categoryId: string) {
    if (readOnly) return;
    router.push(`/category/${categoryId}?${periodQs}`);
  }

  async function markCut(off: boolean) {
    if (readOnly) return;
    await fetch("/api/cuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: cutLabel, off }),
    });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
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

      <div data-brief>
        <section data-usual className="relative overflow-hidden rounded-2xl bg-[var(--ink)] px-6 py-7 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[var(--accent)]/30 blur-3xl" />
          <p className="relative text-sm uppercase tracking-[0.14em] text-white/50">{data.period.label}</p>
          <h1 className="relative mt-2 max-w-3xl font-display text-2xl leading-snug sm:text-3xl">
            {data.awareness.heroLead}
          </h1>
          <p className="relative mt-4 max-w-3xl text-base leading-relaxed text-white/90">{data.brief.lead}</p>
          {data.brief.notSpending && (
            <p className="relative mt-3 max-w-3xl text-base text-white/85">{data.brief.notSpending}</p>
          )}
          {data.awareness.habits.length > 0 && (
            <div className="relative mt-5 max-w-3xl space-y-2 text-sm leading-relaxed text-white/80">
              {data.awareness.habits.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          {data.awareness.overLines.length > 0 && (
            <div className="relative mt-4 max-w-3xl space-y-2 text-sm leading-relaxed text-white/85">
              {data.awareness.overLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <p className="relative mt-4 max-w-3xl text-sm leading-relaxed text-white/80">{data.awareness.ruleLine}</p>
          {data.awareness.ruleNote && (
            <p className="relative mt-2 max-w-3xl text-sm text-white/60">{data.awareness.ruleNote}</p>
          )}
          <p className="relative mt-5 max-w-3xl text-sm leading-relaxed text-white/75">{data.brief.taps}</p>
        </section>
        {data.caps.length > 0 && (
          <div className="mt-8">
            <CapsHold spent={data.spentThisPeriod} rows={data.caps} />
          </div>
        )}
      </div>

      <section data-pace className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-xl text-[var(--ink)]">Pace of the taps</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">{data.pace.note}</p>
        {data.pace.showChart && (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.pace.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="variable" name="Card taps" stroke="#0f766e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ideal" name="50% target" stroke="#94a3b8" strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="font-display text-xl text-[var(--ink)]">{data.story.title}</h2>
        <p className="mt-2 text-sm text-[var(--ink)]">{data.story.lede}</p>
        {data.story.rentNote && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">{data.story.rentNote}</p>
        )}
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {data.story.lines.slice(0, 12).map((line) => (
            <li key={line.what} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {line.categoryId ? (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => openCategory(line.categoryId!)}
                  >
                    {line.what}
                  </button>
                ) : (
                  line.what
                )}
                {line.detail ? <span className="text-[var(--muted)]"> · {line.detail}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-medium tabular-nums">{moneyExact(line.amount)}</span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${verdictStyle[line.verdict]}`}>
                  {line.verdict}
                </span>
                <span className="hidden text-[var(--muted)] sm:inline">{line.sentence}</span>
              </span>
            </li>
          ))}
        </ul>
        {data.story.excluded.length > 0 && (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Kept out of the tap story:{" "}
            {data.story.excluded.map((e) => `${e.name} ${money(e.amount)}`).join(", ")}.
          </p>
        )}
        <p className="mt-3 text-sm text-[var(--muted)]">
          Deposits and e-transfers in are not in this total.
        </p>
      </section>

      {(data.capWarnings.length > 0 || data.watchlists.length > 0) && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Caps and watchlists</h2>
          <ul className="mt-3 space-y-2">
            {data.capWarnings.map((line) => (
              <li key={line} className="rounded-lg bg-[var(--wash)] px-3 py-2 text-sm text-[var(--ink)]">
                {line}
              </li>
            ))}
          </ul>
          {data.watchlists.length > 0 && (
            <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
              {data.watchlists.map((w) => (
                <li key={w.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="font-medium">{w.label}</span>
                  <span className="text-[var(--muted)]">
                    {money(w.spent)} this period · {money(w.avg12)} / mo usual · projected {money(w.projected)} · cap {money(w.capAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!readOnly && <WatchlistForm />}
        </section>
      )}

      {data.subscriptions.length > 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Subscriptions</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">Inferred from charges about a month apart.</p>
          <ul className="divide-y divide-[var(--line)] text-sm">
            {data.subscriptions.map((s) => (
              <li key={s.merchant} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {s.merchant}
                  {s.duplicate ? <span className="text-amber-800"> · possible duplicate</span> : null}
                  {s.jump ? <span className="text-rose-700"> · up {money(s.jump)} vs last charge</span> : null}
                </span>
                <span className="text-[var(--muted)]">
                  {moneyExact(s.lastAmount)} · next around {s.nextDate}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

        <section data-sunday className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl text-[var(--ink)]">Sunday check</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">Week of {data.awareness.sunday.weekLabel}. Same facts on a good week or a bad one.</p>
          <div className="space-y-2 text-sm leading-relaxed text-[var(--ink)]">
            <p>
              The card came out on {data.awareness.sunday.cardDays} day
              {data.awareness.sunday.cardDays === 1 ? "" : "s"}. {data.awareness.sunday.noTapDays} day
              {data.awareness.sunday.noTapDays === 1 ? "" : "s"} had no tap.
            </p>
            <p>{data.awareness.sunday.capsLine}</p>
            <p>{data.awareness.sunday.ruleLine}</p>
            <p>{data.awareness.sunday.cutLine}</p>
          </div>
          {!readOnly && (
            <form
              className="mt-4 flex flex-wrap items-center gap-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void markCut(true);
              }}
            >
              <label>
                Mark a cut off
                <input
                  value={cutLabel}
                  onChange={(e) => setCutLabel(e.target.value)}
                  className="ml-2 rounded-md border border-[var(--line)] px-2 py-1"
                />
              </label>
              <button type="submit" className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-white">
                Keep it off
              </button>
              <button type="button" onClick={() => void markCut(false)} className="rounded-md border border-[var(--line)] px-3 py-1.5">
                Turn it back on
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function CapsHold({
  spent,
  rows,
}: {
  spent: number;
  rows: { id: string; label: string; actual: number; cap: number }[];
}) {
  const [caps, setCaps] = useState(rows.map((r) => r.cap));
  const held = caps.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  const month = Math.max(0, spent - actual + held);
  const under = spent - month;
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-display text-xl text-[var(--ink)]">If these caps hold</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Change a cap if that line should stay. The total updates. This is a choice, not an order.
      </p>
      <ul className="mt-4 space-y-2">
        {rows.map((row, i) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {row.label}{" "}
              <span className="text-[var(--muted)]">this period {money(row.actual)}</span>
            </span>
            <label className="text-[var(--muted)]">
              Cap
              <input
                type="number"
                min={0}
                value={Number.isFinite(caps[i]) ? caps[i] : 0}
                onChange={(e) => {
                  const next = [...caps];
                  next[i] = parseFloat(e.target.value);
                  setCaps(next);
                }}
                className="ml-2 w-24 rounded-md border border-[var(--line)] px-2 py-1 text-[var(--ink)]"
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm font-medium text-[var(--ink)]">
        Month would be about {money(month)}
        {under > 0 ? `, which is ${money(under)} under this period` : ""}.
      </p>
    </section>
  );
}

function WatchlistForm() {
  const [label, setLabel] = useState("Costco");
  const [cap, setCap] = useState("400");
  const router = useRouter();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/watchlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, capAmount: parseFloat(cap) }),
    });
    router.refresh();
  }
  return (
    <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
      <label>
        Watch
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="ml-2 rounded-md border border-[var(--line)] px-2 py-1"
        />
      </label>
      <label>
        Cap
        <input
          type="number"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="ml-2 w-24 rounded-md border border-[var(--line)] px-2 py-1"
        />
      </label>
      <button type="submit" className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-white">
        Save watchlist
      </button>
    </form>
  );
}

