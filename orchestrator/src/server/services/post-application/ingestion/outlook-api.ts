import { providerUpstreamError } from "@server/services/post-application/providers/errors";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 15_000;

export type OutlookCredentials = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  email?: string;
  tenant: string;
};

export type OutlookMessage = {
  id: string;
  conversationId?: string;
  receivedDateTime: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  from?: {
    emailAddress?: { name?: string; address?: string };
  };
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function outlookApi<T>(
  accessToken: string,
  url: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw providerUpstreamError(
        `Microsoft Graph request failed with HTTP ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw providerUpstreamError("Microsoft Graph request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveOutlookAccessToken(
  credentials: OutlookCredentials,
): Promise<OutlookCredentials> {
  if (
    credentials.accessToken &&
    credentials.expiryDate &&
    credentials.expiryDate > Date.now() + 60_000
  ) {
    return credentials;
  }

  const clientId = nonEmptyString(process.env.OUTLOOK_OAUTH_CLIENT_ID);
  if (!clientId) {
    throw new Error("Outlook OAuth is not configured.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
    scope: "offline_access User.Read Mail.Read",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw providerUpstreamError("Microsoft OAuth token refresh failed.");
  }
  const accessToken = nonEmptyString(data.access_token);
  if (!accessToken) {
    throw providerUpstreamError(
      "Microsoft OAuth token refresh returned no access token.",
    );
  }
  const expiresIn = Number(data.expires_in);
  return {
    ...credentials,
    accessToken,
    refreshToken:
      nonEmptyString(data.refresh_token) ?? credentials.refreshToken,
    expiryDate: Number.isFinite(expiresIn)
      ? Date.now() + expiresIn * 1000
      : credentials.expiryDate,
    scope: nonEmptyString(data.scope) ?? credentials.scope,
    tokenType: nonEmptyString(data.token_type) ?? credentials.tokenType,
  };
}

export async function listOutlookMessages(args: {
  accessToken: string;
  searchDays: number;
  maxMessages: number;
}): Promise<OutlookMessage[]> {
  const cutoff = Date.now() - args.searchDays * 24 * 60 * 60 * 1000;
  const select = [
    "id",
    "conversationId",
    "receivedDateTime",
    "from",
    "subject",
    "bodyPreview",
    "webLink",
  ].join(",");
  let nextUrl: string | null =
    `${GRAPH_BASE_URL}/me/mailFolders/inbox/messages` +
    `?$select=${encodeURIComponent(select)}&$orderby=receivedDateTime%20desc&$top=${Math.min(100, args.maxMessages)}`;
  const messages: OutlookMessage[] = [];

  while (nextUrl && messages.length < args.maxMessages) {
    const page: {
      value?: OutlookMessage[];
      "@odata.nextLink"?: string;
    } = await outlookApi(args.accessToken, nextUrl);
    const pageMessages = page.value ?? [];
    for (const message of pageMessages) {
      const receivedAt = Date.parse(message.receivedDateTime);
      if (Number.isFinite(receivedAt) && receivedAt < cutoff) return messages;
      messages.push(message);
      if (messages.length >= args.maxMessages) return messages;
    }
    nextUrl = page["@odata.nextLink"] ?? null;
    if (pageMessages.length === 0) break;
  }

  return messages;
}
