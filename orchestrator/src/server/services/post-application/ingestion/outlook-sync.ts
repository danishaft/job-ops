import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import { getAllJobs } from "@server/repositories/jobs";
import {
  getPostApplicationIntegration,
  updatePostApplicationIntegrationSyncState,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import {
  getPostApplicationMessageByExternalId,
  upsertPostApplicationMessage,
} from "@server/repositories/post-application-messages";
import {
  completePostApplicationSyncRun,
  startPostApplicationSyncRun,
} from "@server/repositories/post-application-sync-runs";
import { transitionStage } from "@server/services/applicationTracking";
import { resolveStageTransitionForTarget } from "@server/services/post-application/stage-target";
import type { PostApplicationRouterStageTarget } from "@shared/types";
import { classifyWithLocalRules } from "./deterministic-email-router";
import { minifyActiveJobs } from "./email-router";
import {
  listOutlookMessages,
  type OutlookCredentials,
  resolveOutlookAccessToken,
} from "./outlook-api";
import { OutlookPeruzClient } from "./outlook-peruz";

const DEFAULT_SEARCH_DAYS = 90;
const DEFAULT_MAX_MESSAGES = 100;

export type OutlookSyncSummary = {
  discovered: number;
  relevant: number;
  classified: number;
  errored: number;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCredentials(
  credentials: Record<string, unknown> | null,
):
  | (OutlookCredentials & { connectionMode: "graph" })
  | { connectionMode: "peruz" }
  | null {
  if (!credentials) return null;
  if (asString(credentials.connectionMode) === "peruz") {
    return { connectionMode: "peruz" };
  }
  const refreshToken = asString(credentials.refreshToken);
  if (!refreshToken) return null;
  return {
    refreshToken,
    tenant: asString(credentials.tenant) ?? "consumers",
    accessToken: asString(credentials.accessToken),
    expiryDate:
      typeof credentials.expiryDate === "number" &&
      Number.isFinite(credentials.expiryDate)
        ? credentials.expiryDate
        : undefined,
    scope: asString(credentials.scope),
    tokenType: asString(credentials.tokenType),
    email: asString(credentials.email),
    connectionMode: "graph",
  };
}

type IngestibleOutlookMessage = {
  id: string;
  conversationId: string | null;
  fromAddress: string;
  senderName: string | null;
  subject: string;
  receivedAt: number;
  snippet: string;
  webLink: string | null;
};

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function createAutoStageEvent(args: {
  jobId: string;
  stageTarget: PostApplicationRouterStageTarget;
  receivedAt: number;
}): Promise<void> {
  void trackServerProductEvent(
    "tracking_email_matched",
    {
      provider: "outlook",
      match_mode: "auto_link",
      stage_target: args.stageTarget,
      result: "success",
    },
    { urlPath: "/tracking-inbox" },
  );

  const transition = resolveStageTransitionForTarget(args.stageTarget);
  if (transition.toStage === "no_change") return;
  transitionStage(
    args.jobId,
    transition.toStage,
    Math.floor(args.receivedAt / 1000),
    {
      actor: "system",
      eventType: "status_update",
      eventLabel:
        args.stageTarget === "applied"
          ? "Email received"
          : `Logged from email: ${args.stageTarget}`,
      note: "Auto-created from local Outlook routing.",
      reasonCode: transition.reasonCode ?? "post_application_auto_linked",
    },
    transition.outcome,
  );
}

export async function runOutlookIngestionSync(args: {
  accountKey: string;
  maxMessages?: number;
  searchDays?: number;
}): Promise<OutlookSyncSummary> {
  const integration = await getPostApplicationIntegration(
    "outlook",
    args.accountKey,
  );
  const credentials = parseCredentials(integration?.credentials ?? null);
  if (!integration || !credentials) {
    throw new Error(`Outlook account '${args.accountKey}' is not connected.`);
  }

  const maxMessages = Math.max(1, args.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const searchDays = Math.max(1, args.searchDays ?? DEFAULT_SEARCH_DAYS);
  const syncRun = await startPostApplicationSyncRun({
    provider: "outlook",
    accountKey: args.accountKey,
    integrationId: integration.id,
  });
  let discovered = 0;
  let relevant = 0;
  let classified = 0;
  let matched = 0;
  let errored = 0;

  try {
    let messagePromise: Promise<IngestibleOutlookMessage[]>;
    if (credentials.connectionMode === "peruz") {
      messagePromise = new OutlookPeruzClient()
        .listVisibleMessages({ searchDays, maxMessages })
        .then((messages) =>
          messages.map((message) => ({
            id: message.id,
            conversationId: message.conversationId,
            fromAddress: message.fromAddress.toLowerCase(),
            senderName: message.senderName || null,
            subject: message.subject,
            receivedAt: message.receivedAt,
            snippet: message.snippet,
            webLink: message.webLink,
          })),
        );
    } else {
      const resolved = await resolveOutlookAccessToken(credentials);
      if (!resolved.accessToken) {
        throw new Error("Outlook sync failed to resolve an access token.");
      }
      if (
        resolved.accessToken !== credentials.accessToken ||
        resolved.refreshToken !== credentials.refreshToken ||
        resolved.expiryDate !== credentials.expiryDate
      ) {
        await upsertConnectedPostApplicationIntegration({
          provider: "outlook",
          accountKey: args.accountKey,
          displayName: integration.displayName,
          credentials: { ...resolved, connectionMode: "graph" },
        });
      }
      messagePromise = listOutlookMessages({
        accessToken: resolved.accessToken,
        searchDays,
        maxMessages,
      }).then((messages) =>
        messages.map((message) => {
          const fromAddress = (
            message.from?.emailAddress?.address ?? ""
          ).toLowerCase();
          const receivedAt = Date.parse(message.receivedDateTime);
          return {
            id: message.id,
            conversationId: message.conversationId ?? null,
            fromAddress,
            senderName: message.from?.emailAddress?.name ?? null,
            subject: message.subject ?? "",
            receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
            snippet: message.bodyPreview ?? "",
            webLink: message.webLink ?? null,
          };
        }),
      );
    }

    const [messages, jobs] = await Promise.all([
      messagePromise,
      getAllJobs(["applied", "in_progress", "processing"]),
    ]);
    const activeJobs = minifyActiveJobs(jobs);
    const activeJobIds = new Set(activeJobs.map((job) => job.id));

    for (const outlookMessage of messages) {
      discovered += 1;
      try {
        const existing = await getPostApplicationMessageByExternalId(
          "outlook",
          args.accountKey,
          outlookMessage.id,
        );
        const fromAddress = outlookMessage.fromAddress;
        const fromDomain = fromAddress.includes("@")
          ? (fromAddress.split("@").pop() ?? null)
          : null;
        const safeReceivedAt = outlookMessage.receivedAt;

        if (existing && existing.processingStatus !== "pending_user") {
          const result = await upsertPostApplicationMessage({
            provider: "outlook",
            accountKey: args.accountKey,
            integrationId: integration.id,
            syncRunId: syncRun.id,
            externalMessageId: outlookMessage.id,
            externalThreadId: outlookMessage.conversationId,
            fromAddress,
            fromDomain,
            senderName: outlookMessage.senderName,
            subject: outlookMessage.subject,
            receivedAt: safeReceivedAt,
            snippet: outlookMessage.snippet,
            classificationLabel: existing.classificationLabel,
            classificationConfidence: existing.classificationConfidence,
            classificationPayload: existing.classificationPayload,
            relevanceLlmScore: existing.relevanceLlmScore,
            relevanceDecision: existing.relevanceDecision,
            matchedJobId: existing.matchedJobId,
            matchConfidence: existing.matchConfidence,
            stageTarget: existing.stageTarget,
            messageType: existing.messageType,
            stageEventPayload: existing.stageEventPayload,
            processingStatus: existing.processingStatus,
            existingMessage: existing,
          });
          if (result.message.processingStatus !== "ignored") relevant += 1;
          if (result.message.matchedJobId) matched += 1;
          classified += 1;
          continue;
        }

        const routing = classifyWithLocalRules({
          fromAddress,
          fromDomain,
          senderName: outlookMessage.senderName,
          subject: outlookMessage.subject,
          snippet: outlookMessage.snippet,
          activeJobs,
        });
        const matchedJobId =
          routing.bestMatchId && activeJobIds.has(routing.bestMatchId)
            ? routing.bestMatchId
            : null;
        const isAutoLinked = Boolean(matchedJobId && routing.confidence >= 95);
        const processingStatus = isAutoLinked
          ? "auto_linked"
          : routing.isRelevant
            ? "pending_user"
            : "ignored";
        const result = await upsertPostApplicationMessage({
          provider: "outlook",
          accountKey: args.accountKey,
          integrationId: integration.id,
          syncRunId: syncRun.id,
          externalMessageId: outlookMessage.id,
          externalThreadId: outlookMessage.conversationId,
          fromAddress,
          fromDomain,
          senderName: outlookMessage.senderName,
          subject: outlookMessage.subject,
          receivedAt: safeReceivedAt,
          snippet: outlookMessage.snippet,
          classificationLabel: routing.stageTarget,
          classificationConfidence: routing.confidence / 100,
          classificationPayload: {
            method: "local_rules",
            reason: routing.reason,
            sourceUrl: outlookMessage.webLink,
          },
          relevanceLlmScore: null,
          relevanceDecision: routing.isRelevant ? "relevant" : "not_relevant",
          matchedJobId,
          matchConfidence: routing.confidence,
          stageTarget: routing.stageTarget,
          messageType: routing.messageType,
          stageEventPayload: routing.stageEventPayload,
          processingStatus,
        });
        if (result.message.processingStatus !== "ignored") relevant += 1;
        if (result.message.matchedJobId) matched += 1;
        classified += 1;
        if (result.autoLinkTransitioned && result.message.matchedJobId) {
          await createAutoStageEvent({
            jobId: result.message.matchedJobId,
            stageTarget: result.message.stageTarget ?? "no_change",
            receivedAt: result.message.receivedAt,
          });
        }
      } catch (error) {
        errored += 1;
        logger.warn("Failed to ingest Outlook message", {
          provider: "outlook",
          accountKey: args.accountKey,
          externalMessageId: outlookMessage.id,
          syncRunId: syncRun.id,
          error: normalizeErrorMessage(error),
        });
      }
    }

    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "completed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "outlook",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: null,
      status: "connected",
    });
    return { discovered, relevant, classified, errored };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "failed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
      errorCode: "OUTLOOK_SYNC_FAILED",
      errorMessage,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "outlook",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: errorMessage,
      status: "error",
    });
    throw error;
  }
}
