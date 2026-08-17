import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("browser actions API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns a structured inspection without exposing a browser session", async () => {
    const { PeruzBrowserAdapter } = await import(
      "@server/services/browser-actions/peruz"
    );
    vi.spyOn(PeruzBrowserAdapter.prototype, "inspect").mockResolvedValue({
      kind: "role",
      url: "https://example.com/jobs/1",
      pageText: "Backend Engineer",
      inspectedAt: "2026-07-31T00:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/api/browser-actions/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "role",
        url: "https://example.com/jobs/1",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { kind: "role", pageText: "Backend Engineer" },
    });
    expect(body.data.windowId).toBeUndefined();
  });

  it("prefills a scoped job and explicitly reports that submission did not occur", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { getProfile } = await import("@server/services/profile");
    const { PeruzBrowserAdapter } = await import(
      "@server/services/browser-actions/peruz"
    );
    vi.mocked(getProfile).mockResolvedValue({
      basics: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    const job = await jobsRepo.createJob({
      source: "manual",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/jobs/2",
      applicationLink: "https://example.com/jobs/2/apply",
    });
    vi.spyOn(PeruzBrowserAdapter.prototype, "prefill").mockResolvedValue({
      jobId: job.id,
      url: job.applicationLink as string,
      windowId: "42",
      fields: [{ field: "email", status: "filled" }],
      humanActionRequired: true,
      submissionPerformed: false,
    });

    const response = await fetch(`${baseUrl}/api/browser-actions/prefill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      jobId: job.id,
      windowId: "42",
      humanActionRequired: true,
      submissionPerformed: false,
    });
  });

  it("rejects malformed inspection requests", async () => {
    const response = await fetch(`${baseUrl}/api/browser-actions/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "role", url: "not-a-url" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.meta.requestId).toBeTruthy();
  });
});
