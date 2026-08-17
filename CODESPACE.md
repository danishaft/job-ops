# Codespace Workflow

## What This Is

A cloud dev environment (Linux, GitHub free tier) where you run the company
audit sessions and keep the JobOps tracker deployable. Git syncs work back to
your local machine. Close the laptop; the session lives here.

## Quick Start

1. Open https://github.com/danishaft/job-ops
2. Code -> Codespaces -> Create codespace on main
3. Verify:
   ```bash
   cat SESSION.md        # read this first — it's the source of truth
   cat agent/company-audit.md
   ```
4. If the agent (opencode/codex) is used, point it at `SESSION.md` and
   `agent/company-audit.md` as the session context.

## What Works in Codespace

- Company audit research (web + peruz browser automation)
- Per-company notes in `audits/` — build the gem library
- JobOps edits (code, Dockerfile, entrypoint)
- Railway deploys via `railway up --detach` (Railway CLI installed; login as
  Ejeh Daniel; project `spirited-learning`, service `reasonable-cat`)

## What Needs Your Machine

- Nothing critical — the tracker runs on Railway, the DB lives in the Railway
  volume and in `orchestrator/data/jobs.db` (local copy)
- Live LinkedIn/ATS scraping at scale (jobspy .venv is local, not committed)

## Sync Loop

```
Codespace (research + edits)  --git push-->  GitHub  --git pull-->  Local
      ^                                                              |
      +------------------------ git push <--------------------------+
```

## Deploying the Tracker From Codespace

```bash
railway login            # once, browserless token
railway link --project 31724ade-62ce-4dfc-a2ff-65148aee1712 --environment production
railway up --detach      # from repo root; Dockerfile is slimmed for Railway free tier
```

## Session Carry-Over (flmcp pattern)

- `SESSION.md` — full state: Railway status, DB facts, the audit mission,
  how-to-work rules. Update it when big things change so the next agent session
  picks up correctly.
- `agent/company-audit.md` — the audit agent definition/mission.
- `audits/` — one file per audited company.
