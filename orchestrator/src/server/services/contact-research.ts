import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import * as peopleRepo from "@server/repositories/people-outreach";
import type {
  CreateJobContactInput,
  Job,
  JobContactResearchResult,
  JobContactRole,
} from "@shared/types";
import { PeruzBrowserAdapter } from "./browser-actions/peruz";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

const MAX_SOURCES = 5;
const MAX_PAGE_TEXT = 28_000;
const MAX_RESEARCH_TEXT = 70_000;
const SEARCH_HOSTS = new Set([
  "bing.com",
  "www.bing.com",
  "google.com",
  "www.google.com",
]);

interface InspectedSource {
  url: string;
  pageText: string;
}

export interface ResearchCandidate {
  name: string;
  title: string;
  company: string;
  team: string;
  role: JobContactRole;
  relevanceScore: number;
  relevanceReason: string;
  evidenceSummary: string;
  sourceUrl: string;
  linkedinUrl: string;
  xUrl: string;
  email: string;
}

interface ResearchResponse {
  contacts: ResearchCandidate[];
}

export interface ContactResearchDependencies {
  inspect(url: string): Promise<InspectedSource>;
  interpret(input: {
    job: Job;
    evidence: string;
    allowedUrls: string[];
  }): Promise<ResearchCandidate[]>;
}

