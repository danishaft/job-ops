import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("people and outreach API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    const { db, schema } = await import("@server/db");
    await db
      .insert(schema.users)
      .values({
        id: "test-user",
        username: "test-user",
        displayName: "Test User",
        passwordHash: "hash",
        passwordSalt: "salt",
      })
      .onConflictDoNothing()
      .run();
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function createTestJob() {
    const jobsRepo = await import("@server/repositories/jobs");
    return jobsRepo.createJob({
      source: "manual",
      title: "AI Product Engineer",
      employer: "Acme",
      jobUrl: "https://acme.example/jobs/ai-product-engineer",
      applicationLink: "https://acme.example/jobs/ai-product-engineer/apply",
    });
  }

  it("stores ranked people and tracks a manually approved outreach lifecycle", async () => {
    const job = await createTestJob();
    const createResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/contacts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          title: "Head of Engineering",
          company: "Acme",
          role: "engineering_leader",
          relationshipStrength: "unknown",
          relevanceScore: 94,
          relevanceReason: "Owns the team hiring this role.",
          evidenceSummary: "Acme's team page names Ada as Head of Engineering.",
          sourceUrl: "https://acme.example/team/ada",
          linkedinUrl: "https://linkedin.com/in/ada",
          isPrimary: true,
        }),
      },
    );
    const created = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      ok: true,
      data: {
        name: "Ada Lovelace",
        isPrimary: true,
        relationshipStrength: "unknown",
      },
    });

    const contactId = created.data.id as string;
    const draftResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/contacts/${contactId}/outreach`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "application_follow_up",
          channel: "linkedin",
          body: "I applied for the AI Product Engineer role and built a related finance-agent product. Would the work be useful to your team?",
        }),
      },
    );
    const draft = await draftResponse.json();
    expect(draftResponse.status).toBe(201);
    expect(draft.data.status).toBe("draft");

    const beforeSent = Math.floor(Date.now() / 1_000);
    const sentResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/outreach/${draft.data.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sent" }),
      },
    );
    const sent = await sentResponse.json();
    expect(sent.data.status).toBe("sent");
    expect(sent.data.sentAt).toBeGreaterThanOrEqual(beforeSent);
    expect(sent.data.followUpAt).toBeGreaterThan(sent.data.sentAt);

    const listResponse = await fetch(
      `${baseUrl}/api/jobs/${job.id}/people-outreach`,
    );
    const list = await listResponse.json();
    expect(list).toMatchObject({
      ok: true,
      data: {
        contacts: [{ id: contactId, status: "contacted" }],
        outreach: [{ id: draft.data.id, status: "sent" }],
      },
    });
  });

  it("requires source evidence before accepting a person", async () => {
    const job = await createTestJob();
    const response = await fetch(`${baseUrl}/api/jobs/${job.id}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ada Lovelace",
        title: "Head of Engineering",
        company: "Acme",
        role: "engineering_leader",
        relevanceReason: "Seems relevant",
        evidenceSummary: "No source supplied",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });
});
