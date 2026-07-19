import type { AnalyzedConnector, UniversalTool } from "./types";
import { fetchText, validateRemoteUrl } from "./security";

function matchesAll(text: string, expression: RegExp): string[] {
  return [...text.matchAll(expression)].map((match) => match[1]).filter(Boolean);
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function analyzeWebsite(value: string): Promise<{ connector: AnalyzedConnector; rawDocument: string }> {
  const url = validateRemoteUrl(value);
  const origin = url.origin;
  const [homeResult, robotsResult, sitemapResult] = await Promise.allSettled([
    fetchText(url, 1_000_000),
    fetchText(new URL("/robots.txt", origin), 200_000),
    fetchText(new URL("/sitemap.xml", origin), 1_000_000),
  ]);
  if (homeResult.status === "rejected") throw homeResult.reason;

  const home = homeResult.value.text;
  const robots = robotsResult.status === "fulfilled" ? robotsResult.value.text : "";
  const sitemap = sitemapResult.status === "fulfilled" ? sitemapResult.value.text : "";
  const sitemapUrls = matchesAll(sitemap, /<loc>\s*([^<]+)\s*<\/loc>/gi);
  const pageLinks = matchesAll(home, /href=["']([^"'#]+)["']/gi)
    .map((href) => { try { return new URL(href, url).toString(); } catch { return ""; } })
    .filter((href) => href.startsWith(origin));
  const crawlTargets = [...new Set([url.toString(), ...sitemapUrls, ...pageLinks])].slice(0, 6);
  const pages = await Promise.all(crawlTargets.map(async (target) => {
    try {
      const pageUrl = validateRemoteUrl(target);
      if (pageUrl.origin !== origin) return null;
      const { text } = await fetchText(pageUrl, 750_000);
      const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || pageUrl.pathname;
      return { url: pageUrl.toString(), title, excerpt: stripHtml(text).slice(0, 280) };
    } catch { return null; }
  }));

  const tools: UniversalTool[] = [
    { name: "search_content", description: "Search crawled pages and return matching excerpts.", method: "GET", path: "/search", risk: "Read", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", default: 10 } }, required: ["query"] }, outputSchema: { type: "array", items: { type: "object" } } },
    { name: "read_page", description: "Read a clean text representation of a same-origin page.", method: "GET", path: "/pages", risk: "Read", inputSchema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] }, outputSchema: { type: "object" } },
    { name: "list_resources", description: "List pages and downloadable resources discovered during crawling.", method: "GET", path: "/resources", risk: "Read", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "array", items: { type: "object" } } },
  ];

  const title = home.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || url.hostname;
  const connector: AnalyzedConnector = {
    id: crypto.randomUUID(), name: title, sourceType: "website", sourceUrl: url.toString(), baseUrl: origin,
    status: "ready", tools, createdAt: new Date().toISOString(),
    metadata: { robotsFound: Boolean(robots), sitemapFound: Boolean(sitemap), sitemapUrls: sitemapUrls.length, pages: pages.filter(Boolean) },
  };
  return { connector, rawDocument: JSON.stringify({ robots, sitemap, pages: pages.filter(Boolean) }) };
}
