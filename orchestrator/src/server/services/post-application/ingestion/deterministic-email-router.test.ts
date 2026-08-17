import { describe, expect, it } from "vitest";
import { classifyWithLocalRules } from "./deterministic-email-router";

const jobs = [
  { id: "nous", company: "Nous", title: "Staff Software Engineer" },
  { id: "zopa", company: "Zopa", title: "Frontend Engineer" },
];

describe("classifyWithLocalRules", () => {
  it("links an unambiguous company-domain interview without an LLM", () => {
    const result = classifyWithLocalRules({
      fromAddress: "talent@nous.co",
      fromDomain: "nous.co",
      senderName: "Nous Talent",
      subject: "Staff Software Engineer interview",
      snippet: "Please share your availability for the technical interview.",
      activeJobs: jobs,
    });

    expect(result.bestMatchId).toBe("nous");
    expect(result.confidence).toBeGreaterThanOrEqual(95);
    expect(result.stageTarget).toBe("technical_interview");
    expect(result.isRelevant).toBe(true);
  });

  it("keeps a relevant but ambiguous recruiting reply for review", () => {
    const result = classifyWithLocalRules({
      fromAddress: "recruiter@agency.example",
      fromDomain: "agency.example",
      senderName: "Recruiting Team",
      subject: "Your application — next steps",
      snippet: "We would like to schedule a call.",
      activeJobs: jobs,
    });

    expect(result.bestMatchId).toBeNull();
    expect(result.confidence).toBe(50);
    expect(result.isRelevant).toBe(true);
  });

  it("does not treat a missing sender domain as a match for every company", () => {
    const result = classifyWithLocalRules({
      fromAddress: "",
      fromDomain: "",
      senderName: "Turing",
      subject: "Welcome to Turing",
      snippet: "Complete your profile and express interest in matching roles.",
      activeJobs: jobs,
    });

    expect(result.bestMatchId).toBeNull();
    expect(result.confidence).toBe(50);
    expect(result.isRelevant).toBe(true);
  });

  it("ignores mail without recruitment or active-company signals", () => {
    const result = classifyWithLocalRules({
      fromAddress: "newsletter@example.com",
      fromDomain: "example.com",
      senderName: "Example Weekly",
      subject: "This week's product news",
      snippet: "Read our latest stories.",
      activeJobs: jobs,
    });

    expect(result.bestMatchId).toBeNull();
    expect(result.isRelevant).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
