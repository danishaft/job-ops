import { createJob } from "@shared/testing/factories";
import type { JobContact, JobOutreach } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/client/api";
import { PeopleOutreachCard } from "./PeopleOutreachCard";

vi.mock("@/client/api", () => ({
  getJobPeopleOutreach: vi.fn(),
  researchJobContacts: vi.fn(),
  createJobContact: vi.fn(),
  updateJobContact: vi.fn(),
  deleteJobContact: vi.fn(),
  draftJobOutreach: vi.fn(),
  updateJobOutreach: vi.fn(),
}));

const contact: JobContact = {
  id: "contact-1",
  jobId: "job-1",
  name: "Ada Lovelace",
  title: "Head of Engineering",
  company: "Acme Labs",
  team: "Platform",
  role: "engineering_leader",
  status: "selected",
  relationshipStrength: "unknown",
  relevanceScore: 94,
  relevanceReason: "Owns the team hiring this role.",
  evidenceSummary: "Acme names Ada as Head of Engineering.",
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

const outreach: JobOutreach = {
  id: "outreach-1",
  jobId: "job-1",
  contactId: contact.id,
  purpose: "application_follow_up",
  channel: "linkedin",
  status: "draft",
  subject: "",
  body: "I applied for the role and built a related product. Would this experience be useful to your team?",
  sentAt: null,
  followUpAt: null,
  repliedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PeopleOutreachCard job={createJob()} />
    </QueryClientProvider>,
  );
}

describe("PeopleOutreachCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getJobPeopleOutreach).mockResolvedValue({
      contacts: [contact],
      outreach: [],
    });
  });

  it("shows why a person is relevant before allowing a draft", async () => {
    vi.mocked(api.draftJobOutreach).mockResolvedValue(outreach);
    renderCard();

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText(contact.relevanceReason)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Draft message" }));

    await waitFor(() =>
      expect(api.draftJobOutreach).toHaveBeenCalledWith("job-1", "contact-1"),
    );
  });

  it("records manual sending without triggering an external send", async () => {
    vi.mocked(api.getJobPeopleOutreach).mockResolvedValue({
      contacts: [contact],
      outreach: [outreach],
    });
    vi.mocked(api.updateJobOutreach).mockResolvedValue({
      ...outreach,
      status: "sent",
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Mark sent" }));

    await waitFor(() =>
      expect(api.updateJobOutreach).toHaveBeenCalledWith(
        "job-1",
        "outreach-1",
        expect.objectContaining({ status: "sent" }),
      ),
    );
    expect(
      screen.getByText(/JobOps never sends this message/),
    ).toBeInTheDocument();
  });
});
