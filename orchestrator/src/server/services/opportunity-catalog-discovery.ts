import { createHash } from "node:crypto";
import {
  buildOpportunityProvenance,
  normalizeOpportunitySignals,
} from "@shared/opportunity-routing.js";
import {
  OPPORTUNITY_SOURCES,
  type OpportunitySourceDefinition,
} from "@shared/opportunity-sources.js";
import type { CreateJobInput } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import { JSDOM } from "jsdom";
import { PeruzBrowserAdapter } from "./browser-actions/peruz";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

const PAGE_TEXT_LIMIT = 60_000;
const SOURCE_CONCURRENCY = 3;
const MAX_OPPORTUNITIES_PER_SOURCE = 100;

export interface CatalogPageOpportunity {
  kind: "open_role" | "company_signal" | "open_source";
  title: string;
  employer: string;
  url: string;
  applicationUrl: string;
  location: string;
  description: string;
  directApplicationEmail: boolean;
}

interface CatalogPageResponse {
  opportunities: CatalogPageOpportunity[];
}

export interface OpportunityCatalogDiscoveryDependencies {
  readPage(source: OpportunitySourceDefinition): Promise<string>;
  interpretPage(input: {
    source: OpportunitySourceDefinition;
    pageText: string;
    searchTerms: string[];
  }): Promise<CatalogPageOpportunity[]>;
  fetchJson(url: string): Promise<unknown>;
}

export interface OpportunityCatalogDiscoveryResult {
  jobs: CreateJobInput[];
  sourceErrors: string[];
  sourcesChecked: number;
}

const CATALOG_PAGE_SCHEMA: JsonSchemaDefinition = {
  name: "opportunity_catalog_page",
  schema: {
    type: "object",
    properties: {
      opportunities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["open_role", "company_signal", "open_source"],
            },
            title: { type: "string" },
            employer: { type: "string" },
            url: { type: "string" },
            applicationUrl: { type: "string" },
            location: { type: "string" },
            description: { type: "string" },
            directApplicationEmail: { type: "boolean" },
          },
          required: [
            "kind",
            "title",
            "employer",
            "url",
            "applicationUrl",
            "location",
            "description",
            "directApplicationEmail",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["opportunities"],
    additionalProperties: false,
  },
};

function clean(value: string | null | undefined, max = 2_000): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function resolveHttpUrl(
  value: string | null | undefined,
  fallback: string,
): string {
  const candidate = clean(value, 2_000);
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate, fallback);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function buildStaticOpportunity(
  source: OpportunitySourceDefinition,
): CreateJobInput {
  const discoveredAt = new Date().toISOString();
  return {
    source: source.sourceId,
    sourceJobId: source.id,
    title: `${source.label} profile`,
    employer: source.label,
    jobUrl: source.url,
    applicationLink: source.url,
    jobDescription: `Reusable candidate profile for ${source.label}. Monitor matching portfolio companies as separate opportunities.`,
    opportunitySignals: normalizeOpportunitySignals(source.defaultSignals),
    opportunityProvenance: [
      buildOpportunityProvenance({
        source: source.sourceId,
        sourceJobId: source.id,
        jobUrl: source.url,
        discoveredAt,
      }),
    ],
  };
}

function sourceSignals(
  source: OpportunitySourceDefinition,
  opportunity: CatalogPageOpportunity,
) {
  const hasOpenRole = opportunity.kind === "open_role";
  return normalizeOpportunitySignals({
    ...source.defaultSignals,
    hasOpenRole,
    hasDirectApplicationEmail: opportunity.directApplicationEmail,
    hasStrongHiringSignal:
      source.channel === "funding_signal" ||
      opportunity.kind === "company_signal",
    isTalentNetwork: source.channel === "talent_network",
    isOpenSourceCompany:
      source.channel === "open_source" || opportunity.kind === "open_source",
    warmConnectionStatus: "unknown",
    eligibility: "unknown",
  });
}

