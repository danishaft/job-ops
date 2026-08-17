import { createJob } from "@shared/testing/factories";
import type { JobContact, ResumeProfile } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  buildOutreachDraftPrompt,
  resolveOutreachChannel,
  resolveOutreachPurpose,
} from "./outreach-drafting";

const contact: JobContact = {
  id: "contact-1",
  jobId: "job-1",
  name: "Ada Lovelace",
  title: "Head of Engineering",
  company: "Acme",
  team: "Platform",
  role: "engineering_leader",
  status: "selected",
  relationshipStrength: "unknown",
  relevanceScore: 93,
  relevanceReason: "Owns the platform team hiring this role.",
  evidenceSummary: "Acme lists Ada as Head of Engineering.",
  sourceUrl: "https://acme.example/team/ada",
  linkedinUrl: "https://linkedin.com/in/ada",
  xUrl: null,
  email: null,
  emailConfidence: "unknown",
  isPrimary: true,
  notes: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("outreach drafting", () => {
  it("chooses purpose from the opportunity route and channel from verified contact data", () => {
    expect(resolveOutreachPurpose(createJob(), contact)).toBe(
      "application_follow_up",
    );
    expect(
      resolveOutreachPurpose(
        createJob({ opportunityRoute: "speculative_outreach" }),
        contact,
      ),
    ).toBe("speculative_outreach");
    expect(resolveOutreachChannel(contact)).toBe("linkedin");
    expect(
      resolveOutreachChannel({
        ...contact,
        email: "ada@acme.example",
        emailConfidence: "verified",
      }),
    ).toBe("linkedin");
    expect(
      resolveOutreachChannel(
        {
          ...contact,
          email: "ada@acme.example",
          emailConfidence: "verified",
        },
        "direct_application",
      ),
    ).toBe("email");
  });

  it("grounds the prompt in exact resume evidence and prohibits invented claims", () => {
    const profile: ResumeProfile = {
      basics: { name: "Ayodele", headline: "Software Engineer" },
      sections: {
        experience: {
          items: [
            {
              id: "doow",
              company: "Doow",
              position: "Software Engineer",
              location: "Remote",
              date: "2024 - Present",
              summary: "Built Derek and Mina, Doow's finance agents.",
              visible: true,
            },
          ],
        },
      },
    };
    const prompt = buildOutreachDraftPrompt({
      job: createJob({ title: "AI Product Engineer" }),
      contact,
      profile,
      purpose: "application_follow_up",
      channel: "linkedin",
    });

    expect(prompt).toContain("Built Derek and Mina, Doow's finance agents.");
    expect(prompt).toContain("Do not claim a relationship");
    expect(prompt).toContain("under 110 words");
    expect(prompt).toContain("Do not ask for a generic 15-minute call");
  });
});
