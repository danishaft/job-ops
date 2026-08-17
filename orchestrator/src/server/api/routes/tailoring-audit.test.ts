import type { Server } from "node:http";
import type { TailoringAuditRun } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("tailoring audit API", () => {
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

  function auditDraft(
    outputFingerprint: string,
  ): Omit<TailoringAuditRun, "id" | "jobId" | "appliedFields" | "createdAt"> {
    return {
      status: "completed",
      provider: "openrouter",
      model: "test-model",
      promptVersion: "sha256:prompt",
      sourceResumeFingerprint: "resume-fingerprint",
      outputFingerprint,
      durationMs: 120,
      startedAt: 1_000,
      completedAt: 1_120,
      evidence: [
        {
          id: "skill:backend",
          kind: "skill",
          label: "Backend",
          text: "TypeScript Node.js",
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
    };
  }

  it("returns the latest audit and detects whether it matches stored tailoring", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const auditRepo = await import("@server/repositories/tailoring-audit-runs");
    const { createTailoredContentFingerprint } = await import(
      "@server/services/tailoring-grounding"
    );
    const skills = [{ name: "Backend", keywords: ["TypeScript"] }];
    const content = {
      headline: "Backend Engineer",
      summary: "Backend engineer building reliable services.",
      skills,
    };
    const job = await jobsRepo.createJob({
      source: "manual",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/jobs/audit",
    });
    await jobsRepo.updateJob(job.id, {
      tailoredHeadline: content.headline,
      tailoredSummary: content.summary,
      tailoredSkills: JSON.stringify(skills),
    });
    await auditRepo.createTailoringAuditRun({
      jobId: job.id,
      appliedFields: ["headline", "summary", "skills"],
      audit: auditDraft(createTailoredContentFingerprint(content)),
    });

    const currentResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/tailoring-audit/latest`,
      { headers: { Connection: "close" } },
    );
    const currentBody = await currentResponse.json();
    expect(currentResponse.status).toBe(200);
    expect(currentBody.data).toMatchObject({
      isCurrent: true,
      run: { jobId: job.id, status: "completed" },
    });

    await jobsRepo.updateJob(job.id, { tailoredSummary: "Manually edited" });
    const staleResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/tailoring-audit/latest`,
      { headers: { Connection: "close" } },
    );
    const staleBody = await staleResponse.json();
    expect(staleBody.data.isCurrent).toBe(false);
  });

  it("does not expose a tailoring audit across tenants", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const { db, schema } = await import("@server/db");
    const jobsRepo = await import("@server/repositories/jobs");
    const auditRepo = await import("@server/repositories/tailoring-audit-runs");
    await db.insert(schema.tenants).values({
      id: "tenant-private",
      name: "Private tenant",
      slug: "private-tenant",
    });

    const privateJobId = await runWithRequestContext(
      { requestId: "tenant-private-test", tenantId: "tenant-private" },
      async () => {
        const job = await jobsRepo.createJob({
          source: "manual",
          title: "Private role",
          employer: "Private company",
          jobUrl: "https://example.com/jobs/private",
        });
        await auditRepo.createTailoringAuditRun({
          jobId: job.id,
          appliedFields: ["summary"],
          audit: auditDraft("private-output"),
        });
        return job.id;
      },
    );

    await expect(
      runWithRequestContext(
        { requestId: "tenant-default-test", tenantId: "tenant_default" },
        () => auditRepo.getLatestTailoringAuditRunForJob(privateJobId),
      ),
    ).resolves.toBeNull();
  });
});
