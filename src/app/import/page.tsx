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

export default function ImportPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({
    date: "",
    amount: "",
    description: "",
    amountStyle: "signed",
  });
  const [result, setResult] = useState<{
    imported: number;
    needsReview: { id: string; merchant: string; amount: number; date: string }[];
  } | null>(null);
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

  function onFile(f: File | null) {
    setFile(f);
    setResult(null);
    setError("");
    if (!f) return;
    Papa.parse(f, {
      header: true,
      preview: 5,
      complete: (res) => {
        const cols = res.meta.fields ?? [];
        setHeaders(cols);
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
  }

  const canImport = useMemo(() => {
    if (!file || !mapping.date || !mapping.description) return false;
    if (mapping.amountStyle === "signed") return Boolean(mapping.amount);
    return Boolean(mapping.debit || mapping.credit);
  }, [file, mapping]);

  async function runImport() {
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("mapping", JSON.stringify(mapping));
    const res = await fetch("/api/import", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      setError("Import failed");
      return;
    }
    setResult(await res.json());
  }

  async function setCategory(id: string, categoryId: string) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    setResult((r) =>
      r
        ? { ...r, needsReview: r.needsReview.filter((x) => x.id !== id) }
        : r
    );
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-3xl text-[var(--ink)]">Import CSV</h1>
        <p className="mt-1 text-[var(--muted)]">
          Map columns once — we remember them. Uncategorized rows get a quick review.
        </p>

        <div className="mt-6 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Bank CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-1 block w-full text-sm"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Need a sample?{" "}
            <a className="underline" href="/samples/sample-expenses.csv">
              Download sample CSV
            </a>
          </p>

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
                {busy ? "Importing…" : "Import transactions"}
              </button>
            </>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        {result && (
          <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-display text-xl">Import complete</h2>
            <p className="text-sm text-[var(--muted)]">
              Added {result.imported} transactions.{" "}
              <Link href="/transactions" className="underline">
                View list
              </Link>
            </p>
            {result.needsReview.length > 0 && (
              <>
                <h3 className="mt-4 font-medium">Quick categorize</h3>
                <ul className="mt-2 space-y-2">
                  {result.needsReview.map((row) => (
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
