import { afterEach, describe, expect, it, vi } from "vitest";
import { listOutlookMessages, resolveOutlookAccessToken } from "./outlook-api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Outlook Graph API", () => {
  it("refreshes an expired token and keeps a rotated refresh token", async () => {
    vi.stubEnv("OUTLOOK_OAUTH_CLIENT_ID", "jobops-client");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
            scope: "Mail.Read",
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await resolveOutlookAccessToken({
      refreshToken: "old-refresh",
      tenant: "consumers",
    });
    expect(result.accessToken).toBe("new-access");
    expect(result.refreshToken).toBe("new-refresh");
    expect(result.expiryDate).toBeGreaterThan(Date.now());
  });

  it("lists only messages inside the requested time window", async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            value: [
              { id: "recent", receivedDateTime: recent },
              { id: "old", receivedDateTime: old },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const messages = await listOutlookMessages({
      accessToken: "access",
      searchDays: 30,
      maxMessages: 100,
    });
    expect(messages.map((message) => message.id)).toEqual(["recent"]);
  });
});