function mapPageOpportunity(
  source: OpportunitySourceDefinition,
  opportunity: CatalogPageOpportunity,
  pageText: string,
): CreateJobInput | null {
  const employer = clean(opportunity.employer, 500);
  if (!employer) return null;
  const fallbackUrl = source.url;
  const suppliedUrl = resolveHttpUrl(opportunity.url, fallbackUrl);
  const jobUrl =
    suppliedUrl === fallbackUrl || pageText.includes(opportunity.url)
      ? suppliedUrl
      : fallbackUrl;
  const applicationLink = resolveHttpUrl(opportunity.applicationUrl, jobUrl);
  const title =
    clean(opportunity.title, 500) ||
    (opportunity.kind === "open_role"
      ? "Engineering opportunity"
      : "Potential engineering opportunity");
  const description =
    clean(opportunity.description, 20_000) ||
    `${title} at ${employer}, discovered through ${source.label}. Verify the source before acting.`;
  const discoveredAt = new Date().toISOString();
  const fingerprint = createHash("sha256")
    .update(`${jobUrl}\n${employer}\n${title}`)
    .digest("hex")
    .slice(0, 20);
  const sourceJobId = `${source.id}:${fingerprint}`;

  return {
    source: source.sourceId,
    sourceJobId,
    title,
    employer,
    jobUrl,
    applicationLink,
    location: clean(opportunity.location, 200) || undefined,
    jobDescription: description,
    opportunitySignals: sourceSignals(source, opportunity),
    opportunityProvenance: [
      buildOpportunityProvenance({
        source: source.sourceId,
        sourceJobId,
        jobUrl,
        discoveredAt,
      }),
    ],
  };
}

function pageToText(html: string, baseUrl: string): string {
  const dom = new JSDOM(html, { url: baseUrl });
  const document = dom.window.document;
  for (const node of document.querySelectorAll("script, style, noscript")) {
    node.remove();
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const label = clean(anchor.textContent, 300);
    const href = resolveHttpUrl(anchor.getAttribute("href"), baseUrl);
    anchor.replaceWith(document.createTextNode(`${label} (${href})`));
  }
  return clean(document.body?.textContent, PAGE_TEXT_LIMIT);
}

