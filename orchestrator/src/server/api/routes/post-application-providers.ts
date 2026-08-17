import { createHash, randomBytes, randomUUID } from "node:crypto";
import { badRequest, serviceUnavailable, upstreamError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { executePostApplicationProviderAction } from "@server/services/post-application/providers";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import {
  POST_APPLICATION_PROVIDER_ACTIONS,
  POST_APPLICATION_PROVIDERS,
} from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

const providerActionParamsSchema = z.object({
  provider: z.enum(POST_APPLICATION_PROVIDERS),
  action: z.enum(POST_APPLICATION_PROVIDER_ACTIONS),
});

const accountBodySchema = z.object({
  accountKey: z.string().min(1).max(255).optional(),
});

const connectBodySchema = accountBodySchema.extend({
  payload: z.record(z.string(), z.unknown()).optional(),
});

const syncBodySchema = accountBodySchema.extend({
  maxMessages: z.number().int().min(1).max(500).optional(),
  searchDays: z.number().int().min(1).max(365).optional(),
});

const oauthStartQuerySchema = z.object({
  accountKey: z.string().min(1).max(255).optional(),
});

const oauthExchangeBodySchema = z.object({
  accountKey: z.string().min(1).max(255).optional(),
  state: z.string().min(1),
  code: z.string().min(1),
});

export const postApplicationProvidersRouter = Router();

const GMAIL_OAUTH_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const OUTLOOK_OAUTH_SCOPE = "offline_access User.Read Mail.Read";
const oauthStateStore = new Map<
  string,
  {
    provider: "gmail" | "outlook";
    accountKey: string;
    tenantId: string;
    userId: string | null;
    redirectUri: string;
    createdAt: number;
    codeVerifier?: string;
    authorityTenant?: string;
  }
>();

function getOauthStateTtlMs(): number {
  const parsed = Number.parseInt(
    process.env.POST_APPLICATION_OAUTH_STATE_TTL_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

function getOauthStateMaxEntries(): number {
  const parsed = Number.parseInt(
    process.env.POST_APPLICATION_OAUTH_STATE_MAX_ENTRIES ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function cleanupOauthState(): void {
  const now = Date.now();
  const ttlMs = getOauthStateTtlMs();
  for (const [state, entry] of oauthStateStore.entries()) {
    if (now - entry.createdAt > ttlMs) {
      oauthStateStore.delete(state);
    }
  }
}

function enforceOauthStateStoreLimit(): void {
  const maxEntries = getOauthStateMaxEntries();
  if (oauthStateStore.size < maxEntries) return;

  const overflowCount = oauthStateStore.size - maxEntries + 1;
  const sortedEntries = Array.from(oauthStateStore.entries()).sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  for (const [state] of sortedEntries.slice(0, overflowCount)) {
    oauthStateStore.delete(state);
  }
  logger.warn("Evicted OAuth states to enforce memory limit", {
    route: "post-application/providers/gmail/oauth/start",
    oauthStateMaxEntries: maxEntries,
    evictedCount: overflowCount,
    remaining: oauthStateStore.size,
  });
}

function setOauthState(
  state: string,
  entry: {
    provider: "gmail" | "outlook";
    accountKey: string;
    tenantId: string;
    userId: string | null;
    redirectUri: string;
    createdAt: number;
    codeVerifier?: string;
    authorityTenant?: string;
  },
): void {
  cleanupOauthState();
  enforceOauthStateStoreLimit();
  oauthStateStore.set(state, entry);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function resolveGmailOauthConfig(req: Request): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = asNonEmptyString(process.env.GMAIL_OAUTH_CLIENT_ID);
  const clientSecret = asNonEmptyString(process.env.GMAIL_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw serviceUnavailable(
      "Gmail OAuth is not configured. Missing GMAIL_OAUTH_CLIENT_ID or GMAIL_OAUTH_CLIENT_SECRET.",
    );
  }

  const configuredRedirectUri = asNonEmptyString(
    process.env.GMAIL_OAUTH_REDIRECT_URI,
  );
  const origin = `${req.protocol}://${req.get("host")}`;
  const redirectUri = configuredRedirectUri ?? `${origin}/oauth/gmail/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

function resolveOutlookOauthConfig(req: Request): {
  clientId: string;
  tenant: string;
  redirectUri: string;
} {
  const clientId = asNonEmptyString(process.env.OUTLOOK_OAUTH_CLIENT_ID);
  if (!clientId) {
    throw serviceUnavailable(
      "Outlook OAuth is not configured. Missing OUTLOOK_OAUTH_CLIENT_ID.",
    );
  }
  const tenant =
    asNonEmptyString(process.env.OUTLOOK_OAUTH_TENANT) ?? "consumers";
  const configuredRedirectUri = asNonEmptyString(
    process.env.OUTLOOK_OAUTH_REDIRECT_URI,
  );
  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    clientId,
    tenant,
    redirectUri: configuredRedirectUri ?? `${origin}/oauth/outlook/callback`,
  };
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function exchangeGmailAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
}> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw upstreamError("Google OAuth token exchange failed.");
  }

  const refreshToken = asNonEmptyString(data.refresh_token);
  if (!refreshToken) {
    throw upstreamError(
      "Google OAuth exchange did not return a refresh token. Re-consent is required.",
    );
  }

  const accessToken = asNonEmptyString(data.access_token) ?? undefined;
  const expiryIn = Number(data.expires_in);
  return {
    refreshToken,
    ...(accessToken ? { accessToken } : {}),
    ...(Number.isFinite(expiryIn)
      ? { expiryDate: Date.now() + expiryIn * 1000 }
      : {}),
    ...(asNonEmptyString(data.scope) ? { scope: String(data.scope) } : {}),
    ...(asNonEmptyString(data.token_type)
      ? { tokenType: String(data.token_type) }
      : {}),
  };
}

async function fetchGmailUserProfile(accessToken: string): Promise<{
  email?: string;
  displayName?: string;
}> {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) return {};
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const email = asNonEmptyString(data.email) ?? undefined;
  const displayName =
    asNonEmptyString(data.name) ??
    asNonEmptyString(data.given_name) ??
    undefined;
  return {
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

async function exchangeOutlookAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  clientId: string;
  tenant: string;
  codeVerifier: string;
}): Promise<{
  refreshToken: string;
  accessToken: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  tenant: string;
}> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
    code_verifier: args.codeVerifier,
    scope: OUTLOOK_OAUTH_SCOPE,
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(args.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw upstreamError("Microsoft OAuth token exchange failed.");
  }
  const refreshToken = asNonEmptyString(data.refresh_token);
  const accessToken = asNonEmptyString(data.access_token);
  if (!refreshToken || !accessToken) {
    throw upstreamError(
      "Microsoft OAuth exchange did not return the required tokens.",
    );
  }
  const expiryIn = Number(data.expires_in);
  return {
    refreshToken,
    accessToken,
    tenant: args.tenant,
    ...(Number.isFinite(expiryIn)
      ? { expiryDate: Date.now() + expiryIn * 1000 }
      : {}),
    ...(asNonEmptyString(data.scope) ? { scope: String(data.scope) } : {}),
    ...(asNonEmptyString(data.token_type)
      ? { tokenType: String(data.token_type) }
      : {}),
  };
}

async function fetchOutlookUserProfile(accessToken: string): Promise<{
  email?: string;
  displayName?: string;
}> {
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return {};
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const email =
    asNonEmptyString(data.mail) ??
    asNonEmptyString(data.userPrincipalName) ??
    undefined;
  const displayName = asNonEmptyString(data.displayName) ?? undefined;
  return {
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

postApplicationProvidersRouter.get(
  "/providers/gmail/oauth/start",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      cleanupOauthState();
      const parsed = oauthStartQuerySchema.parse(req.query);
      const accountKey = parsed.accountKey ?? "default";
      const oauth = resolveGmailOauthConfig(req);
      const state = randomUUID();
      const scope = getPrivateDataScope();

      setOauthState(state, {
        provider: "gmail",
        accountKey,
        tenantId: scope.tenantId,
        userId: scope.enforceUserIsolation ? scope.userId : null,
        redirectUri: oauth.redirectUri,
        createdAt: Date.now(),
      });

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", oauth.clientId);
      authUrl.searchParams.set("redirect_uri", oauth.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GMAIL_OAUTH_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("include_granted_scopes", "true");

      ok(res, {
        provider: "gmail",
        accountKey,
        authorizationUrl: authUrl.toString(),
        state,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }
  }),
);

postApplicationProvidersRouter.post(
  "/providers/gmail/oauth/exchange",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      cleanupOauthState();
      const body = oauthExchangeBodySchema.parse(req.body ?? {});
      const accountKey = body.accountKey ?? "default";
      const oauthState = oauthStateStore.get(body.state);

      if (!oauthState) {
        fail(res, badRequest("OAuth state is invalid or expired."));
        return;
      }
      oauthStateStore.delete(body.state);

      if (oauthState.provider !== "gmail") {
        fail(res, badRequest("OAuth state/provider mismatch."));
        return;
      }

      if (oauthState.accountKey !== accountKey) {
        fail(res, badRequest("OAuth state/account mismatch."));
        return;
      }
      const scope = getPrivateDataScope();
      if (oauthState.tenantId !== scope.tenantId) {
        fail(res, badRequest("OAuth state/workspace mismatch."));
        return;
      }
      if (scope.enforceUserIsolation && oauthState.userId !== scope.userId) {
        fail(res, badRequest("OAuth state/user mismatch."));
        return;
      }

      const oauth = resolveGmailOauthConfig(req);
      const tokenPayload = await exchangeGmailAuthorizationCode({
        code: body.code,
        redirectUri: oauthState.redirectUri,
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
      });
      const profile = tokenPayload.accessToken
        ? await fetchGmailUserProfile(tokenPayload.accessToken)
        : {};

      const response = await executePostApplicationProviderAction({
        provider: "gmail",
        action: "connect",
        accountKey,
        connectPayload: {
          accountKey,
          payload: {
            ...tokenPayload,
            ...profile,
          },
        },
        syncPayload: undefined,
        initiatedBy: null,
      });

      ok(res, response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }
  }),
);

postApplicationProvidersRouter.get(
  "/providers/outlook/oauth/start",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      cleanupOauthState();
      const parsed = oauthStartQuerySchema.parse(req.query);
      const accountKey = parsed.accountKey ?? "default";
      const oauth = resolveOutlookOauthConfig(req);
      const state = randomUUID();
      const pkce = createPkce();
      const scope = getPrivateDataScope();
      setOauthState(state, {
        provider: "outlook",
        accountKey,
        tenantId: scope.tenantId,
        userId: scope.enforceUserIsolation ? scope.userId : null,
        redirectUri: oauth.redirectUri,
        createdAt: Date.now(),
        codeVerifier: pkce.verifier,
        authorityTenant: oauth.tenant,
      });

      const authUrl = new URL(
        `https://login.microsoftonline.com/${encodeURIComponent(oauth.tenant)}/oauth2/v2.0/authorize`,
      );
      authUrl.searchParams.set("client_id", oauth.clientId);
      authUrl.searchParams.set("redirect_uri", oauth.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("scope", OUTLOOK_OAUTH_SCOPE);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", pkce.challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      ok(res, {
        provider: "outlook",
        accountKey,
        authorizationUrl: authUrl.toString(),
        state,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }
  }),
);

postApplicationProvidersRouter.post(
  "/providers/outlook/oauth/exchange",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      cleanupOauthState();
      const body = oauthExchangeBodySchema.parse(req.body ?? {});
      const accountKey = body.accountKey ?? "default";
      const oauthState = oauthStateStore.get(body.state);
      if (!oauthState) {
        fail(res, badRequest("OAuth state is invalid or expired."));
        return;
      }
      oauthStateStore.delete(body.state);
      if (oauthState.provider !== "outlook") {
        fail(res, badRequest("OAuth state/provider mismatch."));
        return;
      }
      if (oauthState.accountKey !== accountKey) {
        fail(res, badRequest("OAuth state/account mismatch."));
        return;
      }
      const scope = getPrivateDataScope();
      if (oauthState.tenantId !== scope.tenantId) {
        fail(res, badRequest("OAuth state/workspace mismatch."));
        return;
      }
      if (scope.enforceUserIsolation && oauthState.userId !== scope.userId) {
        fail(res, badRequest("OAuth state/user mismatch."));
        return;
      }
      if (!oauthState.codeVerifier || !oauthState.authorityTenant) {
        fail(res, badRequest("OAuth PKCE state is incomplete."));
        return;
      }

      const oauth = resolveOutlookOauthConfig(req);
      const tokenPayload = await exchangeOutlookAuthorizationCode({
        code: body.code,
        redirectUri: oauthState.redirectUri,
        clientId: oauth.clientId,
        tenant: oauthState.authorityTenant,
        codeVerifier: oauthState.codeVerifier,
      });
      const profile = await fetchOutlookUserProfile(tokenPayload.accessToken);
      const response = await executePostApplicationProviderAction({
        provider: "outlook",
        action: "connect",
        accountKey,
        connectPayload: {
          accountKey,
          payload: { ...tokenPayload, ...profile },
        },
        syncPayload: undefined,
        initiatedBy: null,
      });
      ok(res, response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }
  }),
);

