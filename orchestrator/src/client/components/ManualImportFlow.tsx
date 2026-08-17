import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import {
  DEFAULT_OPPORTUNITY_SIGNALS,
  getOpportunityRoutePlan,
  normalizeOpportunitySignals,
  resolveOpportunityRoute,
} from "@shared/opportunity-routing.js";
import {
  OPPORTUNITY_SOURCES,
  type OpportunitySourceDefinition,
} from "@shared/opportunity-sources.js";
import type {
  ManualJobDraft,
  OpportunityEligibility,
  OpportunitySignals,
  OpportunityWarmConnectionStatus,
} from "@shared/types.js";
import {
  ArrowDown,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  CircleAlert,
  DollarSign,
  ExternalLink,
  FileText,
  GraduationCap,
  Link,
  Link2,
  ListChecks,
  Loader2,
  MapPin,
  PanelsTopLeft,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type ManualImportStep = "paste" | "loading" | "review";
type ManualImportProgressStep = "paste" | "review";

export type ManualImportTrackingSource =
  | "pasted_description"
  | "fetched_url"
  | (string & {});

export interface ManualImportResult {
  jobId: string;
  source: ManualImportTrackingSource;
  sourceHost: string | null;
}

type ManualJobDraftState = {
  source: string;
  sourceJobId: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location: string;
  salary: string;
  deadline: string;
  jobDescription: string;
  jobType: string;
  jobLevel: string;
  jobFunction: string;
  disciplines: string;
  degreeRequired: string;
  starting: string;
  opportunitySignals: OpportunitySignals;
};

type DraftFieldKey = Exclude<keyof ManualJobDraftState, "opportunitySignals">;

type ReviewFieldConfig = {
  id: string;
  key: DraftFieldKey;
  label: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  required?: boolean;
  multiline?: boolean;
};

const emptyDraft: ManualJobDraftState = {
  source: "",
  sourceJobId: "",
  title: "",
  employer: "",
  jobUrl: "",
  applicationLink: "",
  location: "",
  salary: "",
  deadline: "",
  jobDescription: "",
  jobType: "",
  jobLevel: "",
  jobFunction: "",
  disciplines: "",
  degreeRequired: "",
  starting: "",
  opportunitySignals: DEFAULT_OPPORTUNITY_SIGNALS,
};

const STEP_INDEX_BY_ID: Record<ManualImportProgressStep, number> = {
  paste: 0,
  review: 1,
};

const STEP_LABEL_BY_ID: Record<ManualImportProgressStep, string> = {
  paste: "Add JD",
  review: "Review & import",
};

const REQUIRED_REVIEW_FIELDS: ReviewFieldConfig[] = [
  {
    id: "draft-title",
    key: "title",
    label: "Title",
    placeholder: "e.g. Junior Backend Engineer",
    icon: Tag,
    required: true,
  },
  {
    id: "draft-employer",
    key: "employer",
    label: "Employer",
    placeholder: "e.g. Acme Labs",
    icon: Building2,
    required: true,
  },
  {
    id: "draft-jobDescription",
    key: "jobDescription",
    label: "Description",
    placeholder: "Paste the job description...",
    icon: FileText,
    required: true,
    multiline: true,
  },
  {
    id: "draft-jobUrl",
    key: "jobUrl",
    label: "Job URL",
    placeholder: "https://...",
    icon: Link2,
    required: true,
  },
];

const OTHER_REVIEW_FIELDS: ReviewFieldConfig[] = [
  {
    id: "draft-source",
    key: "source",
    label: "Source ID",
    placeholder: "e.g. a16z:portfolio-jobs",
    icon: Link2,
  },
  {
    id: "draft-location",
    key: "location",
    label: "Location",
    placeholder: "e.g. London, UK",
    icon: MapPin,
  },
  {
    id: "draft-salary",
    key: "salary",
    label: "Salary",
    placeholder: "e.g. GBP 45k-55k",
    icon: DollarSign,
  },
  {
    id: "draft-jobType",
    key: "jobType",
    label: "Job type",
    placeholder: "e.g. Full-time",
    icon: Briefcase,
  },
  {
    id: "draft-jobLevel",
    key: "jobLevel",
    label: "Job level",
    placeholder: "e.g. Graduate",
    icon: ListChecks,
  },
  {
    id: "draft-jobFunction",
    key: "jobFunction",
    label: "Job function",
    placeholder: "e.g. Software Engineering",
    icon: Users,
  },
  {
    id: "draft-disciplines",
    key: "disciplines",
    label: "Disciplines",
    placeholder: "e.g. Computer Science",
    icon: ListChecks,
  },
  {
    id: "draft-deadline",
    key: "deadline",
    label: "Deadline",
    placeholder: "e.g. 30 Sep 2025",
    icon: Calendar,
  },
  {
    id: "draft-degreeRequired",
    key: "degreeRequired",
    label: "Degree required",
    placeholder: "e.g. BSc or MSc",
    icon: GraduationCap,
  },
  {
    id: "draft-starting",
    key: "starting",
    label: "Starting",
    placeholder: "e.g. September 2026",
    icon: Calendar,
  },
  {
    id: "draft-applicationLink",
    key: "applicationLink",
    label: "Application URL",
    placeholder: "https://...",
    icon: Link,
  },
];

const BLOCKED_AUTOFETCH_HOSTS: Array<{
  label: string;
  match: (hostname: string) => boolean;
}> = [
  {
    label: "LinkedIn",
    match: (hostname) =>
      hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"),
  },
  {
    label: "Indeed",
    match: (hostname) =>
      hostname === "indeed.com" || hostname.includes("indeed."),
  },
];

const normalizeDraft = (
  draft?: ManualJobDraft | null,
  jd?: string,
): ManualJobDraftState => ({
  ...emptyDraft,
  source: draft?.source ?? "",
  sourceJobId: draft?.sourceJobId ?? "",
  title: draft?.title ?? "",
  employer: draft?.employer ?? "",
  jobUrl: draft?.jobUrl ?? "",
  applicationLink: draft?.applicationLink ?? "",
  location: draft?.location ?? "",
  salary: draft?.salary ?? "",
  deadline: draft?.deadline ?? "",
  jobDescription: jd ?? draft?.jobDescription ?? "",
  jobType: draft?.jobType ?? "",
  jobLevel: draft?.jobLevel ?? "",
  jobFunction: draft?.jobFunction ?? "",
  disciplines: draft?.disciplines ?? "",
  degreeRequired: draft?.degreeRequired ?? "",
  starting: draft?.starting ?? "",
  opportunitySignals: normalizeOpportunitySignals(draft?.opportunitySignals),
});

const toPayload = (draft: ManualJobDraftState): ManualJobDraft => {
  const clean = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    title: clean(draft.title),
    source: clean(draft.source),
    sourceJobId: clean(draft.sourceJobId),
    employer: clean(draft.employer),
    jobUrl: clean(draft.jobUrl),
    applicationLink: clean(draft.applicationLink),
    location: clean(draft.location),
    salary: clean(draft.salary),
    deadline: clean(draft.deadline),
    jobDescription: clean(draft.jobDescription),
    jobType: clean(draft.jobType),
    jobLevel: clean(draft.jobLevel),
    jobFunction: clean(draft.jobFunction),
    disciplines: clean(draft.disciplines),
    degreeRequired: clean(draft.degreeRequired),
    starting: clean(draft.starting),
    opportunitySignals: draft.opportunitySignals,
  };
};

