# Expense Cut Dashboard

Personal expense app: CSV + manual entry, category breakdowns, a waste/cut list aimed at spending **50% less** than usual, simple spending rules, and a read-only share link.

Plain language throughout — **spent**, **categories**, **waste**, **target**, **rules**.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Prisma + Turso/libSQL (local SQLite file for development)
- Papa Parse (CSV), Recharts (charts)
- Netlify Next runtime

## Quick start (local)

```bash
npm install
cp .env.example .env
# edit APP_PASSWORD and SESSION_SECRET
npx prisma db push
npm run seed   # optional — loads sample months of spend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Local | SQLite file, e.g. `file:./dev.db` |
| `TURSO_DATABASE_URL` | Netlify | Turso libSQL URL |
| `TURSO_AUTH_TOKEN` | Netlify | Turso auth token |
| `APP_PASSWORD` | Yes | Owner login password |
| `SESSION_SECRET` | Yes | Signs session cookies |

When `TURSO_DATABASE_URL` is set, the app uses Turso. Otherwise it uses the local `DATABASE_URL` SQLite file.

## Deploy on Netlify

1. Create a free [Turso](https://turso.tech) database and copy the URL + auth token.
2. Push this repo to GitHub and connect it to Netlify.
3. In Netlify → Site configuration → Environment variables, set:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `APP_PASSWORD`
   - `SESSION_SECRET` (long random string)
   - `DATABASE_URL` can mirror the Turso URL or stay unused when Turso vars are present
4. Deploy. `netlify.toml` runs `prisma generate`, `prisma db push`, and `next build`, and enables `@netlify/plugin-nextjs`.
5. Open the site and sign in with `APP_PASSWORD`.

Data persists across deploys because it lives in Turso, not on the Netlify filesystem.

## Routes

| Path | Purpose |
|---|---|
| `/` | Dashboard (usual spend, 50% target, pace, categories, waste list) |
| `/import` | CSV upload + column mapping + review |
| `/transactions` | List, filter, manual add/edit |
| `/settings` | Categories, income, baseline, rules, share link |
| `/share/[token]` | Read-only dashboard for accountability |

## Sample data

`npm run seed` (or first boot with an empty DB) loads several months of sample spend so the dashboard is useful immediately. A sample CSV is also at `/samples/sample-expenses.csv`.