const CONTACT_RESEARCH_SCHEMA: JsonSchemaDefinition = {
  name: "job_contact_research",
  schema: {
    type: "object",
    properties: {
      contacts: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            company: { type: "string" },
            team: { type: "string" },
            role: {
              type: "string",
              enum: [
                "decision_maker",
                "founder",
                "engineering_leader",
                "team_member",
                "recruiter",
              ],
            },
            relevanceScore: { type: "number", minimum: 0, maximum: 100 },
            relevanceReason: { type: "string" },
            evidenceSummary: { type: "string" },
            sourceUrl: { type: "string" },
            linkedinUrl: { type: "string" },
            xUrl: { type: "string" },
            email: { type: "string" },
          },
          required: [
            "name",
            "title",
            "company",
            "team",
            "role",
            "relevanceScore",
            "relevanceReason",
            "evidenceSummary",
            "sourceUrl",
            "linkedinUrl",
            "xUrl",
            "email",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["contacts"],
    additionalProperties: false,
  },
};

function clean(value: string | null | undefined, max = 2_000): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.replace(/[),.;]+$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function extractResearchUrls(pageText: string): string[] {
  const matches = pageText.match(/https?:\/\/[^\s<>"'\])}]+/g) ?? [];
  return Array.from(
    new Set(
      matches.map(normalizeUrl).filter((url): url is string => Boolean(url)),
    ),
  );
}

function isSearchUrl(value: string): boolean {
  try {
    return SEARCH_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return true;
  }
}

function targetTitles(job: Job): string {
  if (/founding/i.test(job.title)) {
    return '"Founder" OR "Co-Founder" OR "CTO" OR "Head of Engineering"';
  }
  if (/ai|machine learning|agent/i.test(job.title)) {
    return '"Head of AI" OR "AI Engineering Manager" OR "Director of AI" OR "CTO"';
  }
  return '"Engineering Manager" OR "Head of Engineering" OR "Director of Engineering" OR "CTO"';
}

export function buildContactSearchUrls(job: Job): string[] {
  const employer = clean(job.employer, 200);
  const role = clean(job.title, 200);
  const titles = targetTitles(job);
  const queries = [
    `site:linkedin.com/in "${employer}" (${titles})`,
    `"${employer}" "${role}" (${titles} OR recruiter)`,
  ];
  const companyUrls = [job.employerUrl, job.companyUrlDirect]
    .map((value) => normalizeUrl(value ?? ""))
    .filter((value): value is string => Boolean(value));
  return Array.from(
    new Set([
      ...companyUrls,
      ...queries.map(
        (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      ),
    ]),
  ).slice(0, MAX_SOURCES);
}

function compactEvidence(sources: InspectedSource[]): string {
  let remaining = MAX_RESEARCH_TEXT;
  const chunks: string[] = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const text = source.pageText.slice(0, Math.min(MAX_PAGE_TEXT, remaining));
    chunks.push(`SOURCE URL: ${source.url}\nSOURCE CONTENT:\n${text}`);
    remaining -= text.length;
  }
  return chunks.join("\n\n");
}

function buildResearchPrompt(input: {
  job: Job;
  evidence: string;
  allowedUrls: string[];
}): string {
  return `
Find at most five people who are credible contacts for this exact opportunity.

ROLE
Company: ${input.job.employer}
Job: ${input.job.title}
Location: ${input.job.location ?? "Unknown"}
Opportunity route: ${input.job.opportunityRoute}
Description: ${clean(input.job.jobDescription, 4_000)}

TARGETING RULES
- Prefer the manager or engineering/product leader who plausibly owns this work.
- For a small company or founding role, prefer the founder, CTO, or Head of Engineering.
- A recruiter is secondary and only relevant when the evidence connects them to technical hiring at this company.
- Do not infer a warm relationship. Do not return warm_referrer.
- Do not return unrelated employees, executives at large companies, or people whose current company is unclear.
- Use only facts present in the evidence.
- sourceUrl must be copied exactly from ALLOWED SOURCE URLS.
- Return an email only when that exact email appears in the evidence. Otherwise use an empty string.
- If the evidence does not establish a person's name, current title, company, and relevance, omit them.

ALLOWED SOURCE URLS
${input.allowedUrls.join("\n")}

EVIDENCE
${input.evidence}
  `.trim();
}

async function defaultInterpret(input: {
  job: Job;
  evidence: string;
  allowedUrls: string[];
}): Promise<ResearchCandidate[]> {
  if (input.allowedUrls.length === 0) return [];
  const [model, llm] = await Promise.all([
    resolveLlmModel("tailoring"),
    createConfiguredLlmService("tailoring"),
  ]);
  const result = await llm.callJson<ResearchResponse>({
    model,
    messages: [{ role: "user", content: buildResearchPrompt(input) }],
    jsonSchema: CONTACT_RESEARCH_SCHEMA,
  });
  if (!result.success) {
    throw new Error(`Contact research interpretation failed: ${result.error}`);
  }
  return result.data.contacts;
}

function defaultDependencies(): ContactResearchDependencies {
  const browser = new PeruzBrowserAdapter();
  return {
    inspect: async (url) => {
      const result = await browser.inspect({ url, kind: "contact" });
      return { url: result.url, pageText: result.pageText };
    },
    interpret: defaultInterpret,
  };
}

export function validateResearchCandidates(input: {
  candidates: ResearchCandidate[];
  evidence: string;
  allowedUrls: string[];
  employer: string;
}): CreateJobContactInput[] {
  const evidenceLower = input.evidence.toLowerCase();
  const allowed = new Map(
    input.allowedUrls.map((url) => [normalizeUrl(url), url]),
  );
  const seen = new Set<string>();
  const validated: CreateJobContactInput[] = [];

  for (const candidate of input.candidates) {
    const sourceKey = normalizeUrl(candidate.sourceUrl);
    const sourceUrl = sourceKey ? allowed.get(sourceKey) : null;
    const name = clean(candidate.name, 200);
    const title = clean(candidate.title, 300);
    const company = clean(candidate.company, 300);
    if (
      !sourceUrl ||
      isSearchUrl(sourceUrl) ||
      name.split(/\s+/).length < 2 ||
      !title ||
      !company ||
      !evidenceLower.includes(name.toLowerCase())
    ) {
      continue;
    }
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    const linkedinUrl = normalizeUrl(candidate.linkedinUrl);
    const xUrl = normalizeUrl(candidate.xUrl);
    const email = clean(candidate.email, 320).toLowerCase();
    const verifiedEmail =
      email && evidenceLower.includes(email.toLowerCase()) ? email : null;

    validated.push({
      name,
      title,
      company: company || input.employer,
      team: clean(candidate.team, 300) || null,
      role: candidate.role,
      relationshipStrength: "unknown",
      relevanceScore: Math.max(
        0,
        Math.min(100, Math.round(candidate.relevanceScore)),
      ),
      relevanceReason: clean(candidate.relevanceReason, 1_000),
      evidenceSummary: clean(candidate.evidenceSummary, 2_000),
      sourceUrl,
      linkedinUrl:
        linkedinUrl && allowed.has(linkedinUrl)
          ? allowed.get(linkedinUrl)
          : null,
      xUrl: xUrl && allowed.has(xUrl) ? allowed.get(xUrl) : null,
      email: verifiedEmail,
      emailConfidence: verifiedEmail ? "verified" : "unknown",
      isPrimary: false,
    });
  }

  return validated.sort(
    (left, right) => (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0),
  );
}

export async function researchJobContacts(
  job: Job,
  sourceUrls?: string[],
  dependencies: ContactResearchDependencies = defaultDependencies(),
): Promise<JobContactResearchResult> {
  const requestedSources = (
    sourceUrls?.length ? sourceUrls : buildContactSearchUrls(job)
  )
    .map(normalizeUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_SOURCES);
  const inspected: InspectedSource[] = [];
  const warnings: string[] = [];

  const outcomes = await Promise.allSettled(
    requestedSources.map((url) => dependencies.inspect(url)),
  );
  outcomes.forEach((outcome, index) => {
    const sourceUrl = requestedSources[index];
    if (outcome.status === "fulfilled") {
      inspected.push({
        url: outcome.value.url,
        pageText: outcome.value.pageText.slice(0, MAX_PAGE_TEXT),
      });
      return;
    }
    warnings.push(`Could not inspect ${new URL(sourceUrl).hostname}.`);
    logger.warn("Contact research source inspection failed", {
      jobId: job.id,
      sourceHost: new URL(sourceUrl).hostname,
      error: sanitizeUnknown(outcome.reason),
    });
  });

  if (inspected.length === 0) {
    return { contacts: [], sourcesInspected: [], warnings };
  }

  const evidence = compactEvidence(inspected);
  const extractedUrls = inspected.flatMap((source) =>
    extractResearchUrls(source.pageText),
  );
  const allowedUrls = Array.from(
    new Set([
      ...extractedUrls,
      ...inspected
        .map((source) => source.url)
        .filter((url) => !isSearchUrl(url)),
    ]),
  );
  const rawCandidates = await dependencies.interpret({
    job,
    evidence,
    allowedUrls,
  });
  const candidates = validateResearchCandidates({
    candidates: rawCandidates,
    evidence,
    allowedUrls,
    employer: job.employer,
  });

  const saved = [];
  for (const candidate of candidates) {
    saved.push(await peopleRepo.upsertResearchedContact(job.id, candidate));
  }

  const people = await peopleRepo.getPeopleOutreach(job.id);
  if (!people.contacts.some((contact) => contact.isPrimary) && saved[0]) {
    const primary = await peopleRepo.updateContact(job.id, saved[0].id, {
      isPrimary: true,
    });
    if (primary) {
      const index = saved.findIndex((contact) => contact.id === primary.id);
      if (index >= 0) saved[index] = primary;
    }
  }

  return {
    contacts: saved,
    sourcesInspected: inspected.map((source) => source.url),
    warnings,
  };
}
