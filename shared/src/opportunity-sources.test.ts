import { describe, expect, it } from "vitest";
import { OPPORTUNITY_SOURCES } from "./opportunity-sources";

describe("opportunity source catalog", () => {
  it("contains unique source IDs and URLs", () => {
    expect(new Set(OPPORTUNITY_SOURCES.map((source) => source.id)).size).toBe(
      OPPORTUNITY_SOURCES.length,
    );
    expect(
      new Set(OPPORTUNITY_SOURCES.map((source) => source.sourceId)).size,
    ).toBe(OPPORTUNITY_SOURCES.length);
    expect(new Set(OPPORTUNITY_SOURCES.map((source) => source.url)).size).toBe(
      OPPORTUNITY_SOURCES.length,
    );
  });

  it("keeps talent profiles separate from portfolio-role boards", () => {
    const talentNetworks = OPPORTUNITY_SOURCES.filter(
      (source) => source.channel === "talent_network",
    );
    const portfolioBoards = OPPORTUNITY_SOURCES.filter(
      (source) => source.channel === "portfolio_board",
    );

    expect(talentNetworks.map((source) => source.id)).toEqual([
      "a16z-talentplace",
      "point-nine-talent-network",
      "balderton-talent-network",
    ]);
    expect(talentNetworks.every((source) => source.trackAsOpportunity)).toBe(
      true,
    );
    expect(portfolioBoards.every((source) => !source.trackAsOpportunity)).toBe(
      true,
    );
  });

  it("contains only absolute HTTP URLs with a verification date", () => {
    for (const source of OPPORTUNITY_SOURCES) {
      expect(new URL(source.url).protocol).toMatch(/^https?:$/);
      expect(source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("declares how every source participates in batch discovery", () => {
    expect(
      new Set(OPPORTUNITY_SOURCES.map((source) => source.batchMode)),
    ).toEqual(new Set(["static", "hacker_news", "page"]));
  });
});
