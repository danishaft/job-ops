import {
  getOpportunityRoutePlan,
  resolveOpportunityRoute,
} from "@shared/opportunity-routing.js";
import type {
  Job,
  OpportunityEligibility,
  OpportunitySignals,
  OpportunityWarmConnectionStatus,
} from "@shared/types.js";
import {
  Bot,
  Check,
  ExternalLink,
  PanelsTopLeft,
  Save,
  UserRound,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import * as api from "@/client/api";
import { showErrorToast } from "@/client/lib/error-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type OpportunityPlanCardProps = {
  job: Job;
  onUpdated: () => void | Promise<void>;
};

const signalOptions: Array<{
  key: Exclude<
    keyof OpportunitySignals,
    "eligibility" | "hasWarmConnection" | "warmConnectionStatus"
  >;
  label: string;
}> = [
  { key: "hasOpenRole", label: "Open role" },
  { key: "hasDirectApplicationEmail", label: "Direct application email" },
  { key: "hasStrongHiringSignal", label: "Strong hiring signal" },
  { key: "isTalentNetwork", label: "VC talent network" },
  { key: "isOpenSourceCompany", label: "Open-source company" },
];

export const OpportunityPlanCard: React.FC<OpportunityPlanCardProps> = ({
  job,
  onUpdated,
}) => {
  const [signals, setSignals] = React.useState(job.opportunitySignals);
  const [isSaving, setIsSaving] = React.useState(false);
  const [activeBrowserAction, setActiveBrowserAction] = React.useState<
    "inspect" | "prefill" | null
  >(null);

  React.useEffect(() => setSignals(job.opportunitySignals), [job]);
  const route = resolveOpportunityRoute(signals);
  const plan = getOpportunityRoutePlan(route);
  const isDirty =
    JSON.stringify(signals) !== JSON.stringify(job.opportunitySignals);
  const canPrefill =
    signals.hasOpenRole ||
    signals.isTalentNetwork ||
    Boolean(job.applicationLink);

  const saveSignals = async () => {
    setIsSaving(true);
    try {
      await api.updateJob(job.id, { opportunitySignals: signals });
      await onUpdated();
      toast.success("Opportunity route updated");
    } catch (error) {
      showErrorToast(error, "Failed to update opportunity route");
    } finally {
      setIsSaving(false);
    }
  };

  const inspect = async () => {
    setActiveBrowserAction("inspect");
    try {
      const result = await api.inspectWithPeruz({
        url: job.applicationLink || job.jobUrl,
        kind: signals.hasOpenRole ? "role" : "company",
      });
      await api.createJobNote(job.id, {
        title: `Peruz inspection — ${new Date(result.inspectedAt).toLocaleDateString()}`,
        content: `Source: ${result.url}\n\n${result.pageText}`,
      });
      await onUpdated();
      toast.success("Inspection saved to Notes");
    } catch (error) {
      showErrorToast(error, "Peruz inspection failed");
    } finally {
      setActiveBrowserAction(null);
    }
  };

  const prefill = async () => {
    setActiveBrowserAction("prefill");
    try {
      const result = await api.prefillWithPeruz(job.id);
      const filled = result.fields.filter(
        (field) => field.status === "filled",
      ).length;
      toast.success("Application opened for your review", {
        description: `${filled} profile fields filled. Peruz did not submit the form.`,
      });
    } catch (error) {
      showErrorToast(error, "Peruz prefill failed");
    } finally {
      setActiveBrowserAction(null);
    }
  };

  return (
    <article className="rounded-xl border border-primary/25 bg-card/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Opportunity playbook</h2>
            <Badge variant="secondary">{plan.channel}</Badge>
          </div>
          <p className="mt-1 text-lg font-semibold">{plan.label}</p>
        </div>
        <Button
          size="sm"
          variant={isDirty ? "default" : "outline"}
          disabled={!isDirty || isSaving}
          onClick={() => void saveSignals()}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {isSaving ? "Saving" : "Save route"}
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {signalOptions.map((option) => (
          <label
            key={option.key}
            htmlFor={`opportunity-${option.key}`}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
          >
            <Checkbox
              id={`opportunity-${option.key}`}
              checked={signals[option.key]}
              onCheckedChange={(checked) =>
                setSignals((previous) => ({
                  ...previous,
                  [option.key]: checked === true,
                }))
              }
            />
            {option.label}
          </label>
        ))}
      </div>

      <label
        htmlFor="opportunity-warm-connection"
        className="mt-3 block text-xs text-muted-foreground"
      >
        Warm connection
        <select
          id="opportunity-warm-connection"
          value={signals.warmConnectionStatus}
          onChange={(event) => {
            const status = event.target
              .value as OpportunityWarmConnectionStatus;
            setSignals((previous) => ({
              ...previous,
              warmConnectionStatus: status,
              hasWarmConnection: status === "warm",
            }));
          }}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="unknown">Unknown — check after shortlisting</option>
          <option value="none">No warm connection</option>
          <option value="warm">Warm connection exists</option>
        </select>
      </label>

      <label
        htmlFor="opportunity-eligibility"
        className="mt-3 block text-xs text-muted-foreground"
      >
        Eligibility
        <select
          id="opportunity-eligibility"
          value={signals.eligibility}
          onChange={(event) =>
            setSignals((previous) => ({
              ...previous,
              eligibility: event.target.value as OpportunityEligibility,
            }))
          }
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="unknown">Unknown — verify</option>
          <option value="eligible">Eligible</option>
          <option value="ineligible">Ineligible — archive route</option>
        </select>
      </label>

      <ol className="mt-4 space-y-2">
        {plan.steps.map((step, index) => (
          <li
            key={step.id}
            className="flex items-start gap-3 rounded-md border border-border/50 bg-background/20 px-3 py-2 text-sm"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{step.label}</span>
            {step.execution === "automatic" ? (
              <Bot
                className="h-4 w-4 text-muted-foreground"
                aria-label="Automatic"
              />
            ) : step.execution === "browser_assisted" ? (
              <PanelsTopLeft
                className="h-4 w-4 text-blue-400"
                aria-label="Browser assisted"
              />
            ) : step.externalAction ? (
              <UserRound
                className="h-4 w-4 text-amber-400"
                aria-label="Human approval"
              />
            ) : (
              <Check
                className="h-4 w-4 text-muted-foreground"
                aria-label="Human"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={activeBrowserAction !== null}
          onClick={() => void inspect()}
        >
          <PanelsTopLeft className="mr-1.5 h-3.5 w-3.5" />
          {activeBrowserAction === "inspect"
            ? "Inspecting"
            : "Inspect with Peruz"}
        </Button>
        {canPrefill && (
          <Button
            size="sm"
            variant="outline"
            disabled={activeBrowserAction !== null}
            onClick={() => void prefill()}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {activeBrowserAction === "prefill"
              ? "Prefilling"
              : "Prefill, then hand off"}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Peruz may inspect and fill fields. You always review and perform every
        send or submission.
      </p>
    </article>
  );
};
