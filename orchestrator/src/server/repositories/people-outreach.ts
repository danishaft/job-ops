import { randomUUID } from "node:crypto";
import type {
  CreateJobContactInput,
  CreateJobOutreachInput,
  JobContact,
  JobOutreach,
  JobPeopleOutreach,
  UpdateJobContactInput,
  UpdateJobOutreachInput,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { jobContacts, jobOutreach } = schema;

function contactScope(jobId: string) {
  return and(privateDataScopeFilter(jobContacts), eq(jobContacts.jobId, jobId));
}

function outreachScope(jobId: string) {
  return and(privateDataScopeFilter(jobOutreach), eq(jobOutreach.jobId, jobId));
}

function addBusinessDaysEpoch(start: number, businessDays: number): number {
  const date = new Date(start * 1000);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return Math.floor(date.getTime() / 1000);
}

export async function getPeopleOutreach(
  jobId: string,
): Promise<JobPeopleOutreach> {
  const [contacts, outreach] = await Promise.all([
    db
      .select()
      .from(jobContacts)
      .where(contactScope(jobId))
      .orderBy(
        desc(jobContacts.isPrimary),
        desc(jobContacts.relevanceScore),
        desc(jobContacts.updatedAt),
      ),
    db
      .select()
      .from(jobOutreach)
      .where(outreachScope(jobId))
      .orderBy(desc(jobOutreach.updatedAt)),
  ]);

  return {
    contacts: contacts as JobContact[],
    outreach: outreach as JobOutreach[],
  };
}

export async function getContact(
  jobId: string,
  contactId: string,
): Promise<JobContact | null> {
  const [contact] = await db
    .select()
    .from(jobContacts)
    .where(and(contactScope(jobId), eq(jobContacts.id, contactId)))
    .limit(1);
  return (contact as JobContact | undefined) ?? null;
}

export async function createContact(
  jobId: string,
  input: CreateJobContactInput,
): Promise<JobContact> {
  const scope = getPrivateDataScope();
  const now = new Date().toISOString();
  const id = randomUUID();

  db.transaction((tx) => {
    if (input.isPrimary) {
      tx.update(jobContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(contactScope(jobId))
        .run();
    }

    tx.insert(jobContacts)
      .values({
        id,
        tenantId: scope.tenantId,
        userId: scope.userId,
        jobId,
        name: input.name,
        title: input.title,
        company: input.company,
        team: input.team ?? null,
        role: input.role,
        status: input.status ?? (input.isPrimary ? "selected" : "candidate"),
        relationshipStrength: input.relationshipStrength ?? "unknown",
        relevanceScore: input.relevanceScore ?? 0,
        relevanceReason: input.relevanceReason,
        evidenceSummary: input.evidenceSummary,
        sourceUrl: input.sourceUrl,
        linkedinUrl: input.linkedinUrl ?? null,
        xUrl: input.xUrl ?? null,
        email: input.email ?? null,
        emailConfidence: input.emailConfidence ?? "unknown",
        isPrimary: input.isPrimary ?? false,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  const contact = await getContact(jobId, id);
  if (!contact) throw new Error("Created contact could not be loaded");
  return contact;
}

export async function upsertResearchedContact(
  jobId: string,
  input: CreateJobContactInput,
): Promise<JobContact> {
  const [existing] = await db
    .select({ id: jobContacts.id })
    .from(jobContacts)
    .where(and(contactScope(jobId), eq(jobContacts.sourceUrl, input.sourceUrl)))
    .limit(1);

  if (!existing) return createContact(jobId, input);
  const updated = await updateContact(jobId, existing.id, {
    name: input.name,
    title: input.title,
    company: input.company,
    team: input.team,
    role: input.role,
    relevanceScore: input.relevanceScore,
    relevanceReason: input.relevanceReason,
    evidenceSummary: input.evidenceSummary,
    linkedinUrl: input.linkedinUrl,
    xUrl: input.xUrl,
    email: input.email,
    emailConfidence: input.emailConfidence,
  });
  if (!updated) throw new Error("Researched contact could not be updated");
  return updated;
}

export async function updateContact(
  jobId: string,
  contactId: string,
  input: UpdateJobContactInput,
): Promise<JobContact | null> {
  const now = new Date().toISOString();
  const updates: Partial<typeof jobContacts.$inferInsert> = { updatedAt: now };
  const assign = <K extends keyof UpdateJobContactInput>(
    key: K,
    column: keyof typeof updates,
  ) => {
    if (input[key] !== undefined) {
      (updates as Record<string, unknown>)[column] = input[key];
    }
  };

  assign("name", "name");
  assign("title", "title");
  assign("company", "company");
  assign("team", "team");
  assign("role", "role");
  assign("status", "status");
  assign("relationshipStrength", "relationshipStrength");
  assign("relevanceScore", "relevanceScore");
  assign("relevanceReason", "relevanceReason");
  assign("evidenceSummary", "evidenceSummary");
  assign("sourceUrl", "sourceUrl");
  assign("linkedinUrl", "linkedinUrl");
  assign("xUrl", "xUrl");
  assign("email", "email");
  assign("emailConfidence", "emailConfidence");
  assign("isPrimary", "isPrimary");
  assign("notes", "notes");

  db.transaction((tx) => {
    if (input.isPrimary === true) {
      tx.update(jobContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(contactScope(jobId))
        .run();
      updates.status = "selected";
    }
    tx.update(jobContacts)
      .set(updates)
      .where(and(contactScope(jobId), eq(jobContacts.id, contactId)))
      .run();
  });

  return getContact(jobId, contactId);
}

export async function deleteContact(
  jobId: string,
  contactId: string,
): Promise<number> {
  const result = await db
    .delete(jobContacts)
    .where(and(contactScope(jobId), eq(jobContacts.id, contactId)));
  return result.changes;
}

export async function createOutreach(
  jobId: string,
  contactId: string,
  input: CreateJobOutreachInput,
): Promise<JobOutreach> {
  const scope = getPrivateDataScope();
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(jobOutreach).values({
    id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    jobId,
    contactId,
    purpose: input.purpose,
    channel: input.channel,
    status: "draft",
    subject: input.subject ?? "",
    body: input.body,
    followUpAt: input.followUpAt ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const outreach = await getOutreach(jobId, id);
  if (!outreach) throw new Error("Created outreach could not be loaded");
  return outreach;
}

export async function getOutreach(
  jobId: string,
  outreachId: string,
): Promise<JobOutreach | null> {
  const [record] = await db
    .select()
    .from(jobOutreach)
    .where(and(outreachScope(jobId), eq(jobOutreach.id, outreachId)))
    .limit(1);
  return (record as JobOutreach | undefined) ?? null;
}

export async function updateOutreach(
  jobId: string,
  outreachId: string,
  input: UpdateJobOutreachInput,
): Promise<JobOutreach | null> {
  const now = new Date().toISOString();
  const epochNow = Math.floor(Date.now() / 1000);
  const existing = await getOutreach(jobId, outreachId);
  if (!existing) return null;

  const updates: Partial<typeof jobOutreach.$inferInsert> = { updatedAt: now };
  const assign = <K extends keyof UpdateJobOutreachInput>(
    key: K,
    column: keyof typeof updates,
  ) => {
    if (input[key] !== undefined) {
      (updates as Record<string, unknown>)[column] = input[key];
    }
  };
  assign("purpose", "purpose");
  assign("channel", "channel");
  assign("status", "status");
  assign("subject", "subject");
  assign("body", "body");
  assign("sentAt", "sentAt");
  assign("followUpAt", "followUpAt");
  assign("repliedAt", "repliedAt");

  if (input.status === "sent") {
    if (input.sentAt === undefined) updates.sentAt = epochNow;
    if (input.followUpAt === undefined) {
      updates.followUpAt = addBusinessDaysEpoch(epochNow, 3);
    }
  }
  if (input.status === "replied" && input.repliedAt === undefined) {
    updates.repliedAt = epochNow;
  }

  db.transaction((tx) => {
    tx.update(jobOutreach)
      .set(updates)
      .where(and(outreachScope(jobId), eq(jobOutreach.id, outreachId)))
      .run();
    if (input.status === "sent" || input.status === "replied") {
      tx.update(jobContacts)
        .set({
          status: input.status === "sent" ? "contacted" : "replied",
          updatedAt: now,
        })
        .where(and(contactScope(jobId), eq(jobContacts.id, existing.contactId)))
        .run();
    }
  });

  return getOutreach(jobId, outreachId);
}
