export const TAILORING_AUDIT_RUN_STATUSES = ["completed", "failed"] as const;
export type TailoringAuditRunStatus =
  (typeof TAILORING_AUDIT_RUN_STATUSES)[number];

export type TailoringEvidenceKind =
  | "profile_summary"
  | "experience"
  | "project"
  | "skill";

export interface TailoringEvidenceItem {
  id: string;
  kind: TailoringEvidenceKind;
  label: string;
  text: string;
}

export type TailoringClaimTarget = "headline" | "summary" | "skill";

export interface TailoringClaim {
  id: string;
  target: TailoringClaimTarget;
  text: string;
  evidenceIds: string[];
}

export type TailoringValidationIssueCode =
  | "missing_evidence"
  | "unknown_evidence"
  | "unsupported_metric"
  | "unsupported_skill"
  | "low_evidence_overlap";

export type TailoringValidationIssueSeverity = "warning" | "error";

export interface TailoringValidationIssue {
  claimId: string;
  code: TailoringValidationIssueCode;
  severity: TailoringValidationIssueSeverity;
  message: string;
  evidenceIds: string[];
}

export type TailoringValidationStatus = "passed" | "review";

export interface TailoringValidationReport {
  status: TailoringValidationStatus;
  validatorVersion: string;
  totalClaims: number;
  groundedClaims: number;
  warningCount: number;
  errorCount: number;
  issues: TailoringValidationIssue[];
  validatedAt: string;
}

export type TailoringAppliedField = "summary" | "headline" | "skills";

export interface TailoringAuditRun {
  id: string;
  jobId: string;
  status: TailoringAuditRunStatus;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  sourceResumeFingerprint: string;
  outputFingerprint: string | null;
  durationMs: number;
  startedAt: number;
  completedAt: number;
  appliedFields: TailoringAppliedField[];
  evidence: TailoringEvidenceItem[];
  claims: TailoringClaim[];
  validation: TailoringValidationReport | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface LatestTailoringAuditResponse {
  run: TailoringAuditRun | null;
  isCurrent: boolean;
}
