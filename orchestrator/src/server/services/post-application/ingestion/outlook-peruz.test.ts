import { describe, expect, it, vi } from "vitest";
import {
  OutlookPeruzClient,
  type OutlookPeruzCommandRunner,
} from "./outlook-peruz";

function runnerWith(outputs: unknown[]): OutlookPeruzCommandRunner {
  return {
    run: vi.fn().mockImplementation(async () => {
      const next = outputs.shift();
      return JSON.stringify(next);
    }),
  };
}

describe("OutlookPeruzClient", () => {
  it("reads Outlook metadata from a signed-in local browser tab", async () => {
    const runner = runnerWith([
      [
        {
          id: 42,
          name: "jobops-outlook",
          url: "https://outlook.live.com/mail/0/inbox",
          title: "Mail - Candidate - Outlook",
        },
      ],
      {
        origin: "https://outlook.live.com",
        loginForm: false,
        title: "Mail - Candidate - Outlook",
      },
      [
        {
          conversationId: "conversation-1",
          senderName: "Nous Hiring Team",
          fromAddress: "jobs@nous.co",
          subject: "Your application — next steps",
          receivedLabel: new Date().toISOString(),
          snippet: "We would like to arrange an interview.",
        },
      ],
    ]);
    const client = new OutlookPeruzClient(runner);

    const messages = await client.listVisibleMessages({
      searchDays: 30,
      maxMessages: 10,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        conversationId: "conversation-1",
        senderName: "Nous Hiring Team",
        fromAddress: "jobs@nous.co",
        subject: "Your application — next steps",
      }),
    );
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it("refuses to treat a Microsoft login page as a connected inbox", async () => {
    const runner = runnerWith([
      [
        {
          tabId: 42,
          url: "https://outlook.live.com/mail/0/inbox",
        },
      ],
      {
        origin: "https://outlook.live.com",
        loginForm: true,
      },
    ]);

    await expect(
      new OutlookPeruzClient(runner).validateSession(),
    ).rejects.toThrow("not signed in");
  });

  it("rejects when no Outlook tab is open", async () => {
    const runner = runnerWith([
      [{ tabId: 7, url: "https://example.com", title: "Example" }],
    ]);

    await expect(
      new OutlookPeruzClient(runner).validateSession(),
    ).rejects.toThrow("No Outlook tab");
  });
});
