"use client";

import { Nav } from "@/components/Nav";
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";

type Mapping = {
  date: string;
  amount?: string;
  debit?: string;
  credit?: string;
  description: string;
  category?: string;
  amountStyle: "signed" | "debit_credit";
  headerless?: boolean;
};

type ColumnOpt = { key: string; label: string; sample: string };

type FileResult = {
  fileName: string;
  imported: number;
  duplicates: number;
  skipped: number;
  rows: number;
  autoCategorized: number;
};

type QueuedFile = {
  id: string;
  file: File;
  headers: string[];
  sampleRows: string[][];
};

export default function ImportPage() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [columns, setColumns] = useState<ColumnOpt[]>([]);
  const [mapping, setMapping] = useState<Mapping>({
    date: "",
    amount: "",
    description: "",
    amountStyle: "signed",
    headerless: false,
  });
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [totals, setTotals] = useState<{
    imported: number;
    duplicates: number;
    skipped: number;
    autoCategorized: number;
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mapNote, setMapNote] = useState("");
  const [error, setError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/import")
      .then((r) => r.json())
      .then((d) => {
        setAiEnabled(Boolean(d.aiEnabled));
        // Don't restore a saved mapping onto headerless CIBC files blindly —
        // Gemini will re-infer after upload. Keep amountStyle preference only.
        if (d.mapping?.amountStyle) {
          setMapping((m) => ({ ...m, amountStyle: d.mapping.amountStyle }));
        }
      });
  }, []);

  async function suggestMappingFor(file: QueuedFile, headers: string[], sampleRows: string[][]) {
    setMappingBusy(true);
    setMapNote(aiEnabled ? "Gemini is reading your columns…" : "Detecting columns…");
    try {
      const res = await fetch("/api/import/suggest-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.file.name,
          headers,
          sampleRows,
        }),
      });
      const data = await res.json();
      if (data.columns?.length) setColumns(data.columns);
      if (data.mapping) {
        setMapping((m) => ({
          ...m,
          ...data.mapping,
          category: data.mapping.category || undefined,
        }));
        const who = data.enabled ? "Gemini" : "Auto";
        const conf =
          typeof data.mapping.confidence === "number"
            ? ` (${Math.round(data.mapping.confidence * 100)}% sure)`
            : "";
        setMapNote(
          `${who} mapped columns${conf}${data.mapping.note ? ` — ${data.mapping.note}` : ""}`
        );
      } else {
        // Heuristic fallback on labeled headers
        const keys = (data.columns ?? []).map((c: ColumnOpt) => c.key);
        setColumns(
          data.columns?.length
            ? data.columns
            : headers.map((h) => ({ key: h, label: h, sample: h }))
        );
        setMapping((m) => ({
          ...m,
          headerless: false,
          date: m.date || guess(keys.length ? keys : headers, ["date", "posted", "transaction"]),
          amount: m.amount || guess(keys.length ? keys : headers, ["amount", "value"]),
          description:
            m.description ||
            guess(keys.length ? keys : headers, [
              "description",
              "merchant",
              "payee",
              "name",
              "memo",
            ]),
          debit: m.debit || guess(keys.length ? keys : headers, ["debit", "withdrawal"]),
          credit: m.credit || guess(keys.length ? keys : headers, ["credit", "deposit"]),
        }));
        setMapNote("Mapped from column names — tweak if needed.");
      }
    } catch {
      setMapNote("Could not auto-map columns — pick them below.");
    } finally {
      setMappingBusy(false);
    }
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setResults(null);
    setTotals(null);
    setError("");
    const arr = Array.from(list).filter(
      (f) => f.name.toLowerCase().endsWith(".csv") || f.type.includes("csv")
    );
    arr.forEach((file) => {
      Papa.parse<string[]>(file, {
        header: false,
        preview: 8,
        skipEmptyLines: true,
        complete: (res) => {
          const sampleRows = (res.data ?? [])
            .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()))
            .map((r) => r.map((c) => String(c ?? "").trim()));
          if (!sampleRows.length) return;

          // First row used as provisional headers for detection (may be data)
          const provisionalHeaders = sampleRows[0];
          const queued: QueuedFile = {
            id: `${file.name}-${file.size}-${file.lastModified}`,
            file,
            headers: provisionalHeaders,
            sampleRows,
          };

          setQueue((q) => {
            if (q.some((x) => x.file.name === file.name && x.file.size === file.size)) return q;
            const next = [...q, queued];
            // First file in an empty queue drives Gemini column mapping
            if (q.length === 0) {
              void suggestMappingFor(queued, provisionalHeaders, sampleRows);
            }
            return next;
          });
        },
      });
    });
  }

  function removeFile(id: string) {
    setQueue((q) => {
      const next = q.filter((x) => x.id !== id);
      if (!next.length) {
        setColumns([]);
        setMapNote("");
        setMapping({
          date: "",
          amount: "",
          description: "",
          amountStyle: "signed",
          headerless: false,
        });
      }
      return next;
    });
  }

  async function remapWithGemini() {
    if (!queue[0]) return;
    setMapping({
      date: "",
      amount: "",
      description: "",
      amountStyle: mapping.amountStyle,
      headerless: false,
    });
    await suggestMappingFor(queue[0], queue[0].headers, queue[0].sampleRows);
  }

  const schemasMatch = useMemo(() => {
    if (queue.length <= 1) return true;
    const base = queue[0].headers.length;
    return queue.every((q) => q.headers.length === base);
  }, [queue]);

  const headerKeys = columns.map((c) => c.key);

  const canImport = useMemo(() => {
    if (!queue.length || !mapping.date || !mapping.description) return false;
    if (mapping.amountStyle === "signed") return Boolean(mapping.amount);
    return Boolean(mapping.debit || mapping.credit);
  }, [queue, mapping]);

  async function runImport() {
    if (!queue.length) return;
    setBusy(true);
    setError("");
    setProgress({ done: 0, total: queue.length, current: queue[0].file.name });

    const form = new FormData();
    form.append("mapping", JSON.stringify(mapping));
    for (const q of queue) form.append("files", q.file);

    try {
      const tick = window.setInterval(() => {
        setProgress((p) =>
          p && p.done < p.total - 1
            ? {
                ...p,
                done: p.done + 1,
                current: queue[Math.min(p.done + 1, queue.length - 1)]?.file.name ?? p.current,
              }
            : p
        );
      }, 400);

      const res = await fetch("/api/import", { method: "POST", body: form });
      window.clearInterval(tick);
      setBusy(false);
      setProgress(null);
      if (!res.ok) {
        setError("Import failed");
        return;
      }
      const data = await res.json();
      setResults(data.files ?? []);
      setTotals({
        imported: data.imported ?? 0,
        duplicates: data.duplicates ?? 0,
        skipped: data.skipped ?? 0,
        autoCategorized: data.autoCategorized ?? 0,
      });
      setProgress({ done: queue.length, total: queue.length, current: "Done" });
    } catch {
      setBusy(false);
      setProgress(null);
      setError("Import failed");
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-3xl text-[var(--ink)]">Import CSV</h1>
        <p className="mt-1 text-[var(--muted)]">
          Upload one or many bank CSVs. Gemini maps columns and categories — no hand labeling.
          Duplicates are skipped.
        </p>

        <div className="mt-6 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Bank CSV files</span>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              className="mt-1 block w-full text-sm"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Need a sample?{" "}
            <a className="underline" href="/samples/sample-expenses.csv">
              Download sample CSV
            </a>
          </p>

          {queue.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-[var(--ink)]">
                  Ready to import ({queue.length} file{queue.length === 1 ? "" : "s"})
                </h2>
                <label className="cursor-pointer text-sm text-[var(--accent)] underline">
                  Add more
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    multiple
                    className="hidden"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </label>
              </div>
              <ul className="space-y-1">
                {queue.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center justify-between rounded-lg bg-[var(--wash)] px-3 py-2 text-sm"
                  >
                    <span>
                      {q.file.name}{" "}
                      <span className="text-[var(--muted)]">
                        ({Math.round(q.file.size / 1024)} KB · {q.headers.length} columns)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(q.id)}
                      className="text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {!schemasMatch && (
                <p className="mt-2 text-xs text-amber-800">
                  Column counts differ across files — mapping uses column position for headerless
                  bank exports. Rows missing a mapped column are skipped.
                </p>
              )}
            </div>
          )}

          {queue.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--wash)] px-3 py-2 text-sm">
                <p className="text-[var(--ink)]">
                  {mappingBusy ? "Gemini is reading your columns…" : mapNote || "Column mapping"}
                  {mapping.headerless ? " · headerless file" : ""}
                </p>
                <button
                  type="button"
                  disabled={mappingBusy || busy}
                  onClick={remapWithGemini}
                  className="text-[var(--accent)] underline disabled:opacity-50"
                >
                  Remap with Gemini
                </button>
              </div>

              <label className="block text-sm">
                Amount style
                <select
                  className="mt-1 w-full rounded-md border border-[var(--line)] px-3 py-2"
                  value={mapping.amountStyle}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      amountStyle: e.target.value as Mapping["amountStyle"],
                    })
                  }
                >
                  <option value="signed">One amount column (signed or absolute)</option>
                  <option value="debit_credit">Separate debit / credit columns</option>
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Date column"
                  value={mapping.date}
                  options={columns.length ? columns : headerKeys.map((k) => ({ key: k, label: k, sample: k }))}
                  onChange={(v) => setMapping({ ...mapping, date: v })}
                />
                <SelectField
                  label="Description / merchant"
                  value={mapping.description}
                  options={columns.length ? columns : headerKeys.map((k) => ({ key: k, label: k, sample: k }))}
                  onChange={(v) => setMapping({ ...mapping, description: v })}
                />
                {mapping.amountStyle === "signed" ? (
                  <SelectField
                    label="Amount column"
                    value={mapping.amount ?? ""}
                    options={columns.length ? columns : headerKeys.map((k) => ({ key: k, label: k, sample: k }))}
                    onChange={(v) => setMapping({ ...mapping, amount: v })}
                  />
                ) : (
                  <>
                    <SelectField
                      label="Debit column"
                      value={mapping.debit ?? ""}
                      options={columns.length ? columns : headerKeys.map((k) => ({ key: k, label: k, sample: k }))}
                      onChange={(v) => setMapping({ ...mapping, debit: v })}
                    />
                    <SelectField
                      label="Credit column"
                      value={mapping.credit ?? ""}
                      options={columns.length ? columns : headerKeys.map((k) => ({ key: k, label: k, sample: k }))}
                      onChange={(v) => setMapping({ ...mapping, credit: v })}
                    />
                  </>
                )}
                <SelectField
                  label="Category column (optional)"
                  value={mapping.category ?? ""}
                  options={[
                    { key: "", label: "None — auto-label", sample: "" },
                    ...(columns.length
                      ? columns
                      : headerKeys.map((k) => ({ key: k, label: k, sample: k }))),
                  ]}
                  onChange={(v) => setMapping({ ...mapping, category: v || undefined })}
                />
              </div>

              <button
                disabled={!canImport || busy || mappingBusy}
                onClick={runImport}
                className="rounded-md bg-[var(--ink)] px-4 py-2 text-white disabled:opacity-50"
              >
                {busy
                  ? `Importing… ${progress ? `${progress.done}/${progress.total}` : ""}`
                  : `Import ${queue.length} file${queue.length === 1 ? "" : "s"}`}
              </button>
              {progress && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--wash)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-all"
                      style={{
                        width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {progress.current}
                    {progress.done >= progress.total ? " — finished" : ""}
                  </p>
                </div>
              )}
            </>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        {totals && results && (
          <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-display text-xl">Import complete</h2>
            <p className="text-sm text-[var(--muted)]">
              Added {totals.imported} · auto-categorized {totals.autoCategorized} · skipped{" "}
              {totals.duplicates} duplicates · {totals.skipped} other skips.{" "}
              <Link href="/" className="underline">
                Open dashboard
              </Link>
            </p>
            <ul className="mt-4 space-y-2">
              {results.map((r) => (
                <li
                  key={r.fileName}
                  className="rounded-lg bg-[var(--wash)] px-3 py-2 text-sm text-[var(--ink)]"
                >
                  <span className="font-medium">{r.fileName}</span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    — {r.imported} added ({r.autoCategorized} labeled), {r.duplicates} duplicates,{" "}
                    {r.skipped} skipped ({r.rows} rows)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ColumnOpt[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      {label}
      <select
        className="mt-1 w-full rounded-md border border-[var(--line)] px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {options
          .filter((o) => o.key || o.label)
          .map((o) => (
            <option key={o.key || "none"} value={o.key}>
              {o.sample && o.key.startsWith("col_")
                ? `${o.label}: ${o.sample}`
                : o.label || o.key}
            </option>
          ))}
      </select>
    </label>
  );
}

function guess(cols: string[], keys: string[]) {
  const lower = cols.map((c) => c.toLowerCase());
  for (const k of keys) {
    const i = lower.findIndex((c) => c.includes(k));
    if (i >= 0) return cols[i];
  }
  return "";
}
