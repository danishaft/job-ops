import type { OpportunitySignals } from "./types/jobs";

export type OpportunitySourceChannel =
  | "portfolio_board"
  | "talent_network"
  | "direct_hiring"
  | "funding_signal"
  | "open_source"
  | "community";

export interface OpportunitySourceDefinition {
  id: string;
  sourceId: string;
  label: string;
  url: string;
  channel: OpportunitySourceChannel;
  regions: Array<"us" | "europe" | "global">;
  browserRequired: boolean;
  trackAsOpportunity: boolean;
  batchMode: "static" | "hacker_news" | "page";
  defaultSignals?: Partial<OpportunitySignals>;
  verifiedAt: string;
}

export const OPPORTUNITY_SOURCES: OpportunitySourceDefinition[] = [
  {
    id: "a16z-talentplace",
    sourceId: "a16z:talentplace",
    label: "a16z TalentPlace",
    url: "https://talentplace.a16z.com/",
    channel: "talent_network",
    regions: ["us", "global"],
    browserRequired: true,
    trackAsOpportunity: true,
    batchMode: "static",
    defaultSignals: { hasOpenRole: false, isTalentNetwork: true },
    verifiedAt: "2026-07-31",
  },
  {
    id: "point-nine-talent-network",
    sourceId: "pointnine:talent-network",
    label: "Point Nine Talent Network",
    url: "https://jobs.pointnine.com/talent-network",
    channel: "talent_network",
    regions: ["europe", "global"],
    browserRequired: true,
    trackAsOpportunity: true,
    batchMode: "static",
    defaultSignals: { hasOpenRole: false, isTalentNetwork: true },
    verifiedAt: "2026-07-31",
  },
  {
    id: "balderton-talent-network",
    sourceId: "balderton:talent-network",
    label: "Balderton Talent Network",
    url: "https://careers.balderton.com/talent-network",
    channel: "talent_network",
    regions: ["europe"],
    browserRequired: true,
    trackAsOpportunity: true,
    batchMode: "static",
    defaultSignals: { hasOpenRole: false, isTalentNetwork: true },
    verifiedAt: "2026-07-31",
  },
  {
    id: "yc-jobs",
    sourceId: "yc:jobs",
    label: "Y Combinator startup jobs",
    url: "https://www.ycombinator.com/jobs",
    channel: "portfolio_board",
    regions: ["us", "global"],
    browserRequired: false,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "a16z-portfolio-jobs",
    sourceId: "a16z:portfolio-jobs",
    label: "a16z portfolio jobs",
    url: "https://portfoliojobs.a16z.com/jobs",
    channel: "portfolio_board",
    regions: ["us", "global"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "sequoia-portfolio-jobs",
    sourceId: "sequoia:portfolio-jobs",
    label: "Sequoia portfolio jobs",
    url: "https://jobs.sequoiacap.com/jobs",
    channel: "portfolio_board",
    regions: ["us", "europe", "global"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "index-startup-jobs",
    sourceId: "index:startup-jobs",
    label: "Index Ventures startup jobs",
    url: "https://www.indexventures.com/startup-jobs/",
    channel: "portfolio_board",
    regions: ["us", "europe"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "balderton-portfolio-jobs",
    sourceId: "balderton:portfolio-jobs",
    label: "Balderton portfolio jobs",
    url: "https://careers.balderton.com/jobs",
    channel: "portfolio_board",
    regions: ["europe"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "point-nine-portfolio-jobs",
    sourceId: "pointnine:portfolio-jobs",
    label: "Point Nine portfolio jobs",
    url: "https://jobs.pointnine.com/jobs",
    channel: "portfolio_board",
    regions: ["europe", "global"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "hn-who-is-hiring",
    sourceId: "hackernews:who-is-hiring",
    label: "Hacker News Who is Hiring",
    url: "https://news.ycombinator.com/submitted?id=whoishiring",
    channel: "direct_hiring",
    regions: ["us", "europe", "global"],
    browserRequired: false,
    trackAsOpportunity: false,
    batchMode: "hacker_news",
    verifiedAt: "2026-07-31",
  },
  {
    id: "wellfound",
    sourceId: "wellfound:jobs",
    label: "Wellfound startup jobs",
    url: "https://wellfound.com/jobs",
    channel: "direct_hiring",
    regions: ["us", "europe", "global"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "a16z-build",
    sourceId: "a16z:build-newsletter",
    label: "a16z Build hiring and funding signals",
    url: "https://a16zbuild.substack.com/",
    channel: "funding_signal",
    regions: ["us", "global"],
    browserRequired: false,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
  {
    id: "github-opportunities",
    sourceId: "github:issues",
    label: "GitHub contribution opportunities",
    url: "https://github.com/issues?q=is%3Aopen+label%3A%22help+wanted%22",
    channel: "open_source",
    regions: ["global"],
    browserRequired: true,
    trackAsOpportunity: false,
    batchMode: "page",
    verifiedAt: "2026-07-31",
  },
];
