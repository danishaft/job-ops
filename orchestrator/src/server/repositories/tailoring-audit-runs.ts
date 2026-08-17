import { randomUUID } from "node:crypto";
import type {
  TailoringAppliedField,
  TailoringAuditRun,
  TailoringClaim,
  TailoringEvidenceItem,
  TailoringValidationReport,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { tailoringAuditRuns } = schema;

type TailoringAuditDraft = Omit<
  TailoringAuditRun,
  "id" | "jobId" | "appliedFields" | "createdAt"
>;

function scopeFilter() {
  return privateDataScopeFilter(tailoringAuditRuns);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRun(
  row: typeof tailoringAuditRuns.$inferSelect,
): TailoringAuditRun {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    sourceResumeFingerprint: row.sourceResumeFingerprint,
    outputFingerprint: row.outputFingerprint,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    appliedFields: parseJson<TailoringAppliedField[]>(row.appliedFields, []),
    evidence: parseJson<TailoringEvidenceItem[]>(row.evidence, []),
    claims: parseJson<TailoringClaim[]>(row.claims, []),
    validation: parseJson<TailoringValidationReport | null>(
      row.validation,
      null,
    ),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

export async function createTailoringAuditRun(input: {
  jobId: string;
  appliedFields: TailoringAppliedField[];
  audit: TailoringAuditDraft;
}): Promise<TailoringAuditRun> {
  const id = randomUUID();
  const scope = getPrivateDataScope();

  await db.insert(tailoringAuditRuns).values({
    id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    jobId: input.jobId,
    status: input.audit.status,
    provider: input.audit.provider,
    model: input.audit.model,
    promptVersion: input.audit.promptVersion,
    sourceResumeFingerprint: input.audit.sourceResumeFingerprint,
    outputFingerprint: input.audit.outputFingerprint,
    durationMs: input.audit.durationMs,
    startedAt: input.audit.startedAt,
    completedAt: input.audit.completedAt,
    appliedFields: JSON.stringify(input.appliedFields),
    evidence: JSON.stringify(input.audit.evidence),
    claims: JSON.stringify(input.audit.claims),
    validation: input.audit.validation
      ? JSON.stringify(input.audit.validation)
      : null,
    errorMessage: input.audit.errorMessage,
    createdAt: new Date(input.audit.completedAt).toISOString(),
  });

  const created = await getTailoringAuditRunById(id);
  if (!created) throw new Error("Failed to load the created tailoring audit");
  return created;
}

export async function getTailoringAuditRunById(
  id: string,
): Promise<TailoringAuditRun | null> {
  const [row] = await db
    .select()
    .from(tailoringAuditRuns)
    .where(and(scopeFilter(), eq(tailoringAuditRuns.id, id)));
  return row ? mapRun(row) : null;
}

export async function getLatestTailoringAuditRunForJob(
  jobId: string,
): Promise<TailoringAuditRun | null> {
  const [row] = await db
    .select()
    .from(tailoringAuditRuns)
    .where(and(scopeFilter(), eq(tailoringAuditRuns.jobId, jobId)))
    .orderBy(desc(tailoringAuditRuns.completedAt))
    .limit(1);
  return row ? mapRun(row) : null;
}
