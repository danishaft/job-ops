import { createHash } from "node:crypto";
import type {
  ResumeProfile,
  TailoringClaim,
  TailoringEvidenceItem,
  TailoringValidationIssue,
  TailoringValidationReport,
} from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";

export const TAILORING_VALIDATOR_VERSION = "grounding-2026-07-31";

export interface TailoringGroundingReferences {
  headlineEvidenceIds?: string[];
  summaryEvidenceIds?: string[];
  skills?: Array<{ name: string; evidenceIds?: string[] }>;
}

export interface TailoringContentForGrounding {
  headline: string;
  summary: string;
  skills: Array<{ name: string; keywords: string[] }>;
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "that",
  "the",
  "their",
  "this",
  "through",
  "using",
  "with",
  "your",
]);

function cleanText(value: string | null | undefined): string {
  return stripHtmlTags(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fallbackEvidenceId(kind: string, value: unknown): string {
  return `${kind}:${fingerprint(value).slice(0, 12)}`;
}

function uniqueStrings(values: readonly string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function extractResumeEvidence(
  profile: ResumeProfile,
): TailoringEvidenceItem[] {
  const evidence: TailoringEvidenceItem[] = [];
  const basicsSummary = cleanText(profile.basics?.summary);
  if (basicsSummary) {
    evidence.push({
      id: "profile:summary",
      kind: "profile_summary",
      label: "Profile summary",
      text: basicsSummary,
    });
  }

  const sectionSummary = cleanText(profile.sections?.summary?.content);
  if (sectionSummary && sectionSummary !== basicsSummary) {
    evidence.push({
      id: "section:summary",
      kind: "profile_summary",
      label: profile.sections?.summary?.name || "Resume summary",
      text: sectionSummary,
    });
  }

  for (const item of profile.sections?.experience?.items ?? []) {
    if (item.visible === false) continue;
    const text = cleanText(
      [item.position, item.company, item.location, item.date, item.summary]
        .filter(Boolean)
        .join(". "),
    );
    if (!text) continue;
    evidence.push({
      id: item.id
        ? `experience:${item.id}`
        : fallbackEvidenceId("experience", item),
      kind: "experience",
      label: [item.position, item.company].filter(Boolean).join(" at "),
      text,
    });
  }

  for (const item of profile.sections?.projects?.items ?? []) {
    if (item.visible === false) continue;
    const text = cleanText(
      [
        item.name,
        item.date,
        item.description,
        item.summary,
        ...(item.keywords ?? []),
      ]
        .filter(Boolean)
        .join(". "),
    );
    if (!text) continue;
    evidence.push({
      id: item.id ? `project:${item.id}` : fallbackEvidenceId("project", item),
      kind: "project",
      label: item.name || "Project",
      text,
    });
  }

  for (const item of profile.sections?.skills?.items ?? []) {
    if (item.visible === false) continue;
    const text = cleanText(
      [item.name, item.description, ...item.keywords]
        .filter(Boolean)
        .join(". "),
    );
    if (!text) continue;
    evidence.push({
      id: item.id ? `skill:${item.id}` : fallbackEvidenceId("skill", item),
      kind: "skill",
      label: item.name || "Skills",
      text,
    });
  }

  return evidence;
}

export function createResumeEvidenceFingerprint(
  evidence: readonly TailoringEvidenceItem[],
): string {
  return fingerprint(evidence);
}

export function createTailoredContentFingerprint(
  content: TailoringContentForGrounding,
): string {
  return fingerprint({
    headline: cleanText(content.headline),
    summary: cleanText(content.summary),
    skills: content.skills.map((group) => ({
      name: cleanText(group.name),
      keywords: group.keywords.map(cleanText),
    })),
  });
}

export function createStoredTailoredContentFingerprint(input: {
  headline: string | null | undefined;
  summary: string | null | undefined;
  skillsJson: string | null | undefined;
}): string | null {
  if (!input.headline || !input.summary || !input.skillsJson) return null;
  try {
    const parsed = JSON.parse(input.skillsJson) as unknown;
    if (!Array.isArray(parsed)) return null;
    const skills: TailoringContentForGrounding["skills"] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.name !== "string" || !Array.isArray(record.keywords)) {
        return null;
      }
      const keywords = record.keywords.filter(
        (keyword): keyword is string => typeof keyword === "string",
      );
      if (keywords.length !== record.keywords.length) return null;
      skills.push({ name: record.name, keywords });
    }
    return createTailoredContentFingerprint({
      headline: input.headline,
      summary: input.summary,
      skills,
    });
  } catch {
    return null;
  }
}

function claimIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function createTailoringClaims(
  content: TailoringContentForGrounding,
  grounding?: TailoringGroundingReferences | null,
): TailoringClaim[] {
  const skillEvidence = new Map(
    (grounding?.skills ?? []).map((item) => [
      cleanText(item.name).toLowerCase(),
      uniqueStrings(item.evidenceIds),
    ]),
  );
  const claims: TailoringClaim[] = [
    {
      id: "headline",
      target: "headline",
      text: cleanText(content.headline),
      evidenceIds: uniqueStrings(grounding?.headlineEvidenceIds),
    },
    {
      id: "summary",
      target: "summary",
      text: cleanText(content.summary),
      evidenceIds: uniqueStrings(grounding?.summaryEvidenceIds),
    },
  ];

  for (const group of content.skills) {
    for (const keyword of group.keywords) {
      const text = cleanText(keyword);
      if (!text) continue;
      claims.push({
        id: `skill:${claimIdPart(group.name)}:${claimIdPart(text)}`,
        target: "skill",
        text,
        evidenceIds: skillEvidence.get(text.toLowerCase()) ?? [],
      });
    }
  }

  return claims.filter((claim) => claim.text.length > 0);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/million/g, "m")
    .replace(/billion/g, "b")
    .replace(/thousand/g, "k")
    .replace(/[^\p{L}\p{N}%$€£]+/gu, "")
    .trim();
}

