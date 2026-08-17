import type {
  OpportunityProvenance,
  OpportunityRoute,
  OpportunitySignals,
  OpportunityType,
} from "./types/jobs";

export type OpportunityStepExecution =
  | "automatic"
  | "browser_assisted"
  | "human";

export interface OpportunityRouteStep {
  id: string;
  label: string;
  execution: OpportunityStepExecution;
  externalAction: boolean;
}

export interface OpportunityRoutePlan {
  route: OpportunityRoute;
  label: string;
  channel: string;
  steps: OpportunityRouteStep[];
}

export const DEFAULT_OPPORTUNITY_SIGNALS: OpportunitySignals = {
  hasOpenRole: true,
  hasWarmConnection: false,
  warmConnectionStatus: "unknown",
  hasDirectApplicationEmail: false,
  hasStrongHiringSignal: false,
  isTalentNetwork: false,
  isOpenSourceCompany: false,
  eligibility: "unknown",
};

export function normalizeOpportunitySignals(
  signals?: Partial<OpportunitySignals> | null,
): OpportunitySignals {
  const explicitStatus = signals?.warmConnectionStatus;
  const legacyStatus = signals?.hasWarmConnection === true ? "warm" : null;
  const warmConnectionStatus = explicitStatus ?? legacyStatus ?? "unknown";
  return {
    ...DEFAULT_OPPORTUNITY_SIGNALS,
    ...signals,
    hasWarmConnection: warmConnectionStatus === "warm",
    warmConnectionStatus,
  };
}

export function mergeOpportunitySignals(
  base?: Partial<OpportunitySignals> | null,
  incoming?: Partial<OpportunitySignals> | null,
): OpportunitySignals {
  const left = normalizeOpportunitySignals(base);
  const right = normalizeOpportunitySignals(incoming);
  const eligibility =
    left.eligibility === "ineligible" || right.eligibility === "ineligible"
      ? "ineligible"
      : left.eligibility === "eligible" || right.eligibility === "eligible"
        ? "eligible"
        : "unknown";
  const warmConnectionStatus =
    left.warmConnectionStatus === "warm" ||
    right.warmConnectionStatus === "warm"
      ? "warm"
      : left.warmConnectionStatus === "none" ||
          right.warmConnectionStatus === "none"
        ? "none"
        : "unknown";

  return {
    hasOpenRole: left.hasOpenRole || right.hasOpenRole,
    hasWarmConnection: warmConnectionStatus === "warm",
    warmConnectionStatus,
    hasDirectApplicationEmail:
      left.hasDirectApplicationEmail || right.hasDirectApplicationEmail,
    hasStrongHiringSignal:
      left.hasStrongHiringSignal || right.hasStrongHiringSignal,
    isTalentNetwork: left.isTalentNetwork || right.isTalentNetwork,
    isOpenSourceCompany: left.isOpenSourceCompany || right.isOpenSourceCompany,
    eligibility,
  };
}

export function resolveOpportunityRoute(
  input: OpportunitySignals,
): OpportunityRoute {
  if (input.eligibility === "ineligible") return "archive_ineligible";
  if (input.isTalentNetwork) return "submit_talent_profile";
  if (input.hasOpenRole && input.hasWarmConnection) return "referral_first";
  if (input.hasOpenRole && input.hasDirectApplicationEmail) {
    return "direct_email_application";
  }
  if (input.hasOpenRole) return "apply_then_contact";
  if (input.isOpenSourceCompany) return "contribute_then_connect";
  if (input.hasStrongHiringSignal) return "speculative_outreach";
  return "watch";
}

export function resolveOpportunityType(
  input: OpportunitySignals,
): OpportunityType {
  if (input.isTalentNetwork) return "talent_network";
  if (input.hasOpenRole) return "open_role";
  if (input.isOpenSourceCompany) return "open_source";
  if (input.hasStrongHiringSignal) return "hiring_signal";
  return "watchlist";
}

export function classifyPublicOpportunitySignals(input: {
  opportunitySignals?: Partial<OpportunitySignals> | null;
  emails?: string | null;
  jobDescription?: string | null;
}): OpportunitySignals {
  const signals = normalizeOpportunitySignals(input.opportunitySignals);
  const description = input.jobDescription ?? "";
  const directEmailInstruction =
    Boolean(input.emails?.trim()) ||
    /(?:apply|send|submit)[^.!?\n]{0,100}\b(?:email|e-mail)\b/i.test(
      description,
    ) ||
    /\bemail\b[^.!?\n]{0,100}(?:resume|cv|application)/i.test(description);

  return {
    ...signals,
    hasDirectApplicationEmail:
      signals.hasDirectApplicationEmail || directEmailInstruction,
    warmConnectionStatus: signals.warmConnectionStatus ?? "unknown",
  };
}

export function mergeOpportunityProvenance(
  base: readonly OpportunityProvenance[] = [],
  incoming: readonly OpportunityProvenance[] = [],
): OpportunityProvenance[] {
  const merged = new Map<string, OpportunityProvenance>();
  for (const entry of [...base, ...incoming]) {
    const key = `${entry.source}\u0000${entry.sourceJobId ?? ""}\u0000${entry.url}`;
    if (!merged.has(key)) merged.set(key, entry);
  }
  return Array.from(merged.values());
}

