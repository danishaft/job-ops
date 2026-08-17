import type { CreateJobInput } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { importJobsStep } from "./import-jobs";

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn() },
}));

vi.mock("@server/repositories/jobs", () => ({
  createJobs: vi.fn(async () => ({ created: 1, skipped: 0 })),
}));

vi.mock("../progress", () => ({
  progressHelpers: {
    importingJob: vi.fn(),
    importComplete: vi.fn(),
  },
}));

describe("importJobsStep", () => {
  it("publishes the job currently being imported", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { progressHelpers } = await import("../progress");
    const job: CreateJobInput = {
      source: "linkedin",
      title: "Frontend Engineer",
      employer: "Monzo",
      jobUrl: "https://example.com/jobs/1",
    };

    await importJobsStep({ discoveredJobs: [job] });

    const onProgress = vi.mocked(jobsRepo.createJobs).mock.calls[0]?.[1];
    expect(onProgress).toBeTypeOf("function");
    onProgress?.(job, 1, 1);

    expect(progressHelpers.importingJob).toHaveBeenCalledWith(1, 1, {
      id: job.jobUrl,
      title: job.title,
      employer: job.employer,
    });
  });

  it("classifies public application-email evidence and leaves connections unknown", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const job: CreateJobInput = {
      source: "hackernews:who-is-hiring",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/jobs/2",
      jobDescription: "Apply by email with your CV to jobs@example.com.",
    };

    await importJobsStep({ discoveredJobs: [job] });

    expect(vi.mocked(jobsRepo.createJobs).mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        opportunitySignals: expect.objectContaining({
          hasOpenRole: true,
          hasDirectApplicationEmail: true,
          hasWarmConnection: false,
          warmConnectionStatus: "unknown",
        }),
      }),
    ]);
  });
});
