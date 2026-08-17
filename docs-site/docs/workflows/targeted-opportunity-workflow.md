---
id: targeted-opportunity-workflow
title: Targeted opportunity workflow
description: Run a focused startup job search across open roles, talent networks, hiring signals, open source, and warm connections.
sidebar_position: 2
---

JobOps turns several startup job-search channels into one operating loop. An
automatic run collects and ranks opportunities from your configured extractors,
Watchlist sources, and the high-signal startup catalog. You verify the private
facts, then the route engine chooses the next playbook. JobOps and Peruz prepare
the work, but you perform every application submission, email send, direct
message, and pull request submission.

## Use one workspace for every channel

Open roles are only one kind of opportunity. Use **Opportunity Intake** to add
any of the following targets to the same workspace:

- An open role from an extractor, company site, or investor portfolio board.
- A company with a verified funding, growth, or hiring signal but no open role.
- An investor talent network, such as a16z TalentPlace, Balderton Talent
  Network, or Point Nine Talent Network.
- An open-source company where contribution is the strongest introduction.
- A company with no current signal that belongs on the Watchlist.

The intake screen includes the maintained high-signal source catalog. Portfolio
boards and talent networks are not duplicates. A board produces individual open
roles. A talent network creates one reusable profile opportunity, then you
monitor its portfolio companies as separate opportunities.

## Let JobOps build the triage inbox

An automatic run batches the available channels before asking you to make
decisions. It uses the existing extractor and Watchlist collectors, then checks
the high-signal catalog through three collection paths:

- JobOps creates reusable records for investor talent networks.
- JobOps reads the current Hacker News **Who is Hiring** thread through its
  public API.
- JobOps reads portfolio boards, startup boards, funding sources, and
  open-source sources through normal page fetching or Peruz. Structured
  extraction converts the visible page content into opportunities.

One unavailable source doesn't discard results from the other sources. JobOps
records the source failure in the pipeline result, normalizes the successful
results, merges cross-source duplicates, classifies public signals, and scores
the imported opportunities.

Automatic runs from the JobOps interface stop after ranking. The configured
shortlist size controls how many top opportunities JobOps highlights; it does
not generate that many resumes. The opportunities remain in **Discovered**
until you qualify one and start its preparation flow.

JobOps can classify public facts such as an open role, direct application email,
funding signal, talent network, or open-source channel. A warm connection starts
as **Unknown** because a public page can't prove your relationship. Confirm
**Warm connection**, **No warm connection**, or leave it unknown only after an
opportunity reaches your shortlist.

## Follow the daily operating loop

Use this sequence instead of waking up and applying to arbitrary companies.

1. Define a narrow target before sourcing: role family, level, location,
   eligibility, company stage, and technical domain.
2. Run an automatic search. JobOps batches extractors, selected Watchlist
   companies, and the high-signal startup catalog into one ranked inbox.
3. Review the highest-ranked **Discovered** opportunities instead of opening
   every source independently.
4. Verify the opportunity signals in the **Opportunity playbook** card. Do not
   mark a warm connection, direct application email, funding signal, or
   eligibility status unless you verified it.
5. Review fit, tailor the resume when an open role exists, and select the most
   relevant proof of work.
6. Open **People & outreach**, research and select the right person, and create
   an evidence-backed draft at the point required by the route.
7. Execute the route in order. Return to JobOps after every external action to
   mark the message sent, record replies, and review the follow-up date.
8. Review the queue again. Never stop the pipeline because one company might
   reply.

## Understand route precedence

JobOps evaluates eligibility first, then chooses exactly one route. This keeps
conflicting tactics out of the same opportunity.

| Verified situation | Route | Required sequence |
| --- | --- | --- |
| Visa, location, or work eligibility is incompatible | Archive as ineligible | Record reason, and recheck only after eligibility changes |
| Investor talent network | Submit talent profile | Prepare profile, prefill, review and submit, then monitor portfolio |
| Open role and warm connection | Referral first | Verify connection, request referral, then apply using their guidance |
| Open role with direct email instructions | Apply by direct email | Follow the stated instructions, prepare attachments, review, and send |
| Open role without a warm path | Apply, then contact team | Tailor, prefill, submit, research the engineering leader, then follow up |
| No role and open-source company | Contribute, then connect | Select a bounded issue, contribute, then follow up as a contributor |
| No role and strong hiring signal | Speculative outreach | Verify signal, find decision maker, match proof, then send targeted outreach |
| No role and no strong signal | Watch | Monitor until a verified role or signal appears |

Changing a signal immediately recomputes the route. You don't manually select a
route, so stored evidence and recommended actions can't silently disagree.

## Find the right person before outreach

The **People & outreach** card keeps contact selection inside the opportunity
record. Use it after you shortlist a job and before you send a referral request,
application follow-up, direct application, contributor follow-up, or speculative
message.

Use the card in this order:

1. Click **Research people**. JobOps uses Peruz to inspect the company pages and
   targeted public search results for the opportunity.
2. Review the ranked candidates. Every saved person includes a source URL,
   public evidence, a relevance explanation, and a score.
