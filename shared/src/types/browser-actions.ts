export type BrowserInspectKind = "role" | "company" | "contact";

export interface BrowserInspectionResult {
  kind: BrowserInspectKind;
  url: string;
  pageText: string;
  inspectedAt: string;
}

export interface BrowserPrefillFieldResult {
  field: string;
  status: "filled" | "not_found";
}

export interface BrowserPrefillResult {
  jobId: string;
  url: string;
  windowId: string;
  fields: BrowserPrefillFieldResult[];
  humanActionRequired: true;
  submissionPerformed: false;
}
