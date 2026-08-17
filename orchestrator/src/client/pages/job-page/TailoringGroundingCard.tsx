import type { Job, TailoringValidationIssue } from "@shared/types.js";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type React from "react";
import * as api from "@/client/api";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Badge } from "@/components/ui/badge";

type TailoringGroundingCardProps = {
  job: Job;
};

function issueLabel(issue: TailoringValidationIssue): string {
  switch (issue.code) {
    case "missing_evidence":
      return "Missing evidence";
    case "unknown_evidence":
      return "Unknown evidence";
    case "unsupported_metric":
      return "Unsupported number";
    case "unsupported_skill":
      return "Unsupported skill";
    case "low_evidence_overlap":
      return "Review paraphrase";
  }
}

export const TailoringGroundingCard: React.FC<TailoringGroundingCardProps> = ({
  job,
}) => {
  const query = useQuery({
    queryKey: queryKeys.jobs.tailoringAudit(job.id),
    queryFn: () => api.getLatestTailoringAudit(job.id),
  });
  useQueryErrorToast(
    query.error,
    "Failed to load the latest tailoring evidence report.",
  );

  if (query.isLoading) return null;
  const response = query.data;
  const run = response?.run ?? null;
  const hasTailoredContent = Boolean(
    job.tailoredHeadline || job.tailoredSummary || job.tailoredSkills,
  );
  if (!run && !hasTailoredContent) return null;

  const claimsById = new Map(run?.claims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(
    run?.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const issues = run?.validation?.issues ?? [];
  const isFailed = run?.status === "failed";
  const isStale = Boolean(run && !response?.isCurrent && !isFailed);
  const passed = Boolean(
    run?.validation?.status === "passed" && response?.isCurrent,
  );

  return (
    <article className="rounded-xl border border-border/60 bg-card/75 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Tailoring evidence</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Checks generated claims against the resume evidence supplied to the
            model.
          </p>
        </div>
        {passed ? (
          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Grounded
          </Badge>
        ) : isFailed ? (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" />
            Generation failed
          </Badge>
        ) : (
          <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {isStale ? "Stale report" : "Review required"}
          </Badge>
        )}
      </div>

      {!run ? (
        <p className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">
          This tailoring predates evidence validation. Regenerate it to create a
          grounding report.
        </p>
      ) : isFailed ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {run.errorMessage || "The latest tailoring run failed."}
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                Evidence
              </div>
              <div className="mt-1 text-sm font-semibold">
                {run.evidence.length}
              </div>
            </div>
            <div className="rounded-md border border-border/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                Claims
              </div>
              <div className="mt-1 text-sm font-semibold">
                {run.validation?.totalClaims ?? run.claims.length}
              </div>
            </div>
            <div className="rounded-md border border-border/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                Grounded
              </div>
              <div className="mt-1 text-sm font-semibold">
                {run.validation?.groundedClaims ?? 0}
              </div>
            </div>
            <div className="rounded-md border border-border/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                Review items
              </div>
              <div className="mt-1 text-sm font-semibold">{issues.length}</div>
            </div>
          </div>

          {isStale && (
            <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100">
              The stored tailoring changed after this report. Regenerate it to
              validate the current text.
            </p>
          )}

          {issues.length > 0 && (
            <ul className="mt-3 space-y-2">
              {issues.map((issue, index) => {
                const claim = claimsById.get(issue.claimId);
                const labels = issue.evidenceIds
                  .map((id) => evidenceById.get(id)?.label ?? id)
                  .join(", ");
                return (
                  <li
                    key={`${issue.claimId}-${issue.code}-${index}`}
                    className="rounded-md border border-border/50 bg-background/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{issueLabel(issue)}</Badge>
                      {claim?.text && (
                        <span className="text-sm font-medium">
                          {claim.text}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {issue.message}
                    </p>
                    {labels && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Cited evidence: {labels}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {run && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {run.provider || "Unknown provider"} · {run.model || "Unknown model"}
          {" · "}
          {run.durationMs} ms · prompt {run.promptVersion}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Warnings never submit or reject an application. Review every flagged
        claim before using the resume.
      </p>
    </article>
  );
};