export function buildOpportunityProvenance(input: {
  source: string;
  sourceJobId?: string | null;
  jobUrl: string;
  jobUrlDirect?: string | null;
  discoveredAt?: string | null;
}): OpportunityProvenance {
  return {
    source: input.source,
    sourceJobId: input.sourceJobId ?? null,
    url: input.jobUrlDirect ?? input.jobUrl,
    discoveredAt: input.discoveredAt ?? null,
  };
}

const automatic = (id: string, label: string): OpportunityRouteStep => ({
  id,
  label,
  execution: "automatic",
  externalAction: false,
});

const assisted = (id: string, label: string): OpportunityRouteStep => ({
  id,
  label,
  execution: "browser_assisted",
  externalAction: false,
});

const human = (
  id: string,
  label: string,
  externalAction = false,
): OpportunityRouteStep => ({ id, label, execution: "human", externalAction });

export const OPPORTUNITY_ROUTE_PLANS: Record<
  OpportunityRoute,
  OpportunityRoutePlan
> = {
  referral_first: {
    route: "referral_first",
    label: "Referral first, then apply",
    channel: "Warm connection",
    steps: [
      assisted(
        "research_connection",
        "Verify the connection and referral path",
      ),
      automatic("draft_referral", "Draft a specific referral request"),
      human("send_referral", "Review and send the referral request", true),
      assisted(
        "prefill_application",
        "Prefill the application after referral guidance",
      ),
      human("submit_application", "Review and submit the application", true),
    ],
  },
  direct_email_application: {
    route: "direct_email_application",
    label: "Apply by direct email",
    channel: "Application email",
    steps: [
      assisted(
        "verify_instructions",
        "Verify the employer's email instructions",
      ),
      automatic(
        "prepare_materials",
        "Prepare the requested application materials",
      ),
      automatic("draft_application_email", "Draft the application email"),
      human(
        "send_application_email",
        "Review attachments and send the email",
        true,
      ),
    ],
  },
  apply_then_contact: {
    route: "apply_then_contact",
    label: "Apply, then contact the team",
    channel: "Open role",
    steps: [
      automatic(
        "prepare_application",
        "Score the role and prepare tailored materials",
      ),
      assisted("prefill_application", "Prefill the application form"),
      human("submit_application", "Review and submit the application", true),
      assisted(
        "research_decision_maker",
        "Find the relevant engineering leader",
      ),
      automatic("draft_follow_up", "Draft a role-specific follow-up"),
      human("send_follow_up", "Review and send the follow-up", true),
    ],
  },
  speculative_outreach: {
    route: "speculative_outreach",
    label: "Signal-led speculative outreach",
    channel: "Founder or engineering leader",
    steps: [
      assisted("verify_signal", "Verify the funding, growth, or hiring signal"),
      assisted("research_decision_maker", "Find the relevant decision maker"),
      automatic("match_proof", "Select the strongest relevant proof of work"),
      automatic("draft_outreach", "Draft a signal-specific outreach message"),
      human("send_outreach", "Review and send the outreach", true),
      automatic("schedule_follow_up", "Create a follow-up task"),
    ],
  },
  submit_talent_profile: {
    route: "submit_talent_profile",
    label: "Submit to the VC talent network",
    channel: "Investor talent network",
    steps: [
      automatic(
        "prepare_profile",
        "Prepare the reusable talent profile and CV",
      ),
      assisted("prefill_talent_profile", "Prefill the network profile"),
      human("submit_talent_profile", "Review and submit the profile", true),
      automatic(
        "monitor_portfolio",
        "Monitor portfolio companies as separate opportunities",
      ),
    ],
  },
  contribute_then_connect: {
    route: "contribute_then_connect",
    label: "Contribute, then build the relationship",
    channel: "Open-source project",
    steps: [
      assisted("find_contribution", "Find a relevant, bounded contribution"),
      human("build_contribution", "Implement and test the contribution"),
      human("submit_contribution", "Review and submit the pull request", true),
      automatic(
        "draft_contributor_note",
        "Draft a concise contributor follow-up",
      ),
      human("send_contributor_note", "Review and send the follow-up", true),
    ],
  },
  watch: {
    route: "watch",
    label: "Watch for a real signal",
    channel: "Watchlist",
    steps: [
      automatic(
        "monitor_company",
        "Monitor careers, funding, and engineering signals",
      ),
      human(
        "promote_when_ready",
        "Promote the opportunity when a verified signal appears",
      ),
    ],
  },
  archive_ineligible: {
    route: "archive_ineligible",
    label: "Archive as ineligible",
    channel: "Eligibility gate",
    steps: [
      automatic(
        "record_reason",
        "Record the visa, location, or eligibility reason",
      ),
      human("recheck_if_changed", "Recheck only when eligibility changes"),
    ],
  },
};

export function getOpportunityRoutePlan(
  route: OpportunityRoute,
): OpportunityRoutePlan {
  return OPPORTUNITY_ROUTE_PLANS[route];
}
