"use client";

import { Nav } from "@/components/Nav";
import { periodToQuery, loadStickyPeriod } from "@/components/PeriodFilter";
import { useEffect, useState } from "react";

type Category = { id: string; name: string; bucket: string; color: string };
type Rule = {
  id: string;
  name: string;
  type: string;
  limitAmount: number | null;
  categoryId: string | null;
  active: boolean;
};
type Share = { token: string; active: boolean } | null;

export default function SettingsPage() {
  const [income, setIncome] = useState("");
  const [baseline, setBaseline] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [share, setShare] = useState<Share>(null);
  const [newRule, setNewRule] = useState({
    name: "",
    type: "category_cap",
    categoryId: "",
    limitAmount: "",
  });
  const [origin, setOrigin] = useState("");
  const [shareQs, setShareQs] = useState("");
  const [saved, setSaved] = useState("");
  const [relabelMsg, setRelabelMsg] = useState("");
  const [ruleQuery, setRuleQuery] = useState("");
  const [ifThen, setIfThen] = useState<
    { id: string; text: string; places: string[]; weekdaysOnly: boolean; capLabel: string; seeded?: boolean }[]
  >([]);
  const [ifDraft, setIfDraft] = useState({
    text: "",
    places: "",
    weekdaysOnly: true,
    capLabel: "Eating out",
  });
  const [memory, setMemory] = useState<
    { id: string; merchant: string; categoryId: string; category: string }[]
  >([]);

  async function load() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    setIncome(data.settings?.monthlyIncome?.toString() ?? "");
    setBaseline(data.settings?.baselineOverride?.toString() ?? "");
    setCategories(data.categories ?? []);
    setRules(data.rules ?? []);
    setShare(data.share ?? null);
    const ifRes = await fetch("/api/if-then");
    const ifData = await ifRes.json();
    setIfThen(ifData.rules ?? []);
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    setShareQs(periodToQuery(loadStickyPeriod()));
    load();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyIncome: income === "" ? null : parseFloat(income),
        baselineOverride: baseline === "" ? null : parseFloat(baseline),
      }),
    });
    setSaved("Saved");
    setTimeout(() => setSaved(""), 1500);
  }

  async function renameCategory(id: string, name: string) {
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    await load();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newRule.name,
        type: newRule.type,
        categoryId: newRule.categoryId || null,
        limitAmount: newRule.limitAmount ? parseFloat(newRule.limitAmount) : null,
      }),
    });
    setNewRule({ name: "", type: "category_cap", categoryId: "", limitAmount: "" });
    await load();
  }

  async function removeRule(id: string) {
    await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
    await load();
  }

  async function shareAction(action: "regenerate" | "revoke") {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setShare(data.share);
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div>
          <h1 className="font-display text-3xl text-[var(--ink)]">Settings</h1>
          <p className="mt-1 text-[var(--muted)]">
            Income, baseline, categories, rules, and your share link.
          </p>
        </div>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Money basics</h2>
          <form onSubmit={saveSettings} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Monthly income (optional)
              <input
                type="number"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line)] px-3 py-2"
                placeholder="5200"
              />
            </label>
            <label className="text-sm">
              Usual spend override (optional)
              <input
                type="number"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line)] px-3 py-2"
                placeholder="Auto from history"
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-md bg-[var(--ink)] px-4 py-2 text-white">
                Save
              </button>
              {saved && <span className="ml-2 text-sm text-emerald-700">{saved}</span>}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Categories</h2>
          <p className="text-sm text-[var(--muted)]">Tagged Needs / Wants / Fixed. Edit labels anytime.</p>
          <ul className="mt-3 space-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-sm">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <input
                  defaultValue={c.name}
                  onBlur={(e) => {
                    if (e.target.value !== c.name) renameCategory(c.id, e.target.value);
                  }}
                  className="flex-1 rounded border border-[var(--line)] px-2 py-1"
                />
                <span className="w-16 text-[var(--muted)]">{c.bucket}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Spending rules</h2>
          <ul className="mt-3 space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-[var(--wash)] px-3 py-2 text-sm"
              >
                <span>
                  {r.name}
                  {r.limitAmount != null ? ` ($${r.limitAmount})` : ""}
                </span>
                <button onClick={() => removeRule(r.id)} className="text-rose-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addRule} className="mt-4 grid gap-2 sm:grid-cols-2">
            <input
              required
              placeholder="Rule name"
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            />
            <select
              value={newRule.type}
              onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
              className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            >
              <option value="category_cap">Category monthly cap</option>
              <option value="no_new_subs">No new subscriptions</option>
              <option value="weekend_only">Shopping only on weekends</option>
            </select>
            {newRule.type === "category_cap" && (
              <>
                <select
                  value={newRule.categoryId}
                  onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}
                  className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
                  required
                >
                  <option value="">Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  required
                  placeholder="Limit $"
                  value={newRule.limitAmount}
                  onChange={(e) => setNewRule({ ...newRule, limitAmount: e.target.value })}
                  className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
                />
              </>
            )}
            {newRule.type === "weekend_only" && (
              <select
                value={newRule.categoryId}
                onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}
                className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
              >
                <option value="">Shopping (default)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-white sm:col-span-2">
              Add rule
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">If-then</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            A rule in your words, checked against the taps in the period you are looking at.
          </p>
          <ul className="mt-3 space-y-2">
            {ifThen.map((rule) => (
              <li key={rule.id} className="rounded-lg bg-[var(--wash)] px-3 py-2 text-sm">
                <p>{rule.text}</p>
                <p className="mt-1 text-[var(--muted)]">
                  Places: {rule.places.join(", ")}
                  {rule.weekdaysOnly ? " · weekdays" : ""} · protects {rule.capLabel}
                  {rule.seeded ? " · example, because none was written yet" : ""}
                </p>
                <button
                  onClick={async () => {
                    await fetch(`/api/if-then?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
                    await load();
                  }}
                  className="mt-1 text-rose-600"
                >
                  Remove
                </button>
              </li>
            ))}
            {ifThen.length === 0 && (
              <li className="text-sm text-[var(--muted)]">Write the rule you already use.</li>
            )}
          </ul>
          <form
            className="mt-4 grid gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await fetch("/api/if-then", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(ifDraft),
              });
              setIfDraft({ text: "", places: "", weekdaysOnly: true, capLabel: "Eating out" });
              await load();
            }}
          >
            <input
              required
              placeholder="If it is a weekday and the place is Uber Eats or ice cream, the answer is no"
              value={ifDraft.text}
              onChange={(e) => setIfDraft({ ...ifDraft, text: e.target.value })}
              className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Places, comma separated"
              value={ifDraft.places}
              onChange={(e) => setIfDraft({ ...ifDraft, places: e.target.value })}
              className="rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ifDraft.weekdaysOnly}
                  onChange={(e) => setIfDraft({ ...ifDraft, weekdaysOnly: e.target.checked })}
                />
                Weekdays only
              </label>
              <label>
                Protects
                <select
                  value={ifDraft.capLabel}
                  onChange={(e) => setIfDraft({ ...ifDraft, capLabel: e.target.value })}
                  className="ml-2 rounded-md border border-[var(--line)] px-2 py-1"
                >
                  <option>Eating out</option>
                  <option>Costco</option>
                  <option>Gym</option>
                </select>
              </label>
            </div>
            <button type="submit" className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-white">
              Save if-then
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Read-only share link</h2>
          <p className="text-sm text-[var(--muted)]">
            Anyone with the link can see the dashboard — no import or edits.
          </p>
          {share ? (
            <p className="mt-3 break-all rounded-lg bg-[var(--wash)] px-3 py-2 text-sm">
              {origin}/share/{share.token}{shareQs ? `?${shareQs}` : ""}
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">No active share link.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => shareAction("regenerate")}
              className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-white"
            >
              {share ? "Regenerate" : "Create link"}
            </button>
            {share && (
              <button
                onClick={() => shareAction("revoke")}
                className="rounded-md border border-[var(--line)] px-4 py-2 text-sm"
              >
                Revoke
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Re-label spend</h2>
          <p className="text-sm text-[var(--muted)]">
            Runs the rules, then Gemini, over anything still in Other. Nothing is deleted.
          </p>
          <button
            type="button"
            className="mt-3 rounded-md bg-[var(--ink)] px-4 py-2 text-sm text-white"
            onClick={async () => {
              setRelabelMsg("Working…");
              const res = await fetch("/api/relabel", { method: "POST" });
              const data = await res.json();
              setRelabelMsg(
                res.ok
                  ? `Other ${data.before} → ${data.after} (${data.otherPct}% of transactions).`
                  : data.error || "Re-label failed"
              );
            }}
          >
            Re-label spend
          </button>
          {relabelMsg && <p className="mt-2 text-sm text-[var(--muted)]">{relabelMsg}</p>}
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Merchant memory</h2>
          <p className="text-sm text-[var(--muted)]">
            Learned labels. Applying a category updates every purchase with the same place name.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await fetch(`/api/merchant-rules?q=${encodeURIComponent(ruleQuery)}`);
              const data = await res.json();
              setMemory(data.rules ?? []);
            }}
          >
            <input
              value={ruleQuery}
              onChange={(e) => setRuleQuery(e.target.value)}
              placeholder="Search Costco, Uber…"
              className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            />
            <button className="rounded-md bg-[var(--ink)] px-3 py-2 text-sm text-white">Search</button>
          </form>
          <ul className="mt-3 space-y-2">
            {memory.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.merchant}</span>
                <select
                  defaultValue={r.categoryId}
                  className="rounded border border-[var(--line)] px-2 py-1"
                  onChange={async (e) => {
                    await fetch("/api/merchant-rules", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: r.id,
                        categoryId: e.target.value,
                        applyAll: true,
                      }),
                    });
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-rose-600"
                  onClick={async () => {
                    await fetch(`/api/merchant-rules?id=${r.id}`, { method: "DELETE" });
                    setMemory((list) => list.filter((x) => x.id !== r.id));
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Export</h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a className="underline" href="/api/export?what=transactions">
              Download transactions CSV
            </a>
            <a className="underline" href="/api/export?what=rules">
              Download rules CSV
            </a>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-xl">Password</h2>
          <p className="text-sm text-[var(--muted)]">
            Owner password is set via the <code className="rounded bg-[var(--wash)] px-1">APP_PASSWORD</code>{" "}
            environment variable (Netlify or local <code className="rounded bg-[var(--wash)] px-1">.env</code>).
            Change it there and redeploy / restart.
          </p>
        </section>
      </main>
    </>
  );
}