function extractMetrics(value: string): string[] {
  const matches = value.match(
    /(?:[$€£]\s*)?\d[\d,.]*(?:\s*%|\s*(?:k|m|b|million|billion|thousand))?/giu,
  );
  return uniqueStrings((matches ?? []).map(normalize));
}

function meaningfulTokens(value: string): string[] {
  return uniqueStrings(
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}+#.]{3,}/gu)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? [],
  );
}

function evidenceOverlap(claim: string, evidenceText: string): number {
  const tokens = meaningfulTokens(claim);
  if (tokens.length === 0) return 1;
  const normalizedEvidence = evidenceText.toLowerCase();
  const matches = tokens.filter((token) => normalizedEvidence.includes(token));
  return matches.length / tokens.length;
}

export function validateTailoringClaims(input: {
  evidence: readonly TailoringEvidenceItem[];
  claims: readonly TailoringClaim[];
  now?: string;
}): TailoringValidationReport {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const issues: TailoringValidationIssue[] = [];

  for (const claim of input.claims) {
    if (claim.target === "headline") continue;

    const knownEvidence = claim.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is TailoringEvidenceItem => Boolean(item));
    const unknownIds = claim.evidenceIds.filter((id) => !evidenceById.has(id));

    if (unknownIds.length > 0) {
      issues.push({
        claimId: claim.id,
        code: "unknown_evidence",
        severity: "error",
        message:
          "The model cited evidence IDs that do not exist in the resume.",
        evidenceIds: unknownIds,
      });
    }

    if (knownEvidence.length === 0) {
      issues.push({
        claimId: claim.id,
        code: "missing_evidence",
        severity: "error",
        message: "This claim has no supporting resume evidence.",
        evidenceIds: [],
      });
      continue;
    }

    const evidenceText = knownEvidence.map((item) => item.text).join(" ");
    const normalizedEvidence = normalize(evidenceText);

    if (claim.target === "skill") {
      if (!normalizedEvidence.includes(normalize(claim.text))) {
        issues.push({
          claimId: claim.id,
          code: "unsupported_skill",
          severity: "error",
          message: `The skill "${claim.text}" is not present in its cited resume evidence.`,
          evidenceIds: knownEvidence.map((item) => item.id),
        });
      }
      continue;
    }

    const unsupportedMetrics = extractMetrics(claim.text).filter(
      (metric) => !extractMetrics(evidenceText).includes(metric),
    );
    if (unsupportedMetrics.length > 0) {
      issues.push({
        claimId: claim.id,
        code: "unsupported_metric",
        severity: "error",
        message: `The claim contains unsupported numeric evidence: ${unsupportedMetrics.join(", ")}.`,
        evidenceIds: knownEvidence.map((item) => item.id),
      });
    }

    if (evidenceOverlap(claim.text, evidenceText) < 0.15) {
      issues.push({
        claimId: claim.id,
        code: "low_evidence_overlap",
        severity: "warning",
        message:
          "This claim has little direct wording overlap with its cited evidence. Review the paraphrase.",
        evidenceIds: knownEvidence.map((item) => item.id),
      });
    }
  }

  const claimsWithIssues = new Set(issues.map((issue) => issue.claimId));
  const warningCount = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const errorCount = issues.filter(
    (issue) => issue.severity === "error",
  ).length;

  return {
    status: issues.length === 0 ? "passed" : "review",
    validatorVersion: TAILORING_VALIDATOR_VERSION,
    totalClaims: input.claims.length,
    groundedClaims: input.claims.length - claimsWithIssues.size,
    warningCount,
    errorCount,
    issues,
    validatedAt: input.now ?? new Date().toISOString(),
  };
}
