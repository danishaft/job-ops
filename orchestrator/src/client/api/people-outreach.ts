import type {
  CreateJobContactInput,
  CreateJobOutreachInput,
  JobContact,
  JobContactResearchResult,
  JobOutreach,
  JobOutreachChannel,
  JobOutreachPurpose,
  JobPeopleOutreach,
  UpdateJobContactInput,
  UpdateJobOutreachInput,
} from "@shared/types";
import { fetchApi, withQuery } from "./core";

export async function getJobPeopleOutreach(
  jobId: string,
): Promise<JobPeopleOutreach> {
  return fetchApi<JobPeopleOutreach>(
    withQuery(`/jobs/${jobId}/people-outreach`, { t: Date.now() }),
  );
}

export async function researchJobContacts(
  jobId: string,
  sourceUrls?: string[],
): Promise<JobContactResearchResult> {
  return fetchApi<JobContactResearchResult>(
    `/jobs/${jobId}/contacts/research`,
    {
      method: "POST",
      body: JSON.stringify({ sourceUrls }),
    },
  );
}

export async function createJobContact(
  jobId: string,
  input: CreateJobContactInput,
): Promise<JobContact> {
  return fetchApi<JobContact>(`/jobs/${jobId}/contacts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateJobContact(
  jobId: string,
  contactId: string,
  input: UpdateJobContactInput,
): Promise<JobContact> {
  return fetchApi<JobContact>(`/jobs/${jobId}/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteJobContact(
  jobId: string,
  contactId: string,
): Promise<void> {
  return fetchApi<void>(`/jobs/${jobId}/contacts/${contactId}`, {
    method: "DELETE",
  });
}

export async function createJobOutreach(
  jobId: string,
  contactId: string,
  input: CreateJobOutreachInput,
): Promise<JobOutreach> {
  return fetchApi<JobOutreach>(
    `/jobs/${jobId}/contacts/${contactId}/outreach`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function draftJobOutreach(
  jobId: string,
  contactId: string,
  input?: {
    purpose?: JobOutreachPurpose;
    channel?: JobOutreachChannel;
  },
): Promise<JobOutreach> {
  return fetchApi<JobOutreach>(
    `/jobs/${jobId}/contacts/${contactId}/outreach/draft`,
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    },
  );
}

export async function updateJobOutreach(
  jobId: string,
  outreachId: string,
  input: UpdateJobOutreachInput,
): Promise<JobOutreach> {
  return fetchApi<JobOutreach>(`/jobs/${jobId}/outreach/${outreachId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
