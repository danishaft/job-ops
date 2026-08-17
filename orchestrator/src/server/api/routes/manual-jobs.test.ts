import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Manual jobs API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  describe("POST /api/manual-jobs/fetch", () => {
    it("rejects invalid URLs", async () => {
      const res = await fetch(`${baseUrl}/api/manual-jobs/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-valid-url" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects empty payload", async () => {
      const res = await fetch(`${baseUrl}/api/manual-jobs/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("rejects known blocked autofetch domains", async () => {
      const res = await fetch(`${baseUrl}/api/manual-jobs/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.linkedin.com/jobs/view/123" }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain(
        "Auto-fetch is not supported for LinkedIn links",
      );
    });
  });

  it("infers manual jobs and rejects empty payloads", async () => {
    const badRes = await fetch(`${baseUrl}/api/manual-jobs/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badRes.status).toBe(400);

    const { inferManualJobDetails } = await import(
      "@server/services/manualJob"
    );
    vi.mocked(inferManualJobDetails).mockResolvedValue({
      job: { title: "Backend Engineer", employer: "Acme" },
      warning: null,
    });

    const res = await fetch(`${baseUrl}/api/manual-jobs/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription: "Role description" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.job.title).toBe("Backend Engineer");
  });

  it("imports manual jobs with a required job URL", async () => {
    const { processJob } = await import("@server/pipeline/index");
    const { scoreJobSuitability } = await import("@server/services/scorer");
    vi.mocked(scoreJobSuitability).mockResolvedValue({
      score: 88,
      reason: "Strong fit",
      jobBrief: null,
    });

    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/backend-engineer",
          jobDescription: "Great role",
        },
      }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.source).toBe("manual");
    expect(body.data.status).toBe("processing");
    expect(body.data.jobUrl).toBe("https://example.com/jobs/backend-engineer");
    expect(vi.mocked(processJob)).toHaveBeenCalledWith(body.data.id, {
      analyticsOrigin: "manual_job_create",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const readyRes = await fetch(`${baseUrl}/api/jobs/${body.data.id}`);
    const readyBody = await readyRes.json();
    expect(readyBody.ok).toBe(true);
    expect(readyBody.data.status).toBe("ready");
    expect(readyBody.data.suitabilityScore).toBe(88);
  });

  it("routes a VC talent profile without treating it as an open role", async () => {
    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skipTailoring: true,
        job: {
          source: "a16z:talentplace",
          title: "a16z TalentPlace profile",
          employer: "a16z portfolio",
          jobUrl: "https://talentplace.a16z.com/",
          applicationLink: "https://talentplace.a16z.com/",
          jobDescription: "Reusable candidate profile for portfolio companies.",
          opportunitySignals: {
            hasOpenRole: false,
            isTalentNetwork: true,
            eligibility: "eligible",
          },
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.opportunityType).toBe("talent_network");
    expect(body.data.opportunityRoute).toBe("submit_talent_profile");
    expect(body.data.opportunitySignals.hasOpenRole).toBe(false);
  });

  it("merges the same cross-source role and preserves both provenance entries", async () => {
    const firstPayload = {
      skipTailoring: true,
      job: {
        source: "a16z:portfolio-jobs",
        sourceJobId: "acme-123",
        title: "Backend Engineer",
        employer: "Acme Labs",
        jobUrl: "https://portfoliojobs.a16z.com/jobs/acme-123",
        jobDescription: "Build backend systems.",
      },
    };
    const secondPayload = {
      skipTailoring: true,
      job: {
        source: "linkedin",
        sourceJobId: "linkedin-456",
        title: "Backend Engineer",
        employer: "Acme Labs, Inc.",
        jobUrl: "https://www.linkedin.com/jobs/view/456",
        jobDescription: "Build backend systems.",
      },
    };

    const first = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(firstPayload),
    });
    const firstBody = await first.json();
    const second = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secondPayload),
    });
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.opportunityProvenance).toHaveLength(2);
    expect(
      secondBody.data.opportunityProvenance.map(
        (entry: { source: string }) => entry.source,
      ),
    ).toEqual(["a16z:portfolio-jobs", "linkedin"]);
  });

  it("rejects duplicate manual imports by source and source job id", async () => {
    const { scoreJobSuitability } = await import("@server/services/scorer");
    vi.mocked(scoreJobSuitability).mockResolvedValue({
      score: 88,
      reason: "Strong fit",
      jobBrief: null,
    });

    const firstRes = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          source: "workday:autodesk",
          sourceJobId: "26WD97952",
          title: "Backend Engineer",
          employer: "Autodesk",
          jobUrl: "https://autodesk.wd1.myworkdayjobs.com/Ext/job/one",
          jobDescription: "Great role",
        },
      }),
    });
    expect(firstRes.status).toBe(200);

    const duplicateRes = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          source: "workday:autodesk",
          sourceJobId: "26WD97952",
          title: "Backend Engineer",
          employer: "Autodesk",
          jobUrl: "https://autodesk.wd1.myworkdayjobs.com/Ext/job/two",
          jobDescription: "Great role",
        },
      }),
    });
    const duplicateBody = await duplicateRes.json();

    expect(duplicateRes.status).toBe(409);
    expect(duplicateBody.ok).toBe(false);
    expect(duplicateBody.error.code).toBe("CONFLICT");
    expect(duplicateBody.error.message).toBe(
      "This job is already in your workspace.",
    );
  });

  it("rejects manual imports without a job URL", async () => {
    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobDescription: "Great role",
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("skips tailoring and scoring when skipTailoring is true", async () => {
    const { processJob } = await import("@server/pipeline/index");
    const { scoreJobSuitability } = await import("@server/services/scorer");
    vi.mocked(processJob).mockClear();
    vi.mocked(scoreJobSuitability).mockClear();

    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skipTailoring: true,
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/skip-tailor",
          jobDescription: "Great role",
        },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("discovered");
    expect(vi.mocked(processJob)).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(vi.mocked(scoreJobSuitability)).not.toHaveBeenCalled();

    const followupRes = await fetch(`${baseUrl}/api/jobs/${body.data.id}`);
    const followupBody = await followupRes.json();
    expect(followupBody.data.status).toBe("discovered");
    expect(followupBody.data.suitabilityScore).toBeNull();
    expect(followupBody.data.tailoredSummary ?? null).toBeNull();
  });

  it("falls back to autoTailorOnManualImport setting when skipTailoring is omitted", async () => {
    const { processJob } = await import("@server/pipeline/index");
    const { setSetting } = await import("@server/repositories/settings");
    vi.mocked(processJob).mockClear();
    await setSetting("autoTailorOnManualImport", "0");

    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/setting-default",
          jobDescription: "Great role",
        },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("discovered");
    expect(vi.mocked(processJob)).not.toHaveBeenCalled();
  });

  it("still tailors when skipTailoring is explicitly false even if setting is off", async () => {
    const { processJob } = await import("@server/pipeline/index");
    const { setSetting } = await import("@server/repositories/settings");
    const { scoreJobSuitability } = await import("@server/services/scorer");
    vi.mocked(processJob).mockClear();
    vi.mocked(scoreJobSuitability).mockResolvedValue({
      score: 70,
      reason: "Fit",
      jobBrief: null,
    });
    await setSetting("autoTailorOnManualImport", "0");

    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skipTailoring: false,
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/explicit-tailor",
          jobDescription: "Great role",
        },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("processing");
    expect(vi.mocked(processJob)).toHaveBeenCalledWith(body.data.id, {
      analyticsOrigin: "manual_job_create",
    });
  });
});
