import { messageTypeFromStageTarget } from "@server/services/post-application/stage-target";
import type { SmartRouterResult } from "./email-router";

type ActiveJob = { id: string; company: string; title: string };

const RECRUITMENT_TERMS = [
  "application",
  "candidate",
  "recruiting",
  "recruiter",
  "interview",
  "hiring",
  "assessment",
  "take home",
  "next step",
  "next stage",
  "offer",
  "position",
  "role",
];

const STOP_WORDS = new Set([
  "and",
  "company",
  "developer",
  "engineer",
  "engineering",
  "frontend",
  "backend",
  "fullstack",
  "group",
  "holding",
  "holdings",
  "inc",
  "limited",
  "ltd",
  "plc",
  "product",
  "senior",
  "software",
  "staff",
  "stack",
  "technologies",
  "technology",
  "the",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function includesAny(haystack: string, terms: readonly string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

function classifyStage(text: string): SmartRouterResult["stageTarget"] {
  if (
    includesAny(text, [
      "unfortunately",
      "not moving forward",
      "will not be moving forward",
      "decided not to proceed",
      "other candidates",
      "position has been filled",
      "not selected",
    ])
  ) {
    return "rejected";
  }
  if (includesAny(text, ["pleased to offer", "offer letter", "job offer"])) {
    return "offer";
  }
  if (
    includesAny(text, [
      "coding assessment",
      "technical assessment",
      "take home",
      "take-home",
      "hackerrank",
      "codility",
      "codesignal",
    ])
  ) {
    return "assessment";
  }
  if (
    includesAny(text, [
      "technical interview",
      "pair programming",
      "system design",
      "technical screen",
    ])
  ) {
    return "technical_interview";
  }
  if (
    includesAny(text, [
      "recruiter screen",
      "introductory call",
      "initial call",
      "phone screen",
    ])
  ) {
    return "recruiter_screen";
  }
  if (
    includesAny(text, [
      "interview",
      "schedule a call",
      "schedule your call",
      "your availability",
      "next stage",
      "next step",
    ])
  ) {
    return "hiring_manager_screen";
  }
  if (
    includesAny(text, [
      "application received",
      "received your application",
      "thank you for applying",
      "thanks for applying",
      "application has been submitted",
    ])
  ) {
    return "applied";
  }
  return "no_change";
}

function scoreJob(job: ActiveJob, text: string, fromDomain: string): number {
  const normalizedCompany = normalize(job.company);
  const companyTokens = meaningfulTokens(job.company);
  const titleTokens = meaningfulTokens(job.title);
  const domainText = normalize(fromDomain.replace(/\.[a-z]{2,}$/i, ""));

  let score = 0;
  if (normalizedCompany.length >= 3 && text.includes(normalizedCompany)) {
    score += 58;
  } else {
    const companyHits = companyTokens.filter((token) => text.includes(token));
    if (companyHits.length > 0) {
      score += Math.min(42, 18 + companyHits.length * 12);
    }
  }

  if (
    domainText.length >= 3 &&
    companyTokens.some(
      (token) => domainText.includes(token) || token.includes(domainText),
    )
  ) {
    score += 42;
  }

  const titleHits = titleTokens.filter((token) => text.includes(token)).length;
  if (titleHits > 0) {
    score += Math.min(32, 12 + titleHits * 8);
  }

  return Math.min(100, score);
}

export function classifyWithLocalRules(args: {
  fromAddress: string;
  fromDomain?: string | null;
  senderName?: string | null;
  subject: string;
  snippet: string;
  activeJobs: ActiveJob[];
}): SmartRouterResult {
  const text = normalize(
    [args.senderName, args.fromAddress, args.subject, args.snippet]
      .filter(Boolean)
      .join(" "),
  );
  const stageTarget = classifyStage(text);
  const isRecruitmentMessage =
    stageTarget !== "no_change" || includesAny(text, RECRUITMENT_TERMS);

  const ranked = args.activeJobs
    .map((job) => ({ job, score: scoreJob(job, text, args.fromDomain ?? "") }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const isUnambiguous =
    Boolean(best) &&
    best.score >= 50 &&
    best.score - (runnerUp?.score ?? 0) >= 15;
  const bestMatchId = isUnambiguous ? (best?.job.id ?? null) : null;
  const confidence = bestMatchId
    ? Math.min(99, Math.max(50, best?.score ?? 0))
    : isRecruitmentMessage
      ? 50
      : 0;
  const isRelevant = isRecruitmentMessage || Boolean(bestMatchId);

  return {
    bestMatchId,
    confidence,
    stageTarget,
    messageType: messageTypeFromStageTarget(stageTarget),
    isRelevant,
    stageEventPayload: null,
    reason: bestMatchId
      ? `Local match from employer, sender domain, and role signals (${confidence}/100).`
      : isRelevant
        ? "Recruitment email detected locally; job match needs review."
        : "No local recruitment or active-job signal detected.",
  };
}