3. Click **Select** on the person closest to the work. For a small company or
   founding role, this is often a founder, CTO, or head of engineering. For a
   larger company, prefer the manager or engineering leader who owns the team.
   Treat a recruiter as a secondary contact unless the source connects them to
   the role or technical hiring at the company.
4. If JobOps can't prove a candidate from the inspected sources, leave the list
   empty or click **Add person** and provide your own evidence. Don't use an
   unrelated employee only to avoid an empty result.
5. Click **Draft message**. JobOps uses the saved job, the selected person's
   evidence, and your current resume to create an editable draft.
6. Review and edit the message, copy it to the correct channel, and send it
   yourself. JobOps doesn't send email or direct messages.
7. Click **Mark sent** only after the external send succeeds. JobOps records the
   sent time and schedules a follow-up for three business days later. Click
   **Mark replied** when the person responds.

Automatic research never marks someone as a warm connection and never guesses
an email address. It stores an email only when that exact address appears in the
inspected evidence. Add a warm referrer manually only when you genuinely know
the person and can provide a source for their current company and role.

Connection status never blocks outreach. If the selected person has a LinkedIn
profile, JobOps can prepare a LinkedIn message whether they are inside or outside
your network. The connection status changes the wording and whether a referral
request is appropriate; it does not decide whether the person is contactable.
JobOps prefers LinkedIn, then X, then a verified professional email. A direct
email application still uses the email channel required by the opportunity.

The draft matches the opportunity route. An open-role follow-up mentions the
application, a speculative message asks whether the relevant work is needed, a
contributor follow-up starts from the contribution, and a referral request asks
about referral fit. Drafting doesn't change the job's application state or
perform an external action.

## Separate automation from judgment

JobOps uses three execution boundaries. Keep these boundaries even when a site
or model makes deeper automation possible.

- **Automatic:** discovery, normalization, cross-source deduplication, scoring,
  route selection, resume drafting, outreach drafting, and follow-up planning.
- **Browser assisted:** rendered-page inspection, contact research, and known
  profile-field prefilling through Peruz.
- **Human:** choosing proof, reviewing facts and drafts, submitting forms,
  sending messages, and submitting pull requests.

The JobOps server process must find Peruz on its `PATH`. Verify the local
installation before using browser actions:

```bash
peruz --version
```

Peruz runs browser actions in isolated windows. Inspection windows close after
reading. Prefill windows remain open for your review. The adapter has no command
path for clicking submit, pressing Enter to submit, sending email, or sending a
direct message.

## Review AI tailoring against resume evidence

When JobOps generates tailored resume content, it gives each relevant resume
fact a stable evidence ID. The model must cite those IDs for its summary,
headline, skills, and keywords. JobOps then runs deterministic checks before it
stores the result:

- cited evidence exists in the current resume
- generated skills appear in the cited evidence
- numeric claims are supported by the cited evidence
- the generated wording has enough overlap with its cited source

The **Tailoring evidence** card on the job page reports one of four states:

- **Grounded:** all deterministic checks passed.
- **Review required:** one or more claims need human verification.
- **Stale report:** the tailored fields changed after the report was generated.
- **Generation failed:** the model or renderer did not complete the run.

Warnings never reject an opportunity or submit anything automatically. Review
the cited source, correct unsupported wording, and regenerate after editing the
resume or tailored fields. Tailoring created before evidence reports were
introduced is shown as stale instead of being trusted retroactively.

Each run stores tenant-scoped audit metadata, including the model, provider,
prompt-template fingerprint, duration, evidence fingerprint, applied fields,
and validation result. JobOps does not store the raw model prompt in this audit
record.

Resume PDF rendering stays local. If the configured LaTeX or Typst compiler is
not installed, JobOps tries the other supported local compiler. Template or
compilation errors still surface for review instead of being hidden by the
fallback.

## Use investor talent networks correctly

A talent profile is a top-of-funnel channel, not an application to every
portfolio company. For a16z TalentPlace, use this flow:

1. In **Opportunity Intake**, expand **High-signal startup sources**.
2. Find **a16z TalentPlace**, and click **Track profile**.
3. Review the generated `submit_talent_profile` playbook.
4. Prepare one accurate, reusable profile and CV.
5. Click **Prefill, then hand off**, review every field, upload the correct CV,
   and submit the profile yourself.
6. Keep the TalentPlace item as the network record. Import matching a16z
   portfolio roles as separate open-role opportunities.

This distinction preserves funnel attribution. You can later see whether an
interview came from the network, a direct role, a referral, or outreach.

## Handle duplicates and provenance

JobOps keeps one opportunity when the same title and employer appear on
different sources. It preserves each source URL and external ID in the
opportunity provenance instead of discarding the duplicate silently. Reposts
from the same source remain separate because they may represent a new hiring
cycle.

Use the source ID in intake when you know it, such as
`a16z:portfolio-jobs`, `a16z:talentplace`, or
`hackernews:who-is-hiring`. The first source remains the canonical listing, and
the other sources remain available as evidence.

## Next steps

Start with [Find jobs and apply](./find-jobs-and-apply-workflow) for extractor
configuration. Use [Watchlist](../features/watchlist) for companies without a
current role, and use
[Post-application tracking](../features/post-application-tracking) after you
submit an application.
