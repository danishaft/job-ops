import { describe, expect, it } from "vitest";
import {
  getOpportunityRoutePlan,
  mergeOpportunityProvenance,
  mergeOpportunitySignals,
  normalizeOpportunitySignals,
  resolveOpportunityRoute,
  resolveOpportunityType,
} from "./opportunity-routing";

describe("opportunity routing", () => {
  it.each([
    [{ eligibility: "ineligible" }, "archive_ineligible"],
    [{ isTalentNetwork: true }, "submit_talent_profile"],
    [{ hasOpenRole: true, hasWarmConnection: true }, "referral_first"],
    [
      { hasOpenRole: true, hasDirectApplicationEmail: true },
      "direct_email_application",
    ],
    [{ hasOpenRole: true }, "apply_then_contact"],
    [
      { hasOpenRole: false, isOpenSourceCompany: true },
      "contribute_then_connect",
    ],
    [
      { hasOpenRole: false, hasStrongHiringSignal: true },
      "speculative_outreach",
    ],
    [{ hasOpenRole: false }, "watch"],
  ] as const)("routes %j to %s", (partial, expected) => {
    expect(resolveOpportunityRoute(normalizeOpportunitySignals(partial))).toBe(
      expected,
    );
  });

  it("keeps the eligibility gate ahead of every acquisition channel", () => {
    const signals = normalizeOpportunitySignals({
      eligibility: "ineligible",
      isTalentNetwork: true,
      hasWarmConnection: true,
      hasDirectApplicationEmail: true,
    });
    expect(resolveOpportunityRoute(signals)).toBe("archive_ineligible");
  });

  it("classifies opportunity type separately from its route", () => {
    const signals = normalizeOpportunitySignals({
      hasOpenRole: false,
      isOpenSourceCompany: true,
      hasStrongHiringSignal: true,
    });
    expect(resolveOpportunityType(signals)).toBe("open_source");
    expect(resolveOpportunityRoute(signals)).toBe("contribute_then_connect");
  });

  it("marks every external send or submission as a human step", () => {
    for (const route of [
      "referral_first",
      "direct_email_application",
      "apply_then_contact",
      "speculative_outreach",
      "submit_talent_profile",
      "contribute_then_connect",
      "watch",
      "archive_ineligible",
    ] as const) {
      const plan = getOpportunityRoutePlan(route);
      expect(
        plan.steps.every(
          (step) => !step.externalAction || step.execution === "human",
        ),
      ).toBe(true);
    }
  });

  it("merges provenance without losing overlapping sources", () => {
    const merged = mergeOpportunityProvenance(
      [
        {
          source: "linkedin",
          sourceJobId: "123",
          url: "https://linkedin.example/123",
          discoveredAt: null,
        },
      ],
      [
        {
          source: "linkedin",
          sourceJobId: "123",
          url: "https://linkedin.example/123",
          discoveredAt: null,
        },
        {
          source: "a16z",
          sourceJobId: null,
          url: "https://jobs.a16z.com/acme/123",
          discoveredAt: null,
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.source)).toEqual(["linkedin", "a16z"]);
  });

  it("merges route signals conservatively", () => {
    expect(
      mergeOpportunitySignals(
        { hasOpenRole: false, hasStrongHiringSignal: true },
        { hasOpenRole: true, hasWarmConnection: true },
      ),
    ).toMatchObject({
      hasOpenRole: true,
      hasWarmConnection: true,
      hasStrongHiringSignal: true,
    });

    expect(
      mergeOpportunitySignals(
        { eligibility: "eligible" },
        { eligibility: "ineligible" },
      ).eligibility,
    ).toBe("ineligible");
  });

  it("keeps private connection knowledge unknown until the user checks it", () => {
    expect(normalizeOpportunitySignals({}).warmConnectionStatus).toBe(
      "unknown",
    );
    expect(
      normalizeOpportunitySignals({ hasWarmConnection: true }),
    ).toMatchObject({
      hasWarmConnection: true,
      warmConnectionStatus: "warm",
    });
  });

  it("merges warm-connection knowledge without losing a confirmed connection", () => {
    expect(
      mergeOpportunitySignals(
        { warmConnectionStatus: "unknown" },
        { warmConnectionStatus: "none" },
      ),
    ).toMatchObject({
      hasWarmConnection: false,
      warmConnectionStatus: "none",
    });

    expect(
      mergeOpportunitySignals(
        { warmConnectionStatus: "none" },
        { warmConnectionStatus: "warm" },
      ),
    ).toMatchObject({
      hasWarmConnection: true,
      warmConnectionStatus: "warm",
    });
  });
});
