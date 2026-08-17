import * as peopleRepo from "@server/repositories/people-outreach";
import type {
  Job,
  JobContact,
  JobOutreach,
  JobOutreachChannel,
  JobOutreachPurpose,
  ResumeProfile,
} from "@shared/types";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { getProfile } from "./profile";

interface OutreachDraftResponse {
  subject: string;
  body: string;
}

export interface DraftJobOutreachInput {
  purpose?: JobOutreachPurpose;
  channel?: JobOutreachChannel;
}

export interface OutreachDraftDependencies {
  loadProfile(): Promise<ResumeProfile>;
  generate(prompt: string): Promise<OutreachDraftResponse>;
}

const OUTREACH_DRAFT_SCHEMA: JsonSchemaDefinition = {
  name: "job_outreach_draft",
  schema: {
    type: "object",
    properties: {
      subject: { type: "string", maxLength: 120 },
      body: { type: "string", maxLength: 1200 },
    },
    required: ["subject", "body"],
    additionalProperties: false,
  },
};

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function profileEvidence(profile: ResumeProfile): string {
  const experience = (profile.sections?.experience?.items ?? [])
    .filter((item) => item.visible !== false)
    .map(
      (item) =>
        `${clean(item.position, 160)} at ${clean(item.company, 160)} (${clean(item.date, 80)}): ${clean(item.summary, 1_500)}`,
    );
  const projects = (profile.sections?.projects?.items ?? [])
    .filter((item) => item.visible !== false)
    .map(
      (item) =>
        `${clean(item.name, 160)}: ${clean(item.summary || item.description, 1_500)}`,
    );
  const skills = (profile.sections?.skills?.items ?? [])
    .filter((item) => item.visible !== false)
    .flatMap((item) => [item.name, ...(item.keywords ?? [])])
    .filter(Boolean)
    .slice(0, 60);

  return [
    `Candidate: ${clean(profile.basics?.name, 160)}`,
    `Headline: ${clean(profile.basics?.headline || profile.basics?.label, 300)}`,
    `Experience:\n${experience.join("\n") || "None provided"}`,
    `Projects:\n${projects.join("\n") || "None provided"}`,
    `Skills: ${skills.join(", ")}`,
  ].join("\n\n");
}

export function resolveOutreachPurpose(
  job: Job,
  contact: JobContact,
): JobOutreachPurpose {
  if (contact.role === "warm_referrer") return "referral_request";
  if (job.opportunityRoute === "direct_email_application") {
    return "direct_application";
  }
  if (job.opportunityRoute === "speculative_outreach") {
    return "speculative_outreach";
  }
  if (job.opportunityRoute === "contribute_then_connect") {
    return "contributor_follow_up";
  }
  return "application_follow_up";
}

export function resolveOutreachChannel(
  contact: JobContact,
  purpose?: JobOutreachPurpose,
): JobOutreachChannel {
  if (
    purpose === "direct_application" &&
    contact.email &&
    contact.emailConfidence === "verified"
  ) {
    return "email";
  }
  if (contact.linkedinUrl) return "linkedin";
  if (contact.xUrl) return "x";
  if (contact.email && contact.emailConfidence === "verified") return "email";
  return "other";
}

export function buildOutreachDraftPrompt(input: {
  job: Job;
  contact: JobContact;
  profile: ResumeProfile;
  purpose: JobOutreachPurpose;
  channel: JobOutreachChannel;
}): string {
  return `
Write one concise, human outreach message for a job search.

CONTEXT
Purpose: ${input.purpose}
Channel: ${input.channel}
Recipient: ${input.contact.name}, ${input.contact.title} at ${input.contact.company}
Why this person is relevant: ${clean(input.contact.relevanceReason, 1_000)}
Public evidence: ${clean(input.contact.evidenceSummary, 1_500)}
Evidence source: ${input.contact.sourceUrl}
Role: ${input.job.title} at ${input.job.employer}
Role description: ${clean(input.job.jobDescription, 4_000)}

VERIFIED CANDIDATE EVIDENCE
${profileEvidence(input.profile)}

RULES
- Write 3 or 4 natural sentences and stay under 110 words.
- Start from something concrete about the recipient, company, role, or public evidence.
- Connect only one genuinely relevant thing the candidate actually shipped.
- Preserve exact product names, tools, and metrics from the candidate evidence when useful.
- Make the ask appropriate to the purpose. A referral request must ask about referral fit; an application follow-up should mention the application; speculative outreach should ask whether this work is needed.
- End with one low-friction question. Do not ask for a generic 15-minute call.
- Do not summarize an implementation, list features, flatter, use buzzwords, or sound like a cover letter.
- Do not claim a relationship, conversation, application, contribution, result, tool, or metric that is not in the supplied evidence.
- Do not use em dashes, placeholders, markdown, greetings such as "I hope you're well", or phrases such as "I am excited", "perfect fit", and "passionate about".
- For LinkedIn or X, return an empty subject. For email, use a plain subject of at most 7 words.
  `.trim();
}

async function defaultGenerate(prompt: string): Promise<OutreachDraftResponse> {
  const [model, llm] = await Promise.all([
    resolveLlmModel("tailoring"),
    createConfiguredLlmService("tailoring"),
  ]);
  const result = await llm.callJson<OutreachDraftResponse>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: OUTREACH_DRAFT_SCHEMA,
  });
  if (!result.success) {
    throw new Error(`Outreach drafting failed: ${result.error}`);
  }
  return result.data;
}

function defaultDependencies(): OutreachDraftDependencies {
  return {
    loadProfile: () => getProfile(),
    generate: defaultGenerate,
  };
}

export async function draftJobOutreach(
  job: Job,
  contact: JobContact,
  input: DraftJobOutreachInput = {},
  dependencies: OutreachDraftDependencies = defaultDependencies(),
): Promise<JobOutreach> {
  const purpose = input.purpose ?? resolveOutreachPurpose(job, contact);
  const channel = input.channel ?? resolveOutreachChannel(contact, purpose);
  const profile = await dependencies.loadProfile();
  const generated = await dependencies.generate(
    buildOutreachDraftPrompt({ job, contact, profile, purpose, channel }),
  );
  const subject = channel === "email" ? clean(generated.subject, 120) : "";
  const body = clean(generated.body, 1_200);
  if (!body) throw new Error("Outreach drafting returned an empty message");

  return peopleRepo.createOutreach(job.id, contact.id, {
    purpose,
    channel,
    subject,
    body,
  });
}
