import { badRequest, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import {
  type BrowserPrefillField,
  BrowserTargetError,
  PeruzBrowserAdapter,
} from "@server/services/browser-actions/peruz";
import { getProfile } from "@server/services/profile";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const browserActionsRouter = Router();
const browser = new PeruzBrowserAdapter();

const inspectSchema = z.object({
  url: z.string().trim().url().max(2000),
  kind: z.enum(["role", "company", "contact"]),
});

const prefillSchema = z.object({
  jobId: z.string().trim().min(1).max(200),
});

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function buildProfilePrefillFields(
  profile: Awaited<ReturnType<typeof getProfile>>,
) {
  const basics = profile.basics;
  const name = basics?.name?.trim() ?? "";
  const { firstName, lastName } = splitName(name);
  const location = [
    basics?.location?.address,
    basics?.location?.city,
    basics?.location?.region,
    basics?.location?.postalCode,
    basics?.location?.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
  const linkedIn = basics?.profiles?.find(
    (entry) => entry.network?.toLowerCase() === "linkedin",
  )?.url;

  const candidates: Array<BrowserPrefillField | null> = [
    name ? { field: "name", value: name, labels: ["Full name", "Name"] } : null,
    firstName
      ? {
          field: "firstName",
          value: firstName,
          labels: ["First name", "Given name"],
        }
      : null,
    lastName
      ? {
          field: "lastName",
          value: lastName,
          labels: ["Last name", "Family name", "Surname"],
        }
      : null,
    basics?.email
      ? {
          field: "email",
          value: basics.email,
          labels: ["Email", "Email address"],
        }
      : null,
    basics?.phone
      ? {
          field: "phone",
          value: basics.phone,
          labels: ["Phone", "Phone number"],
        }
      : null,
    location
      ? { field: "location", value: location, labels: ["Location", "Address"] }
      : null,
    basics?.url
      ? {
          field: "website",
          value: basics.url,
          labels: ["Website", "Portfolio", "Personal website"],
        }
      : null,
    linkedIn
      ? {
          field: "linkedIn",
          value: linkedIn,
          labels: ["LinkedIn", "LinkedIn profile"],
        }
      : null,
  ];
  return candidates.filter(
    (field): field is BrowserPrefillField => field !== null,
  );
}

browserActionsRouter.post("/inspect", async (req: Request, res: Response) => {
  try {
    const input = inspectSchema.parse(req.body ?? {});
    const result = await browser.inspect(input);
    logger.info("Peruz browser inspection completed", {
      kind: input.kind,
      host: new URL(input.url).hostname,
      pageTextLength: result.pageText.length,
    });
    ok(res, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof BrowserTargetError) {
      return fail(res, badRequest(error.message));
    }
    fail(res, toAppError(error));
  }
});

browserActionsRouter.post("/prefill", async (req: Request, res: Response) => {
  try {
    const input = prefillSchema.parse(req.body ?? {});
    const job = await jobsRepo.getJobById(input.jobId);
    if (!job) return fail(res, notFound("Job not found"));
    const url = job.applicationLink || job.jobUrl;
    if (!url)
      return fail(res, badRequest("This opportunity has no application URL."));

    const profile = await getProfile();
    const fields = buildProfilePrefillFields(profile);
    if (fields.length === 0) {
      return fail(
        res,
        badRequest("Your resume profile has no contact fields to prefill."),
      );
    }
    const result = await browser.prefill({ jobId: job.id, url, fields });
    logger.info("Peruz application prefill completed", {
      jobId: job.id,
      attemptedFieldCount: fields.length,
      filledFieldCount: result.fields.filter(
        (field) => field.status === "filled",
      ).length,
      humanActionRequired: true,
    });
    ok(res, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof BrowserTargetError) {
      return fail(res, badRequest(error.message));
    }
    fail(res, toAppError(error));
  }
});
