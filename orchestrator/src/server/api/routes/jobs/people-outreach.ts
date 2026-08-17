import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as peopleRepo from "@server/repositories/people-outreach";
import { researchJobContacts } from "@server/services/contact-research";
import { draftJobOutreach } from "@server/services/outreach-drafting";
import {
  JOB_CONTACT_EMAIL_CONFIDENCE_VALUES,
  JOB_CONTACT_RELATIONSHIP_STRENGTHS,
  JOB_CONTACT_ROLES,
  JOB_CONTACT_STATUSES,
  JOB_OUTREACH_CHANNELS,
  JOB_OUTREACH_PURPOSES,
  JOB_OUTREACH_STATUSES,
} from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireJob, toJobsRouteError } from "./shared";

export const jobsPeopleOutreachRouter = Router();

const optionalNullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const optionalNullableUrl = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .nullable()
  .optional();

const contactCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  team: optionalNullableText(300),
  role: z.enum(JOB_CONTACT_ROLES),
  status: z.enum(JOB_CONTACT_STATUSES).optional(),
  relationshipStrength: z.enum(JOB_CONTACT_RELATIONSHIP_STRENGTHS).optional(),
  relevanceScore: z.number().int().min(0).max(100).optional(),
  relevanceReason: z.string().trim().min(1).max(1_000),
  evidenceSummary: z.string().trim().min(1).max(2_000),
  sourceUrl: z.string().trim().url().max(2_000),
  linkedinUrl: optionalNullableUrl,
  xUrl: optionalNullableUrl,
  email: z.string().trim().email().max(320).nullable().optional(),
  emailConfidence: z.enum(JOB_CONTACT_EMAIL_CONFIDENCE_VALUES).optional(),
  isPrimary: z.boolean().optional(),
  notes: optionalNullableText(4_000),
});

const contactUpdateSchema = contactCreateSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one contact field is required",
  );

const contactResearchSchema = z.object({
  sourceUrls: z.array(z.string().trim().url().max(2_000)).max(5).optional(),
});

const outreachCreateSchema = z.object({
  purpose: z.enum(JOB_OUTREACH_PURPOSES),
  channel: z.enum(JOB_OUTREACH_CHANNELS),
  subject: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(1_200),
  followUpAt: z.number().int().nullable().optional(),
});

const outreachDraftSchema = z.object({
  purpose: z.enum(JOB_OUTREACH_PURPOSES).optional(),
  channel: z.enum(JOB_OUTREACH_CHANNELS).optional(),
});

const outreachUpdateSchema = z
  .object({
    purpose: z.enum(JOB_OUTREACH_PURPOSES).optional(),
    channel: z.enum(JOB_OUTREACH_CHANNELS).optional(),
    status: z.enum(JOB_OUTREACH_STATUSES).optional(),
    subject: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1).max(1_200).optional(),
    sentAt: z.number().int().nullable().optional(),
    followUpAt: z.number().int().nullable().optional(),
    repliedAt: z.number().int().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one outreach field is required",
  );

function requestId(res: Response): string {
  return String(res.getHeader("x-request-id") || "unknown");
}

function routeFailure(
  req: Request,
  res: Response,
  route: string,
  error: unknown,
): void {
  const appError = toJobsRouteError(error);
  logger.error("People and outreach route failed", {
    route,
    requestId: requestId(res),
    jobId: req.params.id,
    contactId: req.params.contactId,
    outreachId: req.params.outreachId,
    status: appError.status,
    code: appError.code,
    errorMessage: error instanceof Error ? error.message : undefined,
  });
  fail(res, appError);
}

async function requireContact(jobId: string, contactId: string) {
  const contact = await peopleRepo.getContact(jobId, contactId);
  if (!contact) throw notFound("Job contact not found");
  return contact;
}

