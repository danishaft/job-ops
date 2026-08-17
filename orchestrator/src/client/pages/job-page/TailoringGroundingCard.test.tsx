import { createJob } from "@shared/testing/factories";
import type { Job, LatestTailoringAuditResponse } from "@shared/types";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/client/api";
import { renderWithQueryClient } from "@/client/test/renderWithQueryClient";
import { TailoringGroundingCard } from "./TailoringGroundingCard";

vi.mock("@/client/api", () => ({
  getLatestTailoringAudit: vi.fn(),
}));

vi.mock("@/client/hooks/useQueryErrorToast", () => ({
  useQueryErrorToast: vi.fn(),
}));

const job = createJob({
  tailoredHeadline: "Backend Engineer",
  tailoredSummary: "Built reliable services.",
  tailoredSkills: JSON.stringify([
    { name: "Backend", keywords: ["TypeScript"] },
  ]),
}) as Job;

function response(
  overrides?: Partial<LatestTailoringAuditResponse>,
): LatestTailoringAuditResponse {
  return {
    isCurrent: true,
    run: {
      id: "run-1",
      jobId: job.id,
      status: "completed",
      provider: "openrouter",
      model: "test-model",
      promptVersion: "sha256:test",
      sourceResumeFingerprint: "resume",
      outputFingerprint: "output",
      durationMs: 120,
      startedAt: 1_000,
      completedAt: 1_120,
      appliedFields: ["summary", "headline", "skills"],
      evidence: [
        {
          id: "skill:backend",
          kind: "skill",
          label: "Backend skills",
          text: "TypeScript",
        },
      ],
      claims: [
        {
          id: "skill:backend:typescript",
          target: "skill",
          text: "TypeScript",
          evidenceIds: ["skill:backend"],
        },
      ],
      validation: {
        status: "passed",
        validatorVersion: "grounding-2026-07-31",
        totalClaims: 1,
        groundedClaims: 1,
        warningCount: 0,
        errorCount: 0,
        issues: [],
        validatedAt: "2026-07-31T00:00:00.000Z",
      },
      errorMessage: null,
      createdAt: "2026-07-31T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("TailoringGroundingCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a grounded result for the current generated tailoring", async () => {
    vi.mocked(api.getLatestTailoringAudit).mockResolvedValue(response());
    renderWithQueryClient(<TailoringGroundingCard job={job} />);

    expect((await screen.findAllByText("Grounded")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Backend skills")).not.toBeInTheDocument();
    expect(screen.getByText(/openrouter/i)).toBeInTheDocument();
  });

  it("shows the claim and evidence label when review is required", async () => {
    const review = response();
    if (!review.run?.validation) throw new Error("Expected validation fixture");
    review.run.validation.status = "review";
    review.run.validation.groundedClaims = 0;
    review.run.validation.errorCount = 1;
    review.run.validation.issues = [
      {
        claimId: "skill:backend:typescript",
        code: "unsupported_skill",
        severity: "error",
        message: "The skill is unsupported.",
        evidenceIds: ["skill:backend"],
      },
    ];
    vi.mocked(api.getLatestTailoringAudit).mockResolvedValue(review);

    renderWithQueryClient(<TailoringGroundingCard job={job} />);

    expect(await screen.findByText("Review required")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText(/Backend skills/)).toBeInTheDocument();
  });

  it("marks the report stale after manual tailoring changes", async () => {
    vi.mocked(api.getLatestTailoringAudit).mockResolvedValue(
      response({ isCurrent: false }),
    );
    renderWithQueryClient(<TailoringGroundingCard job={job} />);

    expect(await screen.findByText("Stale report")).toBeInTheDocument();
    expect(screen.getByText(/changed after this report/i)).toBeInTheDocument();
  });
});
