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
};

type FileResult = {
  fileName: string;
  imported: number;
  duplicates: number;
  skipped: number;
  rows: number;
  needsReview: { id: string; merchant: string; amount: number; date: string }[];
};

type QueuedFile = { id: string; file: File; headers: string[] };

export default function ImportPage() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({
    date: "",
    amount: "",
    description: "",
    amountStyle: "signed",
  });
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [totals, setTotals] = useState<{
    imported: number;
    duplicates: number;
    skipped: number;
    needsReview: FileResult["needsReview"];
  } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  );
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/import")
      .then((r) => r.json())
      .then((d) => {
        if (d.mapping) setMapping((m) => ({ ...m, ...d.mapping }));
      });
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []));
  }, []);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setResults(null);
    setTotals(null);
    setError("");
    const arr = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".csv") || f.type.includes("csv"));
    arr.forEach((file) => {
      Papa.parse(file, {
        header: true,
        preview: 5,
        complete: (res) => {
          const cols = res.meta.fields ?? [];
          setQueue((q) => {
            if (q.some((x) => x.file.name === file.name && x.file.size === file.size)) return q;
            return [...q, { id: `${file.name}-${file.size}-${file.lastModified}`, file, headers: cols }];
          });
          setHeaders((prev) => (prev.length ? prev : cols));
          setMapping((m) => ({
            ...m,
            date: m.date || guess(cols, ["date", "posted", "transaction date"]),
            amount: m.amount || guess(cols, ["amount", "value"]),
            description:
              m.description ||
              guess(cols, ["description", "merchant", "payee", "name", "memo"]),
            debit: m.debit || guess(cols, ["debit", "withdrawal"]),
            credit: m.credit || guess(cols, ["credit", "deposit"]),
            category: m.category || guess(cols, ["category"]),
          }));
        },
      });
    });
  }

  function removeFile(id: string) {
    setQueue((q) => {
      const next = q.filter((x) => x.id !== id);
      setHeaders(next[0]?.headers ?? []);
      return next;
    });
  }

  const schemasMatch = useMemo(() => {
    if (queue.length <= 1) return true;
    const base = [...queue[0].headers].sort().join("|");
    return queue.every((q) => [...q.headers].sort().join("|") === base);
  }, [queue]);

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

    // Import all files in one request (server processes sequentially + dedupes)
    const form = new FormData();
    form.append("mapping", JSON.stringify(mapping));
    for (const q of queue) form.append("files", q.file);

    try {
      // Fake stepwise progress while waiting
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
        needsReview: data.needsReview ?? [],
      });
      setProgress({ done: queue.length, total: queue.length, current: "Done" });
    } catch {
      setBusy(false);
      setProgress(null);
      setError("Import failed");
    }
  }

  async function setCategory(id: string, categoryId: string) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    setTotals((t) =>
      t ? { ...t, needsReview: t.needsReview.filter((x) => x.id !== id) } : t
    );
    setResults((rs) =>
      rs
        ? rs.map((r) => ({
            ...r,
            needsReview: r.needsReview.filter((x) => x.id !== id),
          }))
        : rs
    );
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-3xl text-[var(--ink)]">Import CSV</h1>
        <p className="mt-1 text-[var(--muted)]">
          Upload one or many bank CSVs. We remember your column mapping and skip duplicate rows.
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
                  Column names differ across files — mapping still applies by column name. Rows whose
                  mapped columns are missing will be skipped.
                </p>
              )}
            </div>
          )}

          {headers.length > 0 && (
            <>
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
                  options={headers}
                  onChange={(v) => setMapping({ ...mapping, date: v })}
                />
                <SelectField
                  label="Description / merchant"
                  value={mapping.description}
                  options={headers}
                  onChange={(v) => setMapping({ ...mapping, description: v })}
                />
                {mapping.amountStyle === "signed" ? (
                  <SelectField
                    label="Amount column"
                    value={mapping.amount ?? ""}
                    options={headers}
                    onChange={(v) => setMapping({ ...mapping, amount: v })}
                  />
                ) : (
                  <>
                    <SelectField
                      label="Debit column"
                      value={mapping.debit ?? ""}
                      options={headers}
                      onChange={(v) => setMapping({ ...mapping, debit: v })}
                    />
                    <SelectField
                      label="Credit column"
                      value={mapping.credit ?? ""}
                      options={headers}
                      onChange={(v) => setMapping({ ...mapping, credit: v })}
                    />
                  </>
                )}
                <SelectField
                  label="Category (optional)"
                  value={mapping.category ?? ""}
                  options={["", ...headers]}
                  onChange={(v) => setMapping({ ...mapping, category: v || undefined })}
                />
              </div>

              <button
                disabled={!canImport || busy}
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
              Added {totals.imported} · skipped {totals.duplicates} duplicates · {totals.skipped}{" "}
              other skips.{" "}
              <Link href="/transactions" className="underline">
                View list
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
                    — {r.imported} added, {r.duplicates} duplicates, {r.skipped} skipped ({r.rows}{" "}
                    rows)
                  </span>
                </li>
              ))}
            </ul>
            {totals.needsReview.length > 0 && (
              <>
                <h3 className="mt-4 font-medium">Quick categorize</h3>
                <ul className="mt-2 space-y-2">
                  {totals.needsReview.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--wash)] px-3 py-2 text-sm"
                    >
                      <span>
                        {row.merchant} · ${row.amount.toFixed(2)}
                      </span>
                      <select
                        className="rounded border border-[var(--line)] px-2 py-1"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) setCategory(row.id, e.target.value);
                        }}
                      >
                        <option value="">Pick category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}
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
  options: string[];
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
        {options.filter(Boolean).map((o) => (
          <option key={o} value={o}>
            {o}
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
