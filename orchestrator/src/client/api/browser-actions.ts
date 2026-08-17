import type {
  BrowserInspectionResult,
  BrowserInspectKind,
  BrowserPrefillResult,
} from "@shared/types";
import { fetchApi } from "./core";

export function inspectWithPeruz(input: {
  url: string;
  kind: BrowserInspectKind;
}): Promise<BrowserInspectionResult> {
  return fetchApi<BrowserInspectionResult>("/browser-actions/inspect", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function prefillWithPeruz(jobId: string): Promise<BrowserPrefillResult> {
  return fetchApi<BrowserPrefillResult>("/browser-actions/prefill", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });
}
