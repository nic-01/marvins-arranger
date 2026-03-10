# Stabilisation Plan — Vercel Server-Side Error

## Root Cause Diagnosis

The Vercel error ("Application error: a server-side exception has occurred") is a **runtime crash in `app/page.tsx`**. The page is `force-dynamic` and runs 4 parallel DB queries on every request:

```ts
const [medleyRows, prefRows, blockLogRows, eggRows] = await Promise.all([
  db.select().from(medleySongs)...,
  db.select().from(songPreferences)...,
  db.select().from(blockPreferenceLog)...,
  db.select().from(easterEggs)...,
]);
```

If **any** query throws (missing tables, bad credentials, network timeout), the entire page crashes — there is **no error handling, no error boundary, and no fallback**.

### Likely failure causes (in order of probability):
1. **Tables don't exist in Turso** — `db:push` (drizzle-kit push) may never have been run against the production database
2. **Missing/wrong env vars** — `TURSO_DATABASE_URL` or `TURSO_AUTH_TOKEN` not set in Vercel
3. **Fallback to `file:local.db`** — if env vars are missing, `db/index.ts` falls back to `file:local.db`, which fails on Vercel's read-only filesystem
4. **libsql client crash at import time** — the client is created at module scope, so even an invalid URL blows up before any request handling

## Stabilisation Plan

### Step 1: Add error handling to `app/page.tsx`
Wrap the DB queries in a try/catch. On failure, render the AppShell with empty initial data instead of crashing. This is the **single most important fix** — the app should always render.

### Step 2: Add an `app/error.tsx` error boundary
Next.js App Router error boundary catches runtime errors and shows a recovery UI instead of the generic Vercel error page.

### Step 3: Make `db/index.ts` resilient
- Lazy-initialise the DB client (don't create it at module scope)
- Validate that `TURSO_DATABASE_URL` is set before creating the client
- Log a clear warning if falling back

### Step 4: Add a health-check API route
Create `app/api/health/route.ts` that tests the DB connection and returns status. This can be used to verify Vercel env vars are working before the main page loads.

## Tests We Can Run Locally

### Build verification
- `npx next build` — confirms no type errors or build failures ✅ (already passes)

### Runtime smoke test
- `npx next start` with no env vars — should render the app with empty data (not crash)
- `npx next start` with valid env vars — should load DB data

### Unit/integration tests to add
Currently there are **zero tests**. Priority tests to add:

1. **DB fallback test** — verify page renders when DB is unavailable
2. **Server action tests** — verify `saveMedleySongs`, `setSongPreference` etc. handle errors gracefully
3. **Data integrity tests** — verify song catalog loads correctly, no duplicate IDs
4. **Build test** — CI check that `next build` succeeds

### Suggested test framework
- **Vitest** (already have vite.config.ts in repo, fast, good Next.js support)
- Tests for: data layer, server actions, page rendering

## Implementation Order

1. Fix `app/page.tsx` — try/catch around DB queries (immediate fix)
2. Add `app/error.tsx` — error boundary (safety net)
3. Harden `db/index.ts` — lazy init, validation
4. Add `app/api/health/route.ts` — connection check
5. Add basic test suite with Vitest
6. Verify build, commit, push
