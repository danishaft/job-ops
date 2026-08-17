export const JOB_CONTACT_ROLES = [
  "warm_referrer",
  "decision_maker",
  "founder",
  "engineering_leader",
  "team_member",
  "recruiter",
] as const;

export type JobContactRole = (typeof JOB_CONTACT_ROLES)[number];

export const JOB_CONTACT_RELATIONSHIP_STRENGTHS = [
  "unknown",
  "none",
  "weak",
  "warm",
] as const;

export type JobContactRelationshipStrength =
  (typeof JOB_CONTACT_RELATIONSHIP_STRENGTHS)[number];

export const JOB_CONTACT_STATUSES = [
  "candidate",
  "selected",
  "contacted",
  "replied",
  "not_relevant",
] as const;

export type JobContactStatus = (typeof JOB_CONTACT_STATUSES)[number];

export const JOB_CONTACT_EMAIL_CONFIDENCE_VALUES = [
  "unknown",
  "verified",
] as const;

export type JobContactEmailConfidence =
  (typeof JOB_CONTACT_EMAIL_CONFIDENCE_VALUES)[number];

export const JOB_OUTREACH_CHANNELS = [
  "email",
  "linkedin",
  "x",
  "other",
] as const;

export type JobOutreachChannel = (typeof JOB_OUTREACH_CHANNELS)[number];

export const JOB_OUTREACH_PURPOSES = [
  "referral_request",
  "application_follow_up",
  "direct_application",
  "speculative_outreach",
  "contributor_follow_up",
] as const;

export type JobOutreachPurpose = (typeof JOB_OUTREACH_PURPOSES)[number];

export const JOB_OUTREACH_STATUSES = [
  "draft",
  "sent",
  "replied",
  "closed",
] as const;

export type JobOutreachStatus = (typeof JOB_OUTREACH_STATUSES)[number];

export interface JobContact {
  id: string;
  jobId: string;
  name: string;
  title: string;
  company: string;
  team: string | null;
  role: JobContactRole;
  status: JobContactStatus;
  relationshipStrength: JobContactRelationshipStrength;
  relevanceScore: number;
  relevanceReason: string;
  evidenceSummary: string;
  sourceUrl: string;
  linkedinUrl: string | null;
  xUrl: string | null;
  email: string | null;
  emailConfidence: JobContactEmailConfidence;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobOutreach {
  id: string;
  jobId: string;
  contactId: string;
  purpose: JobOutreachPurpose;
  channel: JobOutreachChannel;
  status: JobOutreachStatus;
  subject: string;
  body: string;
  sentAt: number | null;
  followUpAt: number | null;
  repliedAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobPeopleOutreach {
  contacts: JobContact[];
  outreach: JobOutreach[];
}

export interface CreateJobContactInput {
  name: string;
  title: string;
  company: string;
  team?: string | null;
  role: JobContactRole;
  status?: JobContactStatus;
  relationshipStrength?: JobContactRelationshipStrength;
  relevanceScore?: number;
  relevanceReason: string;
  evidenceSummary: string;
  sourceUrl: string;
  linkedinUrl?: string | null;
  xUrl?: string | null;
  email?: string | null;
  emailConfidence?: JobContactEmailConfidence;
  isPrimary?: boolean;
  notes?: string | null;
}

export type UpdateJobContactInput = Partial<CreateJobContactInput>;

export interface CreateJobOutreachInput {
  purpose: JobOutreachPurpose;
  channel: JobOutreachChannel;
  subject?: string;
  body: string;
  followUpAt?: number | null;
}

export interface UpdateJobOutreachInput {
  purpose?: JobOutreachPurpose;
  channel?: JobOutreachChannel;
  status?: JobOutreachStatus;
  subject?: string;
  body?: string;
  sentAt?: number | null;
  followUpAt?: number | null;
  repliedAt?: number | null;
}

export interface JobContactResearchResult {
  contacts: JobContact[];
  sourcesInspected: string[];
  warnings: string[];
}
