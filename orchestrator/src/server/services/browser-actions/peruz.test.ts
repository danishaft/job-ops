import { describe, expect, it } from "vitest";
import {
  assertPublicBrowserUrl,
  assertSafePeruzCommand,
  PeruzBrowserAdapter,
  type PeruzCommandRunner,
} from "./peruz";

class FakeRunner implements PeruzCommandRunner {
  readonly calls: string[][] = [];

  async run(args: string[]): Promise<string> {
    assertSafePeruzCommand(args);
    this.calls.push(args);
    if (args.includes("window.new")) return '"Window 42 (tab 43)"';
    if (args.includes("page.read")) return '"Engineering roles\\nApply"';
    return '"ok"';
  }
}

describe("PeruzBrowserAdapter", () => {
  const publicResolver = async () => ["93.184.216.34"];

  it("inspects in a disposable isolated window", async () => {
    const runner = new FakeRunner();
    const adapter = new PeruzBrowserAdapter(runner, publicResolver);
    const result = await adapter.inspect({
      url: "https://example.com/careers",
      kind: "company",
    });

    expect(result.pageText).toContain("Engineering roles");
    expect(
      runner.calls.map((call) => call.find((arg) => arg.includes("."))),
    ).toEqual(["window.new", "page.read", "window.close"]);
  });

  it("prefills known labels and leaves the window open for human review", async () => {
    const runner = new FakeRunner();
    const adapter = new PeruzBrowserAdapter(runner, publicResolver);
    const result = await adapter.prefill({
      jobId: "job-1",
      url: "https://example.com/apply",
      fields: [
        { field: "email", value: "candidate@example.com", labels: ["Email"] },
      ],
    });

    expect(result).toMatchObject({
      windowId: "42",
      humanActionRequired: true,
      submissionPerformed: false,
    });
    expect(runner.calls.some((call) => call.includes("window.close"))).toBe(
      false,
    );
    expect(runner.calls.some((call) => call.includes("--submit"))).toBe(false);
    expect(runner.calls.some((call) => call.includes("click"))).toBe(false);
  });

  it("rejects commands capable of external submission", () => {
    expect(() => assertSafePeruzCommand(["click", "e1"])).toThrow();
    expect(() =>
      assertSafePeruzCommand(["locate.label", "Email", "--action", "click"]),
    ).toThrow();
    expect(() => assertSafePeruzCommand(["type", "yes", "--submit"])).toThrow();
  });

  it("blocks local and private browser targets", () => {
    expect(() => assertPublicBrowserUrl("http://localhost:3000")).toThrow();
    expect(() => assertPublicBrowserUrl("http://192.168.1.20")).toThrow();
    expect(assertPublicBrowserUrl("https://jobs.example.com").hostname).toBe(
      "jobs.example.com",
    );
  });
});
