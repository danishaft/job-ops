import type { ResumeProfile } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  createResumeEvidenceFingerprint,
  createTailoringClaims,
  extractResumeEvidence,
  validateTailoringClaims,
} from "./tailoring-grounding";

const profile: ResumeProfile = {
  basics: { summary: "Backend engineer focused on reliable APIs." },
  sections: {
    experience: {
      items: [
        {
          id: "exp-1",
          company: "Acme",
          position: "Software Engineer",
          location: "Lagos",
          date: "2022 - 2025",
          summary: "Built TypeScript APIs serving 10 million requests daily.",
          visible: true,
        },
      ],
    },
    skills: {
      items: [
        {
          id: "skills-1",
          name: "Backend",
          description: "Production backend development",
          level: 4,
          keywords: ["TypeScript", "Node.js"],
          visible: true,
        },
      ],
    },
  },
};

describe("tailoring grounding", () => {
  it("extracts stable, addressable evidence from visible resume sections", () => {
    const first = extractResumeEvidence(profile);
    const second = extractResumeEvidence(profile);

    expect(first.map((item) => item.id)).toEqual([
      "profile:summary",
      "experience:exp-1",
      "skill:skills-1",
    ]);
    expect(createResumeEvidenceFingerprint(first)).toBe(
      createResumeEvidenceFingerprint(second),
    );
  });

  it("grounds supported summary metrics and skills", () => {
    const evidence = extractResumeEvidence(profile);
    const claims = createTailoringClaims(
      {
        headline: "Senior Backend Engineer",
        summary:
          "Backend engineer who built TypeScript APIs serving 10M requests daily.",
        skills: [{ name: "Backend", keywords: ["TypeScript"] }],
      },
      {
        summaryEvidenceIds: ["experience:exp-1"],
        skills: [{ name: "TypeScript", evidenceIds: ["skill:skills-1"] }],
      },
    );

    const report = validateTailoringClaims({
      evidence,
      claims,
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("passed");
    expect(report.errorCount).toBe(0);
  });

  it("flags invented metrics, unsupported skills, and unknown references", () => {
    const evidence = extractResumeEvidence(profile);
    const claims = createTailoringClaims(
      {
        headline: "Senior Backend Engineer",
        summary: "Scaled the platform to 99.99% availability.",
        skills: [{ name: "Backend", keywords: ["Rust", "Node.js"] }],
      },
      {
        summaryEvidenceIds: ["experience:exp-1"],
        skills: [
          { name: "Rust", evidenceIds: ["skill:skills-1"] },
          { name: "Node.js", evidenceIds: ["missing:evidence"] },
        ],
      },
    );

    const report = validateTailoringClaims({ evidence, claims });

    expect(report.status).toBe("review");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unsupported_metric",
        "unsupported_skill",
        "unknown_evidence",
        "missing_evidence",
      ]),
    );
  });

  it("does not require evidence for a target-job headline", () => {
    const report = validateTailoringClaims({
      evidence: extractResumeEvidence(profile),
      claims: [
        {
          id: "headline",
          target: "headline",
          text: "Principal Platform Engineer",
          evidenceIds: [],
        },
      ],
    });

    expect(report.status).toBe("passed");
  });
});