postApplicationProvidersRouter.post(
  "/providers/:provider/actions/:action",
  asyncRoute(async (req: Request, res: Response) => {
    let provider: (typeof POST_APPLICATION_PROVIDERS)[number];
    let action: (typeof POST_APPLICATION_PROVIDER_ACTIONS)[number];

    try {
      const parsedParams = providerActionParamsSchema.parse(req.params);
      provider = parsedParams.provider;
      action = parsedParams.action;
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }

    let accountKey: string;
    let connectPayload:
      | {
          accountKey?: string;
          payload?: Record<string, unknown>;
        }
      | undefined;
    let syncPayload:
      | {
          accountKey?: string;
          maxMessages?: number;
          searchDays?: number;
        }
      | undefined;

    try {
      if (action === "connect") {
        const parsedBody = connectBodySchema.parse(req.body ?? {});
        accountKey = parsedBody.accountKey ?? "default";
        connectPayload = {
          ...(parsedBody.accountKey
            ? { accountKey: parsedBody.accountKey }
            : {}),
          ...(parsedBody.payload ? { payload: parsedBody.payload } : {}),
        };
      } else if (action === "sync") {
        const parsedBody = syncBodySchema.parse(req.body ?? {});
        accountKey = parsedBody.accountKey ?? "default";
        syncPayload = {
          ...(parsedBody.accountKey
            ? { accountKey: parsedBody.accountKey }
            : {}),
          ...(typeof parsedBody.maxMessages === "number"
            ? { maxMessages: parsedBody.maxMessages }
            : {}),
          ...(typeof parsedBody.searchDays === "number"
            ? { searchDays: parsedBody.searchDays }
            : {}),
        };
      } else {
        const parsedBody = accountBodySchema.parse(req.body ?? {});
        accountKey = parsedBody.accountKey ?? "default";
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        fail(res, badRequest(error.message, error.flatten()));
        return;
      }
      throw error;
    }

    const response = await executePostApplicationProviderAction({
      provider,
      action,
      accountKey,
      connectPayload,
      syncPayload,
      initiatedBy: null,
    });

    ok(res, response);
  }),
);
