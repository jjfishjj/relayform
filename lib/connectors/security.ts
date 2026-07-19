const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

export function validateRemoteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid absolute URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS sources are supported.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    PRIVATE_IPV4.some((pattern) => pattern.test(host))
  ) {
    throw new Error("Private and local network addresses are not allowed.");
  }

  url.hash = "";
  return url;
}

export async function fetchText(url: URL, maxBytes = 2_000_000): Promise<{ text: string; contentType: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      accept: "application/json, application/yaml, text/yaml, text/html, text/plain, application/xml, text/xml",
      "user-agent": "Relayform-Connector-Analyzer/0.2",
    },
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);

  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error(`Source exceeds the ${Math.round(maxBytes / 1_000_000)} MB limit.`);

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`Source exceeds the ${Math.round(maxBytes / 1_000_000)} MB limit.`);
  }
  return { text, contentType: response.headers.get("content-type") || "" };
}

export function safeToolName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return normalized || "unnamed_tool";
}
