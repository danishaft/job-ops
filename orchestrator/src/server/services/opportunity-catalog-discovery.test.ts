import { describe, expect, it } from "vitest";
import { discoverOpportunityCatalogJobs } from "./opportunity-catalog-discovery";

describe("opportunity catalog discovery", () => {
  it("creates reusable talent-network opportunities without browser or model work", async () => {
    const result = await discoverOpportunityCatalogJobs({
      searchTerms: ["backend"],
      sourceIds: ["a16z-talentplace"],
      dependencies: {
        readPage: async () => {
          throw new Error("not expected");
        },
        interpretPage: async () => {
          throw new Error("not expected");
        },
      },
    });

    expect(result.sourceErrors).toEqual([]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      source: "a16z:talentplace",
      opportunitySignals: {
        hasOpenRole: false,
        isTalentNetwork: true,
        warmConnectionStatus: "unknown",
      },
    });
  });

  it("maps page opportunities and classifies public source signals", async () => {
    const result = await discoverOpportunityCatalogJobs({
      searchTerms: ["backend"],
      sourceIds: ["a16z-build", "github-opportunities"],
      dependencies: {
        readPage: async (source) => `Visible source ${source.url}`,
        interpretPage: async ({ source }) => [
          {
            kind:
              source.channel === "open_source"
                ? "open_source"
                : "company_signal",
            title: "Backend opportunity",
            employer: source.label,
            url: source.url,
            applicationUrl: "",
            location: "Remote",
            description: "A concrete public opportunity.",
            directApplicationEmail: false,
          },
        ],
      },
    });

    expect(result.sourceErrors).toEqual([]);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.opportunitySignals).toMatchObject({
      hasOpenRole: false,
      hasStrongHiringSignal: true,
      warmConnectionStatus: "unknown",
    });
    expect(result.jobs[1]?.opportunitySignals).toMatchObject({
      hasOpenRole: false,
      isOpenSourceCompany: true,
      warmConnectionStatus: "unknown",
    });
  });

  it("pulls matching top-level jobs from the current Hacker News hiring thread", async () => {
    const result = await discoverOpportunityCatalogJobs({
      searchTerms: ["TypeScript"],
      sourceIds: ["hn-who-is-hiring"],
      dependencies: {
        fetchJson: async (url) =>
          url.includes("search_by_date")
            ? {
                hits: [
                  {
                    title: "Ask HN: Who is hiring? (August 2026)",
                    objectID: "123",
                    author: "whoishiring",
                  },
                ],
              }
            : {
                children: [
                  {
                    id: 456,
                    author: "founder",
                    text: "Acme | Backend Engineer | TypeScript | apply@acme.test",
                  },
                  {
                    id: 789,
                    author: "other",
                    text: "Other Co | Designer",
                  },
                ],
              },
      },
    });

    expect(result.sourceErrors).toEqual([]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      source: "hackernews:who-is-hiring",
      sourceJobId: "456",
      employer: "Acme",
      opportunitySignals: {
        hasOpenRole: true,
        hasDirectApplicationEmail: true,
        hasStrongHiringSignal: true,
        warmConnectionStatus: "unknown",
      },
    });
  });

  it("keeps partial results when one catalog source fails", async () => {
    const result = await discoverOpportunityCatalogJobs({
      searchTerms: ["backend"],
      sourceIds: ["a16z-talentplace", "wellfound"],
      dependencies: {
        readPage: async () => {
          throw new Error("private upstream detail");
        },
      },
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      "Wellfound startup jobs: unavailable",
    ]);
    expect(result.sourceErrors[0]).not.toContain("private upstream detail");
  });
});
