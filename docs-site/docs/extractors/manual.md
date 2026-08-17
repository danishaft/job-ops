---
id: manual
title: Manual Import Extractor
description: Import jobs from pasted descriptions and run AI-assisted inference.
sidebar_position: 4
---

Opportunity Intake lets you add open roles and company-level opportunities that
automated scrapers miss.

## Big picture

For an open role, you paste a raw description, let AI infer structure, review
the result, and import it. For a company-level signal, talent network,
open-source target, or watchlist company, you can skip the job description and
start from the route signals. By default, open-role import also tailors and
scores the job. You can skip tailoring per import or globally in **Settings**.

## 1) Input

Manual import accepts:

- plain text job descriptions
- raw HTML job descriptions
- job links/URLs
- rendered pages inspected through Peruz
- company-level opportunities without an open role

When a URL is provided, the basic fetch depends on whether the page responds to
a server request. If the site requires JavaScript or your browser login, use
**Peruz** to copy the rendered page text into intake.

## 2) AI inference

Endpoint:

- `POST /api/manual-jobs/infer`

Service:

- `orchestrator/src/server/services/manualJob.ts`

Behavior:

- Converts the provided input into text context and sends it to the configured
  LLM
- Extracts structured fields (title, employer, location, salary, etc.)
- Returns inferred JSON for user review

Practical limit:

- The inference quality ceiling is mostly the configured model capability and
  context behavior. Better model quality generally yields better field
  extraction.

If no LLM key is configured, inference is skipped and the user can fill fields
manually.

## 3) Review and edit

You review inferred fields and correct missing or incorrect values. You also
verify route signals for open roles, warm connections, direct application
email, hiring signals, talent networks, open-source companies, and eligibility.
JobOps computes the route from these signals.

## 4) Storage and scoring

Import endpoint:

- `POST /api/manual-jobs/import`

Request body accepts an optional `skipTailoring` boolean. When omitted, the
route falls back to the `autoTailorOnManualImport` workspace setting (default:
`true`). The review step in the UI exposes this as the **Tailor automatically
after import** checkbox.

On import with tailoring enabled:

- Stores source as `manual`
- Runs the tailoring pipeline (resume + PDF) and persists score and reason
- Job ends in `processing` and progresses to `ready` when tailoring completes
- Stores an evidence-grounding report for the generated resume fields

On import with tailoring skipped (`skipTailoring: true` or workspace setting
off):

- Stores source as `manual`
- Job lands in `discovered` immediately; no LLM scoring, no PDF render
- Tailoring can be triggered later from the job detail view

The job page shows whether generated tailoring is grounded, needs review,
failed, or became stale after a manual edit. These checks help you review model
claims; they do not submit, reject, or archive the opportunity.

Cross-source duplicates merge into one opportunity when title and employer
match. JobOps preserves every source in opportunity provenance. See
[Targeted opportunity workflow](../workflows/targeted-opportunity-workflow) for
the route table and human approval boundary.
