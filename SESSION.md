# Session Context — Job Hunt + Company Audit Mission

> This file is the source of truth for resuming this work from a Codespace.
> Read it fully before doing anything.

## The Mission

Daniel (dannybobo) is a software engineer hunting senior/remote roles in
Nigeria, South Africa, UK, and beyond. Two active tracks:

### Track 1 — The Tracker (JobOps)

A job-search OS (this repo) deployed to Railway so he can use it from his
phone. It scrapes jobs (hiringcafe, LinkedIn, ATS boards), scores them with an
LLM, and tracks applications.

**Status: LIVE and working.**

- URL: https://reasonable-cat-production-debf.up.railway.app
- Login: username `dannybobo` / password `jobops2026!` (he may change it)
- Railway: project `spirited-learning`, service `reasonable-cat`, env `production`
- Railway CLI: logged in as Ejeh Daniel (danielejeh2019@gmail.com), linked
- Deployment method: `railway up --detach` from repo root (GitHub-sourced
  deploys are broken — Railway's GitHub App install failed during a GitHub
  incident; the service's repo link shows "GitHub Repo not found")
- The Railway volume (at /app/data) holds jobs.db; the image carries a seed at
  `/app/seed-data/jobs.db`; `docker-entrypoint.sh` reseeds the volume when the
  seed's account password salt differs from the volume's
- Env vars on Railway: `LLM_API_KEY` (NVIDIA nvapi key), `JOBOPS_PUBLIC_BASE_URL`,
  `JOBOPS_DISABLE_ANALYTICS=true`; PORT=3001, DATA_DIR=/app/data set in Dockerfile
- Dockerfile was slimmed down to app-only (no Playwright, Camoufox, Codex CLI,
  docs site) because Railway free tier (1 GB build memory) kept OOM-killing the
  build. Docs build was removed entirely.
- Important gotcha: better-sqlite3 lives at `/app/node_modules` (hoisted), NOT
  `/app/orchestrator/node_modules` — the entrypoint uses the hoisted path
- Health endpoint: /health returns 200

**DB state (jobs.db, local path `orchestrator/data/jobs.db`):**

- 247 jobs: 8 applied, 3 in_progress, 236 discovered
- By source: hiringcafe 244, linkedin 2, pointnine:portfolio-jobs 1
- By country (discovered): South Africa 179, UK 49, Nigeria 7, Other 1
- Nigeria jobs: 5 Moniepoint (inserted directly from Greenhouse API, source_job_id
  = greenhouse-moniepoint-*, ids 322e8490, 72d0be43, e1dd2a06, aaef3464, 9b39e145)
  + 1 Conclase iOS + 1 Stivlon Senior Android
- No Kenya or Ghana jobs at all. Daniel asked about them — they don't exist yet.
- He asked for a country filter in the UI — NOT YET BUILT. The jobs list API
  (`listJobsQuerySchema` in orchestrator/src/server/api/routes/jobs/shared.ts:240)
  only supports `status` and `view`. Adding a country filter would be a small
  change (derive country from location field, add query param + UI dropdown).
- Scoring: 15 SA jobs scored ≥75 from an earlier partial run (Clickatell 82,
  Xceptor 82, StackOne 82, Tillo 82, Clever Profits 82, MyRunway 80, Accso 80,
  Salesforce FDE 80, Clickatell Sr Backend AI 80, Moburst 80, etc.)
- SA pipeline stuck: NVIDIA free tier exhausted (503 ResourceExhausted, 429),
  last run f9ce1bc5-3d4d-45f8-8997-639a26daef2a effectively paused at 0/195 processed
- Moniepoint Senior Fullstack Engineer (4001852101, Remote, Node/TS/MERN, 7-10yrs)
  is the strongest current match — Daniel was told it's a "very strong match"
- LinkedIn scraping lesson: use `ng.linkedin.com/jobs/search/?keywords=X&location=Nigeria`
  — it's the only URL honoring location. `www.linkedin.com/jobs/search-results/`
  ignores the location param. geoId 101693898 = Indonesia (wrong).

### Track 2 — Company Audit Gems (PAUSED, RESUMES NEXT)

This is the NEW mission. Forget job-ops code. Daniel wants, for each company he
targets, an agent to go around and find EVERYTHING about the company:

- Their public API (endpoints, docs, swagger/openapi)
- Open-source repos and contributions
- Product features and roadmap signals
- All their sites (careers page, docs, changelog, blog)
- Engineering blog, tech stack, engineering culture signals
- Pricing pages, competitors, hiring velocity (job board volume over time)

Then find the GEM(s): a specific, high-impact pre-interview artifact that
proves he mapped the company end-to-end before applying — the kind of thing
that gets you an interview without a take-home. This is what he researched on
Google (AI Mode) earlier. Examples of gem types:

1. Fix a real public bug in their product/OSS with a PR + write-up
2. Rebuild a missing feature/dashboard using their public API (live demo)
3. Audit their funnel/hiring data and present findings (systems thinking)
4. Build a tool for their engineering team based on their public stack

**The workflow Daniel wants:**
- He gives companies ONE BY ONE
- Agent goes around finding everything about that company
- Agent and Daniel pick the gem(s) for each company
- Then he applies with the gem

## How to Work With Daniel

- He's sharp and impatient with trial-and-error. Verify before claiming done.
- When something fails, read the actual error before fixing. No guessing.
- Use peruz (browser automation) for web work: `peruz --window-id <W> --tab-id <T>`
  with navigate/read/click/type. The Railway tab was 1892416442 in window 1892416230.
- Keep the tone direct. He likes progress over process.
- Country filter question is still open: "i can filter by countries right?"
  — answer is NO, not yet; offer to build it when he's back on the tracker.
