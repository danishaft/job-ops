import { logger } from "@infra/logger";
import {
  disconnectPostApplicationIntegration,
  getPostApplicationIntegration,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import { OutlookPeruzClient } from "@server/services/post-application/ingestion/outlook-peruz";
import { runOutlookIngestionSync } from "@server/services/post-application/ingestion/outlook-sync";
import type { PostApplicationIntegration } from "@shared/types";
import { providerInvalidRequest } from "./errors";
import type {
  PostApplicationProviderActionResult,
  PostApplicationProviderAdapter,
  PostApplicationProviderConnectArgs,
} from "./types";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function publicIntegration(
  integration: PostApplicationIntegration | null,
): PostApplicationIntegration | null {
  if (!integration) return null;
  const credentials = integration.credentials ?? {};
  return {
    ...integration,
    credentials: {
      hasRefreshToken: Boolean(asString(credentials.refreshToken)),
      hasAccessToken: Boolean(asString(credentials.accessToken)),
      expiryDate: asNumber(credentials.expiryDate) ?? null,
      scope: asString(credentials.scope) ?? null,
      tokenType: asString(credentials.tokenType) ?? null,
      email: asString(credentials.email) ?? null,
      tenant: asString(credentials.tenant) ?? "consumers",
      connectionMode: asString(credentials.connectionMode) ?? "graph",
    },
  };
}

function status(
  accountKey: string,
  integration: PostApplicationIntegration | null,
  message?: string,
): PostApplicationProviderActionResult {
  const safeIntegration = publicIntegration(integration);
  return {
    status: {
      provider: "outlook",
      accountKey,
      connected:
        safeIntegration?.status === "connected" &&
        (Boolean(safeIntegration.credentials?.hasRefreshToken) ||
          safeIntegration.credentials?.connectionMode === "peruz"),
      integration: safeIntegration,
    },
    message,
  };
}

function parseConnectPayload(args: PostApplicationProviderConnectArgs) {
  const raw = args.payload?.payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw providerInvalidRequest("Outlook OAuth credentials are missing.");
  }
  const credentials = raw as Record<string, unknown>;
  const connectionMode = asString(credentials.connectionMode);
  if (connectionMode === "peruz") {
    return {
      connectionMode,
      displayName: asString(credentials.displayName) ?? "Outlook Web (Peruz)",
      email: undefined,
    };
  }
  const refreshToken = asString(credentials.refreshToken);
  if (!refreshToken) {
    throw providerInvalidRequest("Outlook OAuth returned no refresh token.");
  }
  return {
    refreshToken,
    accessToken: asString(credentials.accessToken),
    expiryDate: asNumber(credentials.expiryDate),
    scope: asString(credentials.scope),
    tokenType: asString(credentials.tokenType),
    email: asString(credentials.email),
    displayName: asString(credentials.displayName),
    tenant: asString(credentials.tenant) ?? "consumers",
    connectionMode: "graph",
  };
}

export const outlookProvider: PostApplicationProviderAdapter = {
  key: "outlook",
  async connect(args) {
    const credentials = parseConnectPayload(args);
    if (credentials.connectionMode === "peruz") {
      await new OutlookPeruzClient().validateSession();
    }
    const integration = await upsertConnectedPostApplicationIntegration({
      provider: "outlook",
      accountKey: args.accountKey,
      displayName:
        credentials.displayName ??
        credentials.email ??
        `Outlook (${args.accountKey})`,
      credentials,
    });
    logger.info("Outlook integration connected", {
      provider: "outlook",
      accountKey: args.accountKey,
      integrationId: integration.id,
    });
    return status(
      args.accountKey,
      integration,
      "Outlook integration connected.",
    );
  },
  async status(args) {
    const integration = await getPostApplicationIntegration(
      "outlook",
      args.accountKey,
    );
    return status(
      args.accountKey,
      integration,
      integration ? undefined : "Outlook provider is not connected.",
    );
  },
  async sync(args) {
    if (!(await getPostApplicationIntegration("outlook", args.accountKey))) {
      throw providerInvalidRequest(
        `Outlook account '${args.accountKey}' is not connected.`,
      );
    }
    const summary = await runOutlookIngestionSync({
      accountKey: args.accountKey,
      maxMessages: args.payload?.maxMessages,
      searchDays: args.payload?.searchDays,
    });
    const integration = await getPostApplicationIntegration(
      "outlook",
      args.accountKey,
    );
    return status(
      args.accountKey,
      integration,
      `Sync complete: discovered=${summary.discovered}, relevant=${summary.relevant}, classified=${summary.classified}, errored=${summary.errored}.`,
    );
  },
  async disconnect(args) {
    const integration = await disconnectPostApplicationIntegration(
      "outlook",
      args.accountKey,
    );
    logger.info("Outlook integration disconnected locally", {
      provider: "outlook",
      accountKey: args.accountKey,
      integrationId: integration?.id ?? null,
    });
    return status(
      args.accountKey,
      integration,
      "Outlook integration disconnected and local tokens removed.",
    );
  },
};
