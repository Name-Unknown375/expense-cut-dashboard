"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PeriodMode } from "@/lib/period";

const STORAGE_KEY = "expense-cut-period";

export type PeriodState = {
  mode: PeriodMode;
  month: string;
  year: string;
  from: string;
  to: string;
};

function todayParts() {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const year = String(d.getFullYear());
  const day = String(d.getDate()).padStart(2, "0");
  const from = `${month}-01`;
  const to = `${month}-${day}`;
  return { month, year, from, to };
}

export function loadStickyPeriod(fallbackMonth?: string): PeriodState {
  const base = todayParts();
  if (typeof window === "undefined") {
    return {
      mode: "month",
      month: fallbackMonth || base.month,
      year: base.year,
      from: base.from,
      to: base.to,
    };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PeriodState;
      if (parsed?.mode) return { ...base, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return {
    mode: "month",
    month: fallbackMonth || base.month,
    year: base.year,
    from: base.from,
    to: base.to,
  };
}

export function periodToQuery(p: PeriodState): string {
  const filled = withDefaults(p);
  if (filled.mode === "year") return `period=year&year=${encodeURIComponent(filled.year)}`;
  if (filled.mode === "range")
    return `period=range&from=${encodeURIComponent(filled.from)}&to=${encodeURIComponent(filled.to)}`;
  return `period=month&month=${encodeURIComponent(filled.month)}`;
}

function withDefaults(p: PeriodState): PeriodState {
  const base = todayParts();
  return {
    mode: p.mode || "month",
    month: /^\d{4}-\d{2}$/.test(p.month || "") ? p.month : base.month,
    year: /^\d{4}$/.test(p.year || "") ? p.year : base.year,
    from: /^\d{4}-\d{2}-\d{2}$/.test(p.from || "") ? p.from : base.from,
    to: /^\d{4}-\d{2}-\d{2}$/.test(p.to || "") ? p.to : base.to,
  };
}

function mergePeriod(base: PeriodState, initial?: Partial<PeriodState>): PeriodState {
  return withDefaults({
    mode: initial?.mode || base.mode,
    month: initial?.month || base.month,
    year: initial?.year || base.year,
    from: initial?.from || base.from,
    to: initial?.to || base.to,
  });
}

export function PeriodFilter({
  initial,
  readOnly = false,
}: {
  initial?: Partial<PeriodState>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PeriodState>(() =>
    mergePeriod(loadStickyPeriod(initial?.month), initial)
  );

  useEffect(() => {
    if (readOnly) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, readOnly]);

  function apply(next: PeriodState) {
    const filled = withDefaults(next);
    setState(filled);
    if (!readOnly) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filled));
      router.push(`/?${periodToQuery(filled)}`);
    }
  }

  if (readOnly) return null;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--ink)]">Show spend for</span>
        {(
          [
            ["month", "One month"],
            ["range", "Date range"],
            ["year", "Full year"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => apply({ ...state, mode })}
            className={`rounded-md px-3 py-1.5 text-sm ${
              state.mode === mode
                ? "bg-[var(--ink)] text-white"
                : "bg-[var(--wash)] text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {state.mode === "month" && (
          <label className="text-sm text-[var(--muted)]">
            Month
            <input
              type="month"
              value={state.month}
              onChange={(e) => apply({ ...state, month: e.target.value })}
              className="ml-2 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[var(--ink)]"
            />
          </label>
        )}
        {state.mode === "year" && (
          <label className="text-sm text-[var(--muted)]">
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={state.year}
              onChange={(e) => apply({ ...state, year: e.target.value })}
              className="ml-2 w-24 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[var(--ink)]"
            />
          </label>
        )}
        {state.mode === "range" && (
          <>
            <label className="text-sm text-[var(--muted)]">
              From
              <input
                type="date"
                value={state.from}
                onChange={(e) => apply({ ...state, from: e.target.value })}
                className="ml-2 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[var(--ink)]"
              />
            </label>
            <label className="text-sm text-[var(--muted)]">
              To
              <input
                type="date"
                value={state.to}
                onChange={(e) => apply({ ...state, to: e.target.value })}
                className="ml-2 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[var(--ink)]"
              />
            </label>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Filter sticks for this browser tab until you change it.
      </p>
    </div>
  );
}
