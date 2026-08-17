import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 250_000;
const OUTLOOK_ORIGIN = "https://outlook.live.com";

const EXTRACT_VISIBLE_MESSAGES_SCRIPT = String.raw`
const rows = Array.from(document.querySelectorAll('[data-convid][role="option"]'));
return rows.map((row) => {
  const lines = (row.innerText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const descendants = Array.from(row.querySelectorAll('*'));
  const fromAddress = descendants
    .map((element) => element.getAttribute('title') || '')
    .find((title) => title.includes('@') && !title.includes(' ')) || '';
  const receivedLabel = descendants
    .map((element) => element.getAttribute('title') || '')
    .find((title) => /\d{1,2}\/\d{1,2}\/\d{4}.*\d{1,2}:\d{2}/.test(title)) || '';
  const receivedClock = receivedLabel.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/i)?.[0] || '';
  const visibleTimeIndex = lines.findIndex((line) =>
    receivedClock
      ? line.includes(receivedClock)
      : line.includes(':') && (line.includes('AM') || line.includes('PM')),
  );
  const senderIndex = visibleTimeIndex >= 2 ? visibleTimeIndex - 2 : 1;
  const subjectIndex = visibleTimeIndex >= 1 ? visibleTimeIndex - 1 : 2;
  return {
    conversationId: row.getAttribute('data-convid') || '',
    senderName: lines[senderIndex] || lines[1] || lines[0] || '',
    fromAddress,
    subject: lines[subjectIndex] || lines[2] || '',
    receivedLabel,
    snippet: lines.slice(visibleTimeIndex >= 0 ? visibleTimeIndex + 1 : 4).join(' ').slice(0, 2000),
  };
});
`;

type PeruzTab = {
  id?: number;
  tabId?: number;
  url: string;
  title?: string;
  name?: string;
};

type ExtractedMessage = {
  conversationId: string;
  senderName: string;
  fromAddress?: string;
  subject: string;
  receivedLabel: string;
  snippet: string;
};

export type OutlookPeruzMessage = {
  id: string;
  conversationId: string;
  senderName: string;
  fromAddress: string;
  subject: string;
  receivedAt: number;
  snippet: string;
  webLink: string;
};

export interface OutlookPeruzCommandRunner {
  run(args: string[], timeoutMs?: number): Promise<string>;
}

export class SpawnOutlookPeruzCommandRunner
  implements OutlookPeruzCommandRunner
{
  async run(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("peruz", args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(stdout.trim());
      };
      const append = (current: string, chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          finish(new Error("Peruz Outlook output exceeded the safety limit."));
          return current;
        }
        return current + chunk.toString("utf8");
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("Peruz Outlook request timed out."));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => finish(error));
      child.on("close", (code) => {
        if (code === 0) finish();
        else
          finish(new Error(stderr.trim() || `Peruz exited with code ${code}.`));
      });
    });
  }
}

function parseJson<T>(output: string, context: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`Peruz returned invalid JSON while ${context}.`);
  }
}

function parseReceivedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isOutlookTab(tab: PeruzTab): boolean {
  try {
    return new URL(tab.url).origin === OUTLOOK_ORIGIN;
  } catch {
    return false;
  }
}

export class OutlookPeruzClient {
  constructor(
    private readonly runner: OutlookPeruzCommandRunner = new SpawnOutlookPeruzCommandRunner(),
  ) {}

  private async resolveTab(): Promise<PeruzTab & { tabId: number }> {
    const tabs = parseJson<PeruzTab[]>(
      await this.runner.run(["tab.list", "--json"]),
      "listing browser tabs",
    );
    const named = tabs.find(
      (tab) => tab.name === "jobops-outlook" && isOutlookTab(tab),
    );
    const tab = named ?? tabs.find(isOutlookTab);
    if (!tab) {
      throw new Error(
        "No Outlook tab is open in the Peruz browser. Open Outlook Mail and sign in first.",
      );
    }
    const tabId = tab.tabId ?? tab.id;
    if (!tabId) {
      throw new Error("Peruz returned an Outlook tab without a tab ID.");
    }
    return { ...tab, tabId };
  }

  async validateSession(): Promise<{ tabId: number; title: string | null }> {
    const tab = await this.resolveTab();
    const session = parseJson<{
      origin?: string;
      loginForm?: boolean;
      title?: string;
    }>(
      await this.runner.run([
        "--tab-id",
        String(tab.tabId),
        "js",
        `return {origin: location.origin, loginForm: Boolean(document.querySelector('input[type=email], input[name=loginfmt], input[type=password]')), title: document.title}`,
        "--json",
      ]),
      "validating the Outlook session",
    );
    if (session.origin !== OUTLOOK_ORIGIN || session.loginForm) {
      throw new Error(
        "The Outlook tab is not signed in. Sign in to Outlook in the browser and retry.",
      );
    }
    return { tabId: tab.tabId, title: session.title ?? tab.title ?? null };
  }

  async listVisibleMessages(args: {
    searchDays: number;
    maxMessages: number;
  }): Promise<OutlookPeruzMessage[]> {
    const { tabId } = await this.validateSession();
    const extracted = parseJson<ExtractedMessage[]>(
      await this.runner.run([
        "--tab-id",
        String(tabId),
        "js",
        EXTRACT_VISIBLE_MESSAGES_SCRIPT,
        "--json",
      ]),
      "reading visible Outlook messages",
    );
    const cutoff = Date.now() - args.searchDays * 24 * 60 * 60 * 1000;
    return extracted
      .filter((message) => message.conversationId && message.subject)
      .map((message) => {
        const receivedAt = parseReceivedAt(message.receivedLabel);
        return {
          id: `${message.conversationId}:${message.receivedLabel || receivedAt}`,
          conversationId: message.conversationId,
          senderName: message.senderName,
          fromAddress: message.fromAddress ?? "",
          subject: message.subject,
          receivedAt,
          snippet: message.snippet,
          webLink: `${OUTLOOK_ORIGIN}/mail/0/inbox`,
        };
      })
      .filter((message) => message.receivedAt >= cutoff)
      .slice(0, args.maxMessages);
  }
}
