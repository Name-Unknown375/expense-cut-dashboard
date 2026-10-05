"use client";

import { useEffect, useState } from "react";

type Insight = {
  headline: string;
  brief: string;
  bullets: string[];
  nextAction: string;
};

export function AiInsightPanel({ periodQuery }: { periodQuery: string }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "off" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setInsight(null);
    fetch(`/api/ai-insights?${periodQuery}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!data.enabled) {
          setStatus("off");
          return;
        }
        if (!r.ok || !data.insight) {
          setStatus("error");
          return;
        }
        setInsight(data.insight);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [periodQuery]);

  if (status === "off") return null;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl text-[var(--ink)]">
          {insight?.headline || "Deeper cut"}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Gemini
        </span>
      </div>
      {status === "loading" && (
        <p className="text-sm text-[var(--muted)]">Reading your spend…</p>
      )}
      {status === "error" && (
        <p className="text-sm text-[var(--muted)]">
          Deeper insight unavailable right now — rule-based verdicts above still apply.
        </p>
      )}
      {status === "ready" && insight && (
        <>
          <p className="text-sm leading-relaxed text-[var(--ink)]">{insight.brief}</p>
          {insight.bullets?.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--ink)]">
              {insight.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="mt-4 rounded-lg bg-[var(--wash)] px-3 py-2 text-sm font-medium text-[var(--ink)]">
            {insight.nextAction}
          </p>
        </>
      )}
    </section>
  );
}
