/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { createHash } from "node:crypto";
import { logger } from "@infra/logger";
import type {
  ResumeProfile,
  TailoringAuditRun,
  TailoringClaim,
  TailoringEvidenceItem,
  TailoringValidationReport,
} from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import {
  createResumeEvidenceFingerprint,
  createTailoredContentFingerprint,
  createTailoringClaims,
  extractResumeEvidence,
  type TailoringGroundingReferences,
  validateTailoringClaims,
} from "./tailoring-grounding";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
  audit: TailoringAuditDraft;
}

export type TailoringAuditDraft = Omit<
  TailoringAuditRun,
  "id" | "jobId" | "appliedFields" | "createdAt"
>;

interface GroundedTailoringData extends TailoredData {
  grounding?: TailoringGroundingReferences;
}

/** JSON schema for resume tailoring response */
const TAILORING_SCHEMA: JsonSchemaDefinition = {
  name: "resume_tailoring",
  schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "Job title headline matching the JD exactly",
      },
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      skills: {
        type: "array",
        description: "Skills sections with keywords tailored to the job",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Skill category name (e.g., Frontend, Backend)",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "List of skills/technologies in this category",
            },
          },
          required: ["name", "keywords"],
          additionalProperties: false,
        },
      },
      grounding: {
        type: "object",
        description:
          "Evidence IDs from the supplied resume evidence supporting each generated field",
        properties: {
          headlineEvidenceIds: {
            type: "array",
            items: { type: "string" },
          },
          summaryEvidenceIds: {
            type: "array",
            items: { type: "string" },
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                evidenceIds: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["name", "evidenceIds"],
              additionalProperties: false,
            },
          },
        },
        required: ["headlineEvidenceIds", "summaryEvidenceIds", "skills"],
        additionalProperties: false,
      },
    },
    required: ["headline", "summary", "skills", "grounding"],
    additionalProperties: false,
  },
};

function hashPromptTemplate(template: string): string {
  return `sha256:${createHash("sha256").update(template).digest("hex").slice(0, 12)}`;
}

function createAuditDraft(input: {
  status: TailoringAuditDraft["status"];
  provider: string | null;
  model: string | null;
  promptVersion: string;
  evidence: TailoringEvidenceItem[];
  claims?: TailoringClaim[];
  validation?: TailoringValidationReport | null;
  outputFingerprint?: string | null;
  startedAt: number;
  completedAt: number;
  errorMessage?: string | null;
}): TailoringAuditDraft {
  return {
    status: input.status,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    sourceResumeFingerprint: createResumeEvidenceFingerprint(input.evidence),
    outputFingerprint: input.outputFingerprint ?? null,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    evidence: input.evidence,
    claims: input.claims ?? [],
    validation: input.validation ?? null,
    errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
  };
}

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<TailoringResult> {
  const startedAt = Date.now();
  const evidence = extractResumeEvidence(profile);
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);
  const promptInput = await buildTailoringPrompt(
    profile,
    evidence,
    jobDescription,
    writingStyle,
  );

  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<GroundedTailoringData>({
    model,
    messages: [{ role: "user", content: promptInput.prompt }],
    jsonSchema: TAILORING_SCHEMA,
  });
  const completedAt = Date.now();

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return {
        success: false,
        error: message,
        audit: createAuditDraft({
          status: "failed",
          provider: llm.getProvider(),
          model,
          promptVersion: promptInput.promptVersion,
          evidence,
          startedAt,
          completedAt,
          errorMessage: message,
        }),
      };
    }
    const error = `${result.error} (${context})`;
    return {
      success: false,
      error,
      audit: createAuditDraft({
        status: "failed",
        provider: llm.getProvider(),
        model,
        promptVersion: promptInput.promptVersion,
        evidence,
        startedAt,
        completedAt,
        errorMessage: error,
      }),
    };
  }

  const { summary, headline, skills, grounding } = result.data;

  // Basic validation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
  }

  const data = {
    summary: sanitizeText(summary || ""),
    headline: sanitizeText(headline || ""),
    skills: (skills || []).map((group) => ({
      name: sanitizeText(group.name || ""),
      keywords: (group.keywords || []).map((keyword) => sanitizeText(keyword)),
    })),
  };
  const claims = createTailoringClaims(data, grounding);
  const validation = validateTailoringClaims({ evidence, claims });

  return {
    success: true,
    data,
    audit: createAuditDraft({
      status: "completed",
      provider: llm.getProvider(),
      model,
      promptVersion: promptInput.promptVersion,
      evidence,
      claims,
      validation,
      outputFingerprint: createTailoredContentFingerprint(data),
      startedAt,
      completedAt,
    }),
  };
}

/**
 * Backwards compatibility wrapper if needed, or alias.
 */
export async function generateSummary(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // If we just need summary, we can discard the rest (or cache it? but here we just return summary)
  const result = await generateTailoring(jobDescription, profile);
  return {
    success: result.success,
    summary: result.data?.summary,
    error: result.error,
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  evidence: TailoringEvidenceItem[],
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
): Promise<{ prompt: string; promptVersion: string }> {
  const jobDescription = stripHtmlTags(jd);
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
    jobDescription,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  // Extract only needed parts of profile to save tokens
  const relevantProfile = {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label, // Original headline
      summary: profile.basics?.summary,
    },
    skills: profile.sections?.skills,
    projects: profile.sections?.projects?.items?.map((p) => ({
      name: p.name,
      description: p.description,
      keywords: p.keywords,
    })),
    experience: profile.sections?.experience?.items?.map((e) => ({
      company: e.company,
      position: e.position,
      summary: e.summary,
    })),
    evidence,
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");
  const renderedPrompt = renderPromptTemplate(template, {
    jobDescription,
    profileJson: JSON.stringify(relevantProfile),
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
  const groundingContract = `

EVIDENCE CONTRACT:
- The profile JSON contains an "evidence" array with stable IDs.
- Use only those IDs in "grounding".
- Cite every factual summary claim and every skill keyword.
- A target-job headline may use an empty evidence list because it describes the target role.
- If no evidence supports a skill or factual claim, omit it.
- Return "grounding" even when a custom prompt template is active.`;

  return {
    prompt: `${renderedPrompt}${groundingContract}`,
    promptVersion: hashPromptTemplate(template),
  };
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
