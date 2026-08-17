import { createJob } from "@shared/testing/factories";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/client/api";
import { OpportunityPlanCard } from "./OpportunityPlanCard";

vi.mock("@/client/api", () => ({
  updateJob: vi.fn(),
  inspectWithPeruz: vi.fn(),
  prefillWithPeruz: vi.fn(),
  createJobNote: vi.fn(),
}));

describe("OpportunityPlanCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a connection unknown until the user explicitly confirms it", async () => {
    const job = createJob({
      opportunitySignals: {
        hasOpenRole: true,
        hasWarmConnection: false,
        warmConnectionStatus: "unknown",
        hasDirectApplicationEmail: false,
        hasStrongHiringSignal: false,
        isTalentNetwork: false,
        isOpenSourceCompany: false,
        eligibility: "unknown",
      },
    });
    vi.mocked(api.updateJob).mockResolvedValue(job);

    render(<OpportunityPlanCard job={job} onUpdated={vi.fn()} />);

    expect(
      screen.getByText("Apply, then contact the team"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Warm connection"), {
      target: { value: "warm" },
    });
    expect(screen.getByText("Referral first, then apply")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save route" }));

    expect(api.updateJob).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({
        opportunitySignals: expect.objectContaining({
          hasWarmConnection: true,
          warmConnectionStatus: "warm",
        }),
      }),
    );
  });
});
