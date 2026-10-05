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
        // Do NOT restore saved amountStyle here — it races Gemini and can leave
        // "signed" selected while the note says debit/credit (CIBC bug).
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
        const style =
          data.mapping.amountStyle === "debit_credit" ? "debit_credit" : "signed";
        // Replace mapping wholesale so debit/credit and signed never mix
        setMapping({
          date: data.mapping.date || "",
          description: data.mapping.description || "",
          amountStyle: style,
          headerless: Boolean(data.mapping.headerless),
          amount: style === "signed" ? data.mapping.amount || undefined : undefined,
          debit: style === "debit_credit" ? data.mapping.debit || undefined : undefined,
          credit: style === "debit_credit" ? data.mapping.credit || undefined : undefined,
          category: data.mapping.category || undefined,
        });
        const who = data.enabled ? "Gemini" : "Auto";
        const conf =
          typeof data.mapping.confidence === "number"
            ? ` (${Math.round(data.mapping.confidence * 100)}% sure)`
            : "";
        const styleLabel =
          style === "debit_credit" ? "separate debit/credit" : "one amount column";
        setMapNote(
          `${who} mapped columns${conf} · ${styleLabel}${
            data.mapping.note ? ` — ${data.mapping.note}` : ""
          }${data.mapping.headerless ? " · headerless file" : ""}`
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
      amount: undefined,
      debit: undefined,
      credit: undefined,
      description: "",
      amountStyle: "signed",
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

    // Ensure UI style matches fields we send (avoid signed+empty amount)
    const payload: Mapping = {
      ...mapping,
      amount:
        mapping.amountStyle === "signed" ? mapping.amount || undefined : undefined,
      debit:
        mapping.amountStyle === "debit_credit" ? mapping.debit || undefined : undefined,
      credit:
        mapping.amountStyle === "debit_credit" ? mapping.credit || undefined : undefined,
    };

    const form = new FormData();
    form.append("mapping", JSON.stringify(payload));
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" && data.error
            ? data.error
            : `Import failed (HTTP ${res.status})`
        );
        return;
      }
      setResults(data.files ?? []);
      setTotals({
        imported: data.imported ?? 0,
        duplicates: data.duplicates ?? 0,
        skipped: data.skipped ?? 0,
        autoCategorized: data.autoCategorized ?? 0,
      });
      if (data.warning) setMapNote(String(data.warning));
      setProgress({ done: queue.length, total: queue.length, current: "Done" });
    } catch (e) {
      setBusy(false);
      setProgress(null);
      setError(e instanceof Error ? e.message : "Import failed (network error)");
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-3xl text-[var(--ink)]">Import CSV</h1>
        <p className="mt-1 text-[var(--muted)]">
          Upload one or many bank CSVs. Gemini maps columns and categories — no hand labeling.
          Re-imports skip duplicates (same date + amount + merchant); existing spend is never wiped.
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

