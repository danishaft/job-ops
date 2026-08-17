import { downloadMMDB } from "camoufox-js/dist/locale.js";
import { CamoufoxFetcher } from "camoufox-js/dist/pkgman.js";

const githubToken = process.env.GITHUB_TOKEN?.trim() || "";
const originalFetch = globalThis.fetch;

function getUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) {
    return String(input.url);
  }
  return "";
}

function shouldAttachGithubToken(url) {
  return (
    url.startsWith("https://api.github.com/") ||
    url.startsWith("https://github.com/") ||
    url.startsWith("https://objects.githubusercontent.com/")
  );
}

if (githubToken) {
  console.log("Using GITHUB_TOKEN for Camoufox GitHub downloads.");

  globalThis.fetch = async (input, init) => {
    const url = getUrl(input);
    if (!shouldAttachGithubToken(url)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ??
        (input && typeof input === "object" && "headers" in input
          ? input.headers
          : undefined),
    );

    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${githubToken}`);
    }

    if (url.startsWith("https://api.github.com/")) {
      headers.set("accept", "application/vnd.github+json");
      headers.set("x-github-api-version", "2022-11-28");
    }

    return originalFetch(input, { ...init, headers });
  };
}

try {
  await new CamoufoxFetcher().install();
} catch (error) {
  console.warn(
    "Camoufox download failed (GitHub API may be rate-limited or degraded). " +
      "Continuing without it — browser-based extractors will fall back or fail individually.",
    error instanceof Error ? error.message : String(error),
  );
}
try {
  await downloadMMDB();
} catch (error) {
  console.warn(
    "GeoLite.mmdb download failed (GitHub API may be rate-limited or degraded). " +
      "Continuing without it — only affects Camoufox locale resolution.",
    error instanceof Error ? error.message : String(error),
  );
}