jobsPeopleOutreachRouter.get(
  "/:id/people-outreach",
  async (req: Request, res: Response) => {
    const route = "GET /api/jobs/:id/people-outreach";
    try {
      const job = await requireJob(req.params.id);
      ok(res, await peopleRepo.getPeopleOutreach(job.id));
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.post(
  "/:id/contacts/research",
  async (req: Request, res: Response) => {
    const route = "POST /api/jobs/:id/contacts/research";
    try {
      const parsed = contactResearchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return fail(
          res,
          badRequest(
            "Invalid contact research request",
            parsed.error.flatten(),
          ),
        );
      }
      const job = await requireJob(req.params.id);
      const result = await researchJobContacts(job, parsed.data.sourceUrls);
      logger.info("Job contact research completed", {
        route,
        requestId: requestId(res),
        jobId: job.id,
        contactCount: result.contacts.length,
        sourceCount: result.sourcesInspected.length,
        warningCount: result.warnings.length,
      });
      ok(res, result);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.post(
  "/:id/contacts",
  async (req: Request, res: Response) => {
    const route = "POST /api/jobs/:id/contacts";
    try {
      const parsed = contactCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(
          res,
          badRequest("Invalid job contact", parsed.error.flatten()),
        );
      }
      const job = await requireJob(req.params.id);
      const contact = await peopleRepo.createContact(job.id, parsed.data);
      ok(res, contact, 201);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.patch(
  "/:id/contacts/:contactId",
  async (req: Request, res: Response) => {
    const route = "PATCH /api/jobs/:id/contacts/:contactId";
    try {
      const parsed = contactUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(
          res,
          badRequest("Invalid job contact", parsed.error.flatten()),
        );
      }
      const job = await requireJob(req.params.id);
      await requireContact(job.id, req.params.contactId);
      const contact = await peopleRepo.updateContact(
        job.id,
        req.params.contactId,
        parsed.data,
      );
      if (!contact) throw notFound("Job contact not found");
      ok(res, contact);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.delete(
  "/:id/contacts/:contactId",
  async (req: Request, res: Response) => {
    const route = "DELETE /api/jobs/:id/contacts/:contactId";
    try {
      const job = await requireJob(req.params.id);
      const deleted = await peopleRepo.deleteContact(
        job.id,
        req.params.contactId,
      );
      if (!deleted) throw notFound("Job contact not found");
      ok(res, undefined);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.post(
  "/:id/contacts/:contactId/outreach",
  async (req: Request, res: Response) => {
    const route = "POST /api/jobs/:id/contacts/:contactId/outreach";
    try {
      const parsed = outreachCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(
          res,
          badRequest("Invalid outreach draft", parsed.error.flatten()),
        );
      }
      const job = await requireJob(req.params.id);
      await requireContact(job.id, req.params.contactId);
      const outreach = await peopleRepo.createOutreach(
        job.id,
        req.params.contactId,
        parsed.data,
      );
      ok(res, outreach, 201);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.post(
  "/:id/contacts/:contactId/outreach/draft",
  async (req: Request, res: Response) => {
    const route = "POST /api/jobs/:id/contacts/:contactId/outreach/draft";
    try {
      const parsed = outreachDraftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return fail(
          res,
          badRequest("Invalid outreach request", parsed.error.flatten()),
        );
      }
      const job = await requireJob(req.params.id);
      const contact = await requireContact(job.id, req.params.contactId);
      const outreach = await draftJobOutreach(job, contact, parsed.data);
      ok(res, outreach, 201);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);

jobsPeopleOutreachRouter.patch(
  "/:id/outreach/:outreachId",
  async (req: Request, res: Response) => {
    const route = "PATCH /api/jobs/:id/outreach/:outreachId";
    try {
      const parsed = outreachUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(
          res,
          badRequest("Invalid outreach update", parsed.error.flatten()),
        );
      }
      const job = await requireJob(req.params.id);
      const outreach = await peopleRepo.updateOutreach(
        job.id,
        req.params.outreachId,
        parsed.data,
      );
      if (!outreach) throw notFound("Outreach draft not found");
      ok(res, outreach);
    } catch (error) {
      routeFailure(req, res, route, error);
    }
  },
);
