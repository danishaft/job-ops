import { createJob } from "@shared/testing/factories";
import { describe, expect, it } from "vitest";
import {
  buildContactSearchUrls,
  extractResearchUrls,
  validateResearchCandidates,
} from "./contact-research";

describe("contact research", () => {
  it("builds company-specific searches for the likely owner of the work", () => {
    const urls = buildContactSearchUrls(
      createJob({
        title: "Founding AI Engineer",
        employer: "Acme AI",
        employerUrl: "https://acme.example/about",
      }),
    );

    expect(urls[0]).toBe("https://acme.example/about");
    expect(decodeURIComponent(urls.join("\n"))).toContain('"Acme AI"');
    expect(decodeURIComponent(urls.join("\n"))).toContain('"Founder"');
    expect(urls).toHaveLength(3);
  });

  it("extracts and normalizes public URLs from browser evidence", () => {
    expect(
      extractResearchUrls(
        "Profile https://www.linkedin.com/in/ada-lovelace/ and https://acme.example/team#ada.",
      ),
    ).toEqual([
      "https://www.linkedin.com/in/ada-lovelace",
      "https://acme.example/team",
    ]);
  });

  it("keeps only candidates grounded in an allowed non-search source", () => {
    const sourceUrl = "https://www.linkedin.com/in/ada-lovelace";
    const evidence = `SOURCE URL: ${sourceUrl}\nAda Lovelace is Head of Engineering at Acme. Contact ada@acme.example.`;
    const contacts = validateResearchCandidates({
      employer: "Acme",
      evidence,
      allowedUrls: [sourceUrl],
      candidates: [
        {
          name: "Ada Lovelace",
          title: "Head of Engineering",
          company: "Acme",
          team: "Platform",
          role: "engineering_leader",
          relevanceScore: 94,
          relevanceReason: "Owns engineering hiring.",
          evidenceSummary: "Current Head of Engineering at Acme.",
          sourceUrl,
          linkedinUrl: sourceUrl,
          xUrl: "",
          email: "ada@acme.example",
        },
        {
          name: "Grace Hopper",
          title: "CTO",
          company: "Acme",
          team: "",
          role: "decision_maker",
          relevanceScore: 99,
          relevanceReason: "Claimed CTO.",
          evidenceSummary: "Not present in evidence.",
          sourceUrl,
          linkedinUrl: sourceUrl,
          xUrl: "",
          email: "guessed@acme.example",
        },
      ],
    });

    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@acme.example",
      emailConfidence: "verified",
      relationshipStrength: "unknown",
    });
  });

  it("never accepts a search-results page as person evidence", () => {
    const sourceUrl = "https://www.bing.com/search?q=acme";
    const contacts = validateResearchCandidates({
      employer: "Acme",
      evidence: "Ada Lovelace Head of Engineering Acme",
      allowedUrls: [sourceUrl],
      candidates: [
        {
          name: "Ada Lovelace",
          title: "Head of Engineering",
          company: "Acme",
          team: "",
          role: "engineering_leader",
          relevanceScore: 90,
          relevanceReason: "Owns engineering.",
          evidenceSummary: "Search snippet.",
          sourceUrl,
          linkedinUrl: "",
          xUrl: "",
          email: "",
        },
      ],
    });

    expect(contacts).toEqual([]);
  });
});
