import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatePipelineRun: vi.fn(),
  processJobsStep: vi.fn(),
  notifyPipelineWebhookStep: vi.fn(),
  loadProfileStep: vi.fn(),
  discoverJobsStep: vi.fn(),
  importJobsStep: vi.fn(),
  scoreJobsStep: vi.fn(),
  selectJobsStep: vi.fn(),
}));

vi.mock("../config/dataDir", () => ({ getDataDir: () => "/tmp/jobops-test" }));
vi.mock("../tenancy/private-scope", () => ({
  getPrivateDataScope: () => ({ scopeKey: "tenant:test:user:test" }),
}));
vi.mock("../repositories/pipeline", () => ({
  createPipelineRun: vi.fn().mockResolvedValue({ id: "run-triage" }),
  updatePipelineRun: mocks.updatePipelineRun,
}));
vi.mock("../repositories/settings", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("../repositories/jobs", () => ({}));
vi.mock("../repositories/tailoring-audit-runs", () => ({}));
vi.mock("../services/hosted-usage", () => ({
  settleHostedUsageReservation: vi.fn(),
  reserveHostedUsage: vi.fn(),
  refundHostedUsageReservation: vi.fn(),
}));
vi.mock("./run-details", () => ({
  buildPipelineRunSavedDetails: vi.fn().mockResolvedValue(null),
  createPipelineRunResultSummary: () => ({
    stage: "started",
    jobsScored: null,
    jobsSelected: null,
    sourceErrors: [],
  }),
  updatePipelineRunResultSummary: (
    current: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => ({ ...current, ...update }),
}));
vi.mock("./progress", () => ({
  resetProgress: vi.fn(),
  progressHelpers: {
    complete: vi.fn(),
    configurationRequired: vi.fn(),
  },
}));
vi.mock("./steps", () => ({
  loadProfileStep: mocks.loadProfileStep,
  discoverJobsStep: mocks.discoverJobsStep,
  importJobsStep: mocks.importJobsStep,
  scoreJobsStep: mocks.scoreJobsStep,
  selectJobsStep: mocks.selectJobsStep,
  processJobsStep: mocks.processJobsStep,
  notifyPipelineWebhookStep: mocks.notifyPipelineWebhookStep,
}));

describe("pipeline triage mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const job = createJob({
      id: "job-triage",
      status: "discovered",
      suitabilityScore: 88,
    });
    mocks.loadProfileStep.mockResolvedValue({});
    mocks.discoverJobsStep.mockResolvedValue({
      discoveredJobs: [job],
      sourceErrors: [],
      pendingChallenges: [],
    });
    mocks.importJobsStep.mockResolvedValue({
      created: 1,
      skipped: 0,
      fuzzyMerged: 0,
    });
    mocks.scoreJobsStep.mockResolvedValue({
      unprocessedJobs: [job],
      scoredJobs: [job],
    });
    mocks.selectJobsStep.mockResolvedValue([job]);
  });

  it("ranks candidates without tailoring them when preparation is deferred", async () => {
    const { runPipeline } = await import("./orchestrator");

    const result = await runPipeline({
      sources: [],
      includeOpportunityCatalog: true,
      prepareTopMatches: false,
    });

    expect(result).toMatchObject({
      success: true,
      jobsDiscovered: 1,
      jobsProcessed: 0,
    });
    expect(mocks.processJobsStep).not.toHaveBeenCalled();
    expect(mocks.updatePipelineRun).toHaveBeenCalledWith(
      "run-triage",
      expect.objectContaining({
        status: "completed",
        jobsProcessed: 0,
      }),
    );
    expect(mocks.notifyPipelineWebhookStep).toHaveBeenCalledWith(
      "pipeline.completed",
      expect.objectContaining({ jobsProcessed: 0 }),
    );
  });
});