interface ManualImportFlowProps {
  active: boolean;
  onImported: (result: ManualImportResult) => void | Promise<void>;
  onClose: () => void;
  showReviewIntro?: boolean;
  initialDraft?: ManualJobDraft | null;
  initialSource?: ManualImportTrackingSource | null;
  initialSourceHost?: string | null;
}

function getSourceHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).hostname || null;
  } catch {
    return null;
  }
}

function getBlockedAutofetchLabel(value: string): string | null {
  const host = getSourceHost(value)?.toLowerCase();
  if (!host) return null;
  const blocked = BLOCKED_AUTOFETCH_HOSTS.find((entry) => entry.match(host));
  return blocked?.label ?? null;
}

export const ManualImportFlow: React.FC<ManualImportFlowProps> = ({
  active,
  onImported,
  onClose,
  showReviewIntro = true,
  initialDraft = null,
  initialSource = null,
  initialSourceHost = null,
}) => {
  const [step, setStep] = useState<ManualImportStep>("paste");
  const [rawDescription, setRawDescription] = useState("");
  const [fetchUrl, setFetchUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isPeruzFetching, setIsPeruzFetching] = useState(false);
  const [draft, setDraft] = useState<ManualJobDraftState>(emptyDraft);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSource, setImportSource] =
    useState<ManualImportTrackingSource>("pasted_description");
  const [importSourceHost, setImportSourceHost] = useState<string | null>(null);
  const [fetchedSourceUrl, setFetchedSourceUrl] = useState<string | null>(null);
  const { autoTailorOnManualImport } = useSettings();
  const [tailorAfterImport, setTailorAfterImport] = useState<boolean>(
    autoTailorOnManualImport,
  );

  useEffect(() => {
    if (active) {
      if (!initialDraft) return;
      const normalized = normalizeDraft(initialDraft);
      setStep("review");
      setRawDescription(normalized.jobDescription);
      setFetchUrl(normalized.jobUrl);
      setIsFetching(false);
      setIsPeruzFetching(false);
      setDraft(normalized);
      setWarning(null);
      setError(null);
      setFetchNotice(null);
      setIsImporting(false);
      setImportSource(
        initialSource ||
          (normalized.source as ManualImportTrackingSource) ||
          "pasted_description",
      );
      setImportSourceHost(
        initialSourceHost ??
          getSourceHost(normalized.jobUrl) ??
          getSourceHost(normalized.applicationLink),
      );
      setFetchedSourceUrl(normalized.jobUrl || null);
      setTailorAfterImport(autoTailorOnManualImport);
      return;
    }
    setStep("paste");
    setRawDescription("");
    setFetchUrl("");
    setIsFetching(false);
    setIsPeruzFetching(false);
    setDraft(emptyDraft);
    setWarning(null);
    setError(null);
    setFetchNotice(null);
    setIsImporting(false);
    setImportSource("pasted_description");
    setImportSourceHost(null);
    setFetchedSourceUrl(null);
    setTailorAfterImport(autoTailorOnManualImport);
  }, [
    active,
    initialDraft,
    initialSource,
    initialSourceHost,
    autoTailorOnManualImport,
  ]);

  const progressStep: ManualImportProgressStep =
    step === "review" ? "review" : "paste";
  const stepIndex = STEP_INDEX_BY_ID[progressStep];
  const stepLabel = STEP_LABEL_BY_ID[progressStep];

  const canAnalyze =
    rawDescription.trim().length > 0 &&
    step !== "loading" &&
    !isFetching &&
    !isPeruzFetching;
  const canFetch =
    fetchUrl.trim().length > 0 &&
    !isFetching &&
    !isPeruzFetching &&
    step === "paste";
  const route = resolveOpportunityRoute(draft.opportunitySignals);
  const routePlan = getOpportunityRoutePlan(route);
  const canImport = useMemo(() => {
    if (step !== "review") return false;
    return (
      draft.title.trim().length > 0 &&
      draft.employer.trim().length > 0 &&
      draft.jobUrl.trim().length > 0 &&
      draft.jobDescription.trim().length > 0
    );
  }, [draft, step]);

  const handleFetch = async () => {
    const trimmedUrl = fetchUrl.trim();
    if (!trimmedUrl) return;
    const blockedLabel = getBlockedAutofetchLabel(trimmedUrl);
    if (blockedLabel) {
      setError(
        `Auto-fetch is not supported for ${blockedLabel} links. Paste the job description manually.`,
      );
      setWarning(null);
      setFetchNotice(null);
      return;
    }

    try {
      setError(null);
      setWarning(null);
      setFetchNotice(null);
      setIsFetching(true);

      const fetchResponse = await api.fetchJobFromUrl({ url: trimmedUrl });
      const fetchedContent = fetchResponse.content;
      const fetchedUrl = fetchResponse.url;

      setRawDescription(fetchedContent);
      setFetchedSourceUrl(fetchedUrl);
      setImportSource("fetched_url");
      setImportSourceHost(getSourceHost(fetchedUrl));
      setFetchUrl(fetchedUrl);
      setFetchNotice("Fetched the page text. Review it below, then analyze.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't fetch this URL automatically. Paste the job description manually.";
      setError(message);
      setStep("paste");
    } finally {
      setIsFetching(false);
    }
  };

  const handlePeruzFetch = async () => {
    const trimmedUrl = fetchUrl.trim();
    if (!trimmedUrl) return;
    try {
      setError(null);
      setWarning(null);
      setFetchNotice(null);
      setIsPeruzFetching(true);
      const result = await api.inspectWithPeruz({
        url: trimmedUrl,
        kind: "role",
      });
      setRawDescription(result.pageText);
      setFetchedSourceUrl(result.url);
      setImportSource("peruz_browser");
      setImportSourceHost(getSourceHost(result.url));
      setFetchUrl(result.url);
      setFetchNotice(
        "Peruz copied the rendered page text. Review it below, then analyze.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Peruz could not inspect this page.",
      );
    } finally {
      setIsPeruzFetching(false);
    }
  };

  const handleAnalyze = async () => {
    if (!rawDescription.trim()) {
      setError("Paste a job description to continue.");
      return;
    }

    try {
      setError(null);
      setWarning(null);
      setStep("loading");
      const response = await api.inferManualJob({
        jobDescription: rawDescription,
      });
      const normalized = normalizeDraft(response.job, rawDescription.trim());
      if (fetchedSourceUrl && !normalized.jobUrl) {
        normalized.jobUrl = fetchedSourceUrl;
      }
      setDraft(normalized);
      setWarning(response.warning ?? null);
      setImportSource(fetchedSourceUrl ? "fetched_url" : "pasted_description");
      setImportSourceHost(
        getSourceHost(fetchedSourceUrl ?? "") ??
          getSourceHost(normalized.jobUrl) ??
          getSourceHost(normalized.applicationLink),
      );
      setStep("review");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to analyze job description";
      setError(message);
      setStep("paste");
    }
  };

  const handleAddWithoutRole = () => {
    const jobUrl = fetchUrl.trim();
    setDraft({
      ...emptyDraft,
      title: "Potential engineering opportunity",
      jobUrl,
      jobDescription:
        "Company-level opportunity captured for targeted research and follow-up.",
      opportunitySignals: normalizeOpportunitySignals({ hasOpenRole: false }),
    });
    setImportSource("manual");
    setImportSourceHost(getSourceHost(jobUrl));
    setTailorAfterImport(false);
    setError(null);
    setWarning(null);
    setStep("review");
  };

  const handleSourcePreset = (source: OpportunitySourceDefinition) => {
    setDraft({
      ...emptyDraft,
      source: source.sourceId,
      title: `${source.label} profile`,
      employer: source.label,
      jobUrl: source.url,
      applicationLink: source.url,
      jobDescription: `Reusable candidate profile for ${source.label}. Monitor portfolio companies as separate opportunities.`,
      opportunitySignals: normalizeOpportunitySignals(source.defaultSignals),
    });
    setImportSource(source.sourceId);
    setImportSourceHost(getSourceHost(source.url));
    setTailorAfterImport(false);
    setError(null);
    setWarning(null);
    setStep("review");
  };

  const handleImport = async () => {
    if (!canImport) return;

    try {
      setIsImporting(true);
      const payload = toPayload(draft);
      const skipTailoring = !tailorAfterImport;
      const created = await api.importManualJob({
        job: payload,
        skipTailoring,
      });
      toast.success("Job imported", {
        description: skipTailoring
          ? "Saved to Discovered without tailoring. You can tailor it anytime from the job detail view."
          : "The job was tailored and moved to the ready column.",
      });
      await onImported({
        jobId: created.id,
        source: importSource,
        sourceHost:
          importSourceHost ??
          getSourceHost(payload.jobUrl ?? "") ??
          getSourceHost(payload.applicationLink ?? ""),
      });
      onClose();
    } catch (err) {
      showErrorToast(err, "Failed to import job");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {stepIndex + 1} of 2</span>
            <span>{stepLabel}</span>
          </div>
          <div className="h-1 rounded-full bg-muted/40">
            <div
              className="h-1 rounded-full bg-primary/60 transition-all"
              style={{ width: `${((stepIndex + 1) / 2) * 100}%` }}
            />
          </div>
        </div>
        <Separator />
      </div>

      <div className="mt-4 flex-1 overflow-y-auto pr-1">
        {step === "paste" && (
          <div className="space-y-4">
            <details className="rounded-lg border border-border/70 bg-card/35 p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                High-signal startup sources ({OPPORTUNITY_SOURCES.length})
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Portfolio boards find open roles. Talent networks create one
                reusable profile opportunity. They are separate channels, not
                duplicates.
              </p>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                {OPPORTUNITY_SOURCES.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {source.label}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {source.channel.replaceAll("_", " ")}
                        {source.browserRequired ? " · Peruz" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                      >
                        <a href={source.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="sr-only">Open {source.label}</span>
                        </a>
                      </Button>
                      {source.trackAsOpportunity && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleSourcePreset(source)}
                        >
                          Track profile
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="fetch-url"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Job URL
                </label>
                <span className="text-[11px] text-muted-foreground">
                  Optional helper
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  id="fetch-url"
                  value={fetchUrl}
                  onChange={(event) => setFetchUrl(event.target.value)}
                  placeholder="https://example.com/job-posting"
                  className="flex-1"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canFetch) {
                      event.preventDefault();
                      void handleFetch();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canFetch}
                  className="gap-2 shrink-0"
                  onClick={() => void handleFetch()}
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link className="h-4 w-4" />
                  )}
                  {isFetching ? "Fetching..." : "Fetch"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canFetch}
                  className="gap-2 shrink-0"
                  onClick={() => void handlePeruzFetch()}
                >
                  {isPeruzFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PanelsTopLeft className="h-4 w-4" />
                  )}
                  Peruz
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetch tries to copy the job text into the description field. If
                the site blocks simple fetching, paste the description manually.
              </p>
            </div>

            <div className="flex items-center justify-center text-muted-foreground">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
                <span className="h-px w-10 bg-border" />
                <ArrowDown className="h-3.5 w-3.5" />
                <span className="h-px w-10 bg-border" />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="raw-description"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Job description
              </label>
              <Textarea
                id="raw-description"
                value={rawDescription}
                onChange={(event) => {
                  setRawDescription(event.target.value);
                  setFetchNotice(null);
                  if (!event.target.value.trim()) {
                    setFetchedSourceUrl(null);
                    setImportSource("pasted_description");
                    setImportSourceHost(null);
                  }
                }}
                placeholder="Paste the full job description here, or fetch it from a URL above..."
                className="min-h-[200px] font-mono text-sm leading-relaxed"
              />
            </div>

            {fetchNotice && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {fetchNotice}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button
              onClick={() => void handleAnalyze()}
              disabled={!canAnalyze}
              className="w-full h-10 gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Analyze JD
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleAddWithoutRole}
              className="w-full h-10 gap-2"
            >
              <Building2 className="h-4 w-4" />
              Add company, signal, network, or OSS target
            </Button>
          </div>
        )}

        {step === "loading" && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm font-semibold">
              Analyzing job description
            </div>
            <p className="text-xs text-muted-foreground max-w-xs">
              Extracting title, company, location, and other details.
            </p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-5 pb-4">
            {warning && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {warning}
              </div>
            )}

            {showReviewIntro && (
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold tracking-tight">
                  Review job details
                </h3>
                <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                  AI extracted these from the job description. Review anything
                  missing or odd before importing.
                </p>
              </div>
            )}

            <ReviewSection
              icon={ListChecks}
              title="Opportunity route"
              description="Set only verified signals. JobOps chooses one route and keeps every external action for your approval."
            >
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <div className="text-sm font-semibold">{routePlan.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Channel: {routePlan.channel}
                </div>
                <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {routePlan.steps.map((routeStep, index) => (
                    <li key={routeStep.id}>
                      {index + 1}. {routeStep.label}
                      {routeStep.externalAction ? " — you submit/send" : ""}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <OpportunitySignalToggle
                  id="signal-open-role"
                  label="Open role exists"
                  checked={draft.opportunitySignals.hasOpenRole}
                  onChange={(checked) =>
                    setOpportunitySignal(setDraft, "hasOpenRole", checked)
                  }
                />
                <OpportunitySignalToggle
                  id="signal-direct-email"
                  label="Direct application email"
                  checked={draft.opportunitySignals.hasDirectApplicationEmail}
                  onChange={(checked) =>
                    setOpportunitySignal(
                      setDraft,
                      "hasDirectApplicationEmail",
                      checked,
                    )
                  }
                />
                <OpportunitySignalToggle
                  id="signal-hiring"
                  label="Strong hiring signal"
                  checked={draft.opportunitySignals.hasStrongHiringSignal}
                  onChange={(checked) =>
                    setOpportunitySignal(
                      setDraft,
                      "hasStrongHiringSignal",
                      checked,
                    )
                  }
                />
                <OpportunitySignalToggle
                  id="signal-talent-network"
                  label="VC talent network"
                  checked={draft.opportunitySignals.isTalentNetwork}
                  onChange={(checked) =>
                    setOpportunitySignal(setDraft, "isTalentNetwork", checked)
                  }
                />
                <OpportunitySignalToggle
                  id="signal-open-source"
                  label="Open-source company"
                  checked={draft.opportunitySignals.isOpenSourceCompany}
                  onChange={(checked) =>
                    setOpportunitySignal(
                      setDraft,
                      "isOpenSourceCompany",
                      checked,
                    )
                  }
                />
              </div>

              <label
                htmlFor="signal-warm-connection"
                className="mt-3 block text-xs font-medium text-muted-foreground"
              >
                Warm connection
              </label>
              <select
                id="signal-warm-connection"
                value={draft.opportunitySignals.warmConnectionStatus}
                onChange={(event) =>
                  setWarmConnectionStatus(
                    setDraft,
                    event.target.value as OpportunityWarmConnectionStatus,
                  )
                }
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="unknown">
                  Unknown — check after shortlisting
                </option>
                <option value="none">No warm connection</option>
                <option value="warm">Warm connection exists</option>
              </select>

              <label
                htmlFor="signal-eligibility"
                className="mt-3 block text-xs font-medium text-muted-foreground"
              >
                Visa, location, and work eligibility
              </label>
              <select
                id="signal-eligibility"
                value={draft.opportunitySignals.eligibility}
                onChange={(event) =>
                  setOpportunityEligibility(
                    setDraft,
                    event.target.value as OpportunityEligibility,
                  )
                }
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="unknown">
                  Unknown — verify before applying
                </option>
                <option value="eligible">Eligible</option>
                <option value="ineligible">Ineligible — archive</option>
              </select>
            </ReviewSection>

            <ReviewSection
              icon={CheckCircle2}
              title="Required"
              description="Title, employer, job URL, and description are needed to import."
            >
              <div className="divide-y divide-border/70">
                {REQUIRED_REVIEW_FIELDS.map((field) => (
                  <ReviewField
                    key={field.id}
                    field={field}
                    value={draft[field.key]}
                    onChange={(value) =>
                      setDraft((prev) => ({ ...prev, [field.key]: value }))
                    }
                  />
                ))}
              </div>
            </ReviewSection>

            <ReviewSection
              icon={CircleAlert}
              title="Other details"
              description="Useful if available; blank fields can be added later."
            >
              <div className="grid gap-x-4 sm:grid-cols-2">
                {OTHER_REVIEW_FIELDS.map((field) => (
                  <ReviewField
                    key={field.id}
                    field={field}
                    value={draft[field.key]}
                    onChange={(value) =>
                      setDraft((prev) => ({ ...prev, [field.key]: value }))
                    }
                    compact
                  />
                ))}
              </div>
            </ReviewSection>

            <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-3">
              <Checkbox
                id="tailor-after-import"
                checked={tailorAfterImport}
                onCheckedChange={(checked) => {
                  setTailorAfterImport(checked === true);
                }}
                disabled={isImporting}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="tailor-after-import"
                  className="cursor-pointer text-sm font-medium leading-none"
                >
                  Tailor automatically after import
                </label>
                <p className="text-xs text-muted-foreground">
                  Off saves LLM tokens — the job lands in Discovered and you can
                  tailor it later from the job detail view. Default comes from
                  Settings → Display.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 -mx-1 flex gap-3 border-t border-border/70 bg-background/95 px-1 py-4 backdrop-blur">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("paste")}
                className="h-11 flex-1 gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Edit JD
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={!canImport || isImporting}
                className="h-11 flex-1 gap-2"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isImporting
                  ? "Importing..."
                  : tailorAfterImport
                    ? "Import & tailor"
                    : "Import without tailoring"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ReviewSection: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, description, children }) => (
  <section className="rounded-xl border border-border/80 bg-card/45 p-3 shadow-sm">
    <div className="mb-3 flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
    {children}
  </section>
);

function setOpportunitySignal(
  setDraft: React.Dispatch<React.SetStateAction<ManualJobDraftState>>,
  key: Exclude<
    keyof OpportunitySignals,
    "eligibility" | "hasWarmConnection" | "warmConnectionStatus"
  >,
  value: boolean,
) {
  setDraft((previous) => ({
    ...previous,
    opportunitySignals: { ...previous.opportunitySignals, [key]: value },
  }));
}

function setWarmConnectionStatus(
  setDraft: React.Dispatch<React.SetStateAction<ManualJobDraftState>>,
  status: OpportunityWarmConnectionStatus,
) {
  setDraft((previous) => ({
    ...previous,
    opportunitySignals: {
      ...previous.opportunitySignals,
      warmConnectionStatus: status,
      hasWarmConnection: status === "warm",
    },
  }));
}

function setOpportunityEligibility(
  setDraft: React.Dispatch<React.SetStateAction<ManualJobDraftState>>,
  eligibility: OpportunityEligibility,
) {
  setDraft((previous) => ({
    ...previous,
    opportunitySignals: { ...previous.opportunitySignals, eligibility },
  }));
}

const OpportunitySignalToggle: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, checked, onChange }) => (
  <label
    htmlFor={id}
    className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
  >
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
    />
    {label}
  </label>
);

const ReviewField: React.FC<{
  field: ReviewFieldConfig;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}> = ({ field, value, onChange, compact = false }) => {
  const hasValue = value.trim().length > 0;
  const needsReview = Boolean(field.required) && !hasValue;
  const Icon = field.icon;

  return (
    <div
      className={
        compact ? "border-border/60 border-b py-3" : "py-3 first:pt-0 last:pb-0"
      }
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={field.id}
              className="text-xs font-medium text-muted-foreground"
            >
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <ReviewStatusBadge hasValue={hasValue} needsReview={needsReview} />
          </div>
          {field.multiline ? (
            <Textarea
              id={field.id}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={field.placeholder}
              className="min-h-[150px] resize-y border-border/70 bg-background/60 font-mono text-sm leading-relaxed"
            />
          ) : (
            <Input
              id={field.id}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={field.placeholder}
              className="h-9 border-border/70 bg-background/60 text-sm"
            />
          )}
        </div>
      </div>
    </div>
  );
};

const ReviewStatusBadge: React.FC<{
  hasValue: boolean;
  needsReview: boolean;
}> = ({ hasValue, needsReview }) => {
  if (needsReview) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
        <CircleAlert className="h-3 w-3" />
        Review
      </span>
    );
  }

  if (hasValue) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Looks good
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      Add
    </span>
  );
};