async function defaultReadPage(
  source: OpportunitySourceDefinition,
): Promise<string> {
  const readWithFetch = async () => {
    const response = await fetch(source.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "JobOps opportunity discovery/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return pageToText(await response.text(), source.url);
  };

  if (!source.browserRequired) {
    try {
      const text = await readWithFetch();
      if (text.length >= 500) return text;
    } catch {
      // Peruz is the fallback when a normal request is blocked or unavailable.
    }
  }

  try {
    const result = await new PeruzBrowserAdapter().inspect({
      url: source.url,
      kind: source.channel === "open_source" ? "company" : "role",
    });
    if (result.pageText.trim().length > 0) return result.pageText;
  } catch (browserError) {
    if (source.browserRequired) {
      try {
        return await readWithFetch();
      } catch {
        throw browserError;
      }
    }
  }

  return readWithFetch();
}

async function defaultInterpretPage(input: {
  source: OpportunitySourceDefinition;
  pageText: string;
  searchTerms: string[];
}): Promise<CatalogPageOpportunity[]> {
  const model = await resolveLlmModel();
  const llm = await createConfiguredLlmService();
  const result = await llm.callJson<CatalogPageResponse>({
    model,
    messages: [
      {
        role: "user",
        content: `Extract real opportunities from this public source page.

Source: ${input.source.label}
Channel: ${input.source.channel}
Target role terms: ${input.searchTerms.join(", ") || "engineering"}

Rules:
- Return only opportunities visibly present in the supplied page text.
- Prefer opportunities matching the target role terms.
- Use open_role for a specific advertised role.
- Use company_signal only for a named company with a concrete funding, growth, or hiring signal and no specific role.
- Use open_source only for a named repository or company contribution opportunity.
- Copy URLs from the page text. Use an empty string when a URL or field is absent.
- Do not invent employers, roles, metrics, or contact details.

PAGE TEXT:
${input.pageText.slice(0, PAGE_TEXT_LIMIT)}`,
      },
    ],
    jsonSchema: CATALOG_PAGE_SCHEMA,
  });
  if (!result.success) throw new Error("Catalog page interpretation failed");
  return result.data.opportunities.slice(0, MAX_OPPORTUNITIES_PER_SOURCE);
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHackerNewsEmployer(text: string, author: string): string {
  const firstSegment = clean(text.split("|")[0], 500)
    .replace(/^[-–—\s]+/, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  return firstSegment && firstSegment.length <= 160
    ? firstSegment
    : author || "Hacker News employer";
}

function parseHackerNewsTitle(text: string): string {
  const segments = text
    .split("|")
    .map((segment) => clean(segment, 500))
    .filter(Boolean);
  return (
    segments.find(
      (segment) =>
        segment.length <= 180 &&
        /engineer|developer|software|data|machine learning|devops|sre|security/i.test(
          segment,
        ),
    ) ?? "Engineering opportunities"
  );
}

async function discoverHackerNewsJobs(
  source: OpportunitySourceDefinition,
  searchTerms: string[],
  fetchJson: (url: string) => Promise<unknown>,
): Promise<CreateJobInput[]> {
  const searchUrl = new URL("https://hn.algolia.com/api/v1/search_by_date");
  searchUrl.searchParams.set("tags", "story");
  searchUrl.searchParams.set("query", "Ask HN: Who is hiring?");
  searchUrl.searchParams.set("hitsPerPage", "20");
  const searchPayload = await fetchJson(searchUrl.toString());
  const hits =
    isRecord(searchPayload) && Array.isArray(searchPayload.hits)
      ? searchPayload.hits
      : [];
  const thread = hits.find(
    (hit) =>
      isRecord(hit) &&
      typeof hit.title === "string" &&
      /^Ask HN: Who is hiring\? \(/i.test(hit.title) &&
      hit.author === "whoishiring" &&
      typeof hit.objectID === "string",
  );
  if (!isRecord(thread) || typeof thread.objectID !== "string") return [];

  const itemPayload = await fetchJson(
    `https://hn.algolia.com/api/v1/items/${thread.objectID}`,
  );
  const children =
    isRecord(itemPayload) && Array.isArray(itemPayload.children)
      ? itemPayload.children
      : [];
  const normalizedTerms = searchTerms.map((term) => term.toLowerCase());

  return children
    .flatMap((child): CreateJobInput[] => {
      if (!isRecord(child) || typeof child.id !== "number") return [];
      const rawText = typeof child.text === "string" ? child.text : "";
      const text = clean(stripHtmlTags(rawText), 20_000);
      if (!text) return [];
      if (
        normalizedTerms.length > 0 &&
        !normalizedTerms.some((term) => text.toLowerCase().includes(term))
      ) {
        return [];
      }
      const author = typeof child.author === "string" ? child.author : "";
      const jobUrl = `https://news.ycombinator.com/item?id=${child.id}`;
      const sourceJobId = String(child.id);
      const discoveredAt = new Date().toISOString();
      return [
        {
          source: source.sourceId,
          sourceJobId,
          title: parseHackerNewsTitle(text),
          employer: parseHackerNewsEmployer(text, author),
          jobUrl,
          jobDescription: text,
          opportunitySignals: normalizeOpportunitySignals({
            hasOpenRole: true,
            hasDirectApplicationEmail:
              /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text),
            hasStrongHiringSignal: true,
            warmConnectionStatus: "unknown",
            eligibility: "unknown",
          }),
          opportunityProvenance: [
            buildOpportunityProvenance({
              source: source.sourceId,
              sourceJobId,
              jobUrl,
              discoveredAt,
            }),
          ],
        },
      ];
    })
    .slice(0, MAX_OPPORTUNITIES_PER_SOURCE);
}

async function runWithConcurrency<T, R>(
  values: readonly T[],
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(SOURCE_CONCURRENCY, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await worker(values[index]),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

export async function discoverOpportunityCatalogJobs(args: {
  searchTerms: string[];
  sourceIds?: string[] | null;
  shouldCancel?: () => boolean;
  dependencies?: Partial<OpportunityCatalogDiscoveryDependencies>;
}): Promise<OpportunityCatalogDiscoveryResult> {
  const requestedIds = args.sourceIds ? new Set(args.sourceIds) : null;
  const sources = OPPORTUNITY_SOURCES.filter(
    (source) => !requestedIds || requestedIds.has(source.id),
  );
  const dependencies: OpportunityCatalogDiscoveryDependencies = {
    readPage: defaultReadPage,
    interpretPage: defaultInterpretPage,
    fetchJson: defaultFetchJson,
    ...args.dependencies,
  };
  const jobs: CreateJobInput[] = [];
  const sourceErrors: string[] = [];
  const results = await runWithConcurrency(sources, async (source) => {
    if (args.shouldCancel?.()) return [];
    if (source.batchMode === "static") {
      return [buildStaticOpportunity(source)];
    }
    if (source.batchMode === "hacker_news") {
      return discoverHackerNewsJobs(
        source,
        args.searchTerms,
        dependencies.fetchJson,
      );
    }
    const pageText = await dependencies.readPage(source);
    const interpreted = await dependencies.interpretPage({
      source,
      pageText,
      searchTerms: args.searchTerms,
    });
    return interpreted
      .map((opportunity) => mapPageOpportunity(source, opportunity, pageText))
      .filter((job): job is CreateJobInput => job !== null);
  });

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
      return;
    }
    const source = sources[index];
    sourceErrors.push(`${source?.label ?? "Catalog source"}: unavailable`);
  });

  return { jobs, sourceErrors, sourcesChecked: sources.length };
}
