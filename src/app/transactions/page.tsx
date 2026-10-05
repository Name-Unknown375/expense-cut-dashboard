"use client";

import { Nav } from "@/components/Nav";
import { moneyExact } from "@/lib/categories";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

type Category = { id: string; name: string; bucket: string };
type Tx = {
  id: string;
  date: string;
  amount: number;
  merchant: string;
  note: string | null;
  categoryId: string | null;
  category: Category | null;
};

function TransactionsInner() {
  const params = useSearchParams();
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [period] = useState(params.get("period") ?? "");
  const [month, setMonth] = useState(params.get("month") ?? "");
  const [year] = useState(params.get("year") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [categoryId, setCategoryId] = useState(params.get("categoryId") ?? "");
  const [merchant, setMerchant] = useState(params.get("merchant") ?? "");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    merchant: "",
    note: "",
    categoryId: "",
  });

  async function load() {
    const qs = new URLSearchParams();
    if (period) qs.set("period", period);
    if (month) qs.set("month", month);
    if (year) qs.set("year", year);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (categoryId) qs.set("categoryId", categoryId);
    if (merchant) qs.set("merchant", merchant);
    if (q) qs.set("q", q);
    const [txRes, catRes] = await Promise.all([
      fetch(`/api/transactions?${qs}`),
      fetch("/api/categories"),
    ]);
    const txJson = await txRes.json();
    const catJson = await catRes.json();
    setTransactions(txJson.transactions ?? []);
    setCategories(catJson.categories ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, categoryId, merchant, from, to, period, year]);

  async function addTx(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: form.date,
        amount: parseFloat(form.amount),
        merchant: form.merchant,
        note: form.note || null,
        categoryId: form.categoryId || null,
      }),
    });
    setForm((f) => ({ ...f, amount: "", merchant: "", note: "" }));
    await load();
  }

  async function updateCategory(id: string, next: string) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: next || null }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this transaction?")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    await load();
  }

  const dashQs = new URLSearchParams();
  if (period) dashQs.set("period", period);
  if (month) dashQs.set("month", month);
  if (year) dashQs.set("year", year);
  if (from) dashQs.set("from", from);
  if (to) dashQs.set("to", to);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-[var(--ink)]">Transactions</h1>
          <p className="mt-1 text-[var(--muted)]">
            {merchant
              ? `Purchases at ${merchant}`
              : "Add cash spend — categories are assigned automatically."}
          </p>
        </div>
        {(categoryId || merchant) && (
          <Link href={`/?${dashQs}`} className="text-sm text-[var(--accent)] underline">
            ← Back to dashboard
          </Link>
        )}
      </div>

      <form
        onSubmit={addTx}
        className="mt-6 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="text-sm lg:col-span-1">
          Date
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          Amount
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1.5"
          />
        </label>
        <label className="text-sm lg:col-span-2">
          Merchant
          <input
            required
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          Category
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="mt-1 w-full rounded-md border border-[var(--line)] px-2 py-1.5"
          >
            <option value="">Auto</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-md bg-[var(--ink)] px-3 py-2 text-white">
            Add
          </button>
        </div>
      </form>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
          title="From"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
          title="To"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
        />
        <button
          onClick={load}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
        >
          Search
        </button>
      </div>

      <ul className="mt-4 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        {transactions.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <div>
              <div className="font-medium text-[var(--ink)]">{t.merchant}</div>
              <div className="text-xs text-[var(--muted)]">
                {new Date(t.date).toLocaleDateString()}
                {t.note ? ` · ${t.note}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={t.categoryId ?? ""}
                onChange={(e) => {
                  if (e.target.value) updateCategory(t.id, e.target.value);
                }}
                className="rounded border border-[var(--line)] px-2 py-1"
                title="Override auto category"
              >
                {!t.categoryId && <option value="">Auto…</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="w-20 text-right font-medium">{moneyExact(t.amount)}</span>
              <button onClick={() => remove(t.id)} className="text-rose-600 hover:underline">
                Delete
              </button>
            </div>
          </li>
        ))}
        {transactions.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">No transactions yet.</li>
        )}
      </ul>
    </main>
  );
}

export default function TransactionsPage() {
  return (
    <>
      <Nav />
      <Suspense fallback={<main className="p-8">Loading…</main>}>
        <TransactionsInner />
      </Suspense>
    </>
  );
}
