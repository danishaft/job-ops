import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type {
  BrowserInspectionResult,
  BrowserInspectKind,
  BrowserPrefillFieldResult,
  BrowserPrefillResult,
} from "@shared/types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 200_000;
const ALLOWED_COMMANDS = new Set([
  "window.new",
  "window.close",
  "page.read",
  "locate.label",
]);

export interface PeruzCommandRunner {
  run(args: string[], timeoutMs?: number): Promise<string>;
}

export interface BrowserPrefillField {
  field: string;
  value: string;
  labels: string[];
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export class BrowserTargetError extends Error {}

const resolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

function getCommand(args: readonly string[]): string {
  const withValue = new Set(["--window-id", "--tab-id"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (withValue.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return arg;
  }
  throw new Error("Peruz command is missing");
}

export function assertSafePeruzCommand(args: readonly string[]): void {
  const command = getCommand(args);
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Peruz command is not allowed: ${command}`);
  }
  if (
    args.includes("--submit") ||
    (args.includes("--action") && !args.includes("fill"))
  ) {
    throw new Error("Peruz external actions are not allowed");
  }
}

export class SpawnPeruzCommandRunner implements PeruzCommandRunner {
  async run(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    assertSafePeruzCommand(args);
    return new Promise((resolve, reject) => {
      const child = spawn("peruz", args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Peruz command timed out"));
      }, timeoutMs);

      const append = (current: string, chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGTERM");
          reject(new Error("Peruz command output exceeded the safety limit"));
          return current;
        }
        return current + chunk.toString("utf8");
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || `Peruz exited with code ${code}`));
      });
    });
  }
}

function unwrapPeruzJson(output: string): string {
  try {
    const parsed = JSON.parse(output) as unknown;
    return typeof parsed === "string" ? parsed : output;
  } catch {
    return output;
  }
}

function parseWindowId(output: string): string {
  const match = unwrapPeruzJson(output).match(/Window\s+(\d+)/i);
  if (!match?.[1]) throw new Error("Peruz did not return a browser window ID");
  return match[1];
}

export function assertPublicBrowserUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BrowserTargetError(
      "Browser actions require an HTTP or HTTPS URL",
    );
  }
  const hostname = url.hostname.toLowerCase();
  const blocked =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (blocked) {
    throw new BrowserTargetError(
      "Browser actions cannot target a private host",
    );
  }
  return url;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return (
      /^127\./.test(address) ||
      /^10\./.test(address) ||
      /^192\.168\./.test(address) ||
      /^169\.254\./.test(address) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
      address === "0.0.0.0"
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function resolvePublicBrowserUrl(
  value: string,
  resolver: HostResolver,
): Promise<URL> {
  const url = assertPublicBrowserUrl(value);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return url;
  const addresses = await resolver(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BrowserTargetError(
      "Browser actions cannot target a private host",
    );
  }
  return url;
}

export class PeruzBrowserAdapter {
  constructor(
    private readonly runner: PeruzCommandRunner = new SpawnPeruzCommandRunner(),
    private readonly hostResolver: HostResolver = resolveHost,
  ) {}

  async inspect(input: {
    url: string;
    kind: BrowserInspectKind;
  }): Promise<BrowserInspectionResult> {
    const url = (
      await resolvePublicBrowserUrl(input.url, this.hostResolver)
    ).toString();
    const windowId = parseWindowId(
      await this.runner.run(["window.new", url, "--unfocused", "--json"]),
    );
    try {
      const output = await this.runner.run([
        "--window-id",
        windowId,
        "page.read",
        "--depth",
        "6",
        "--compact",
        "--json",
      ]);
      return {
        kind: input.kind,
        url,
        pageText: unwrapPeruzJson(output).slice(0, 60_000),
        inspectedAt: new Date().toISOString(),
      };
    } finally {
      await this.runner
        .run(["window.close", windowId, "--json"])
        .catch(() => undefined);
    }
  }

  async prefill(input: {
    jobId: string;
    url: string;
    fields: BrowserPrefillField[];
  }): Promise<BrowserPrefillResult> {
    const url = (
      await resolvePublicBrowserUrl(input.url, this.hostResolver)
    ).toString();
    const windowId = parseWindowId(
      await this.runner.run(["window.new", url, "--json"]),
    );
    const results: BrowserPrefillFieldResult[] = [];

    for (const field of input.fields) {
      let filled = false;
      for (const label of field.labels) {
        try {
          await this.runner.run([
            "--window-id",
            windowId,
            "locate.label",
            label,
            "--action",
            "fill",
            "--value",
            field.value,
            "--json",
          ]);
          filled = true;
          break;
        } catch {
          // Try the next known label without guessing selectors or clicking.
        }
      }
      results.push({
        field: field.field,
        status: filled ? "filled" : "not_found",
      });
    }

    return {
      jobId: input.jobId,
      url,
      windowId,
      fields: results,
      humanActionRequired: true,
      submissionPerformed: false,
    };
  }
}
