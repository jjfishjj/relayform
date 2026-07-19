import type { AnalyzedConnector } from "./types";

export function generateMcpServer(connector: AnalyzedConnector): string {
  const tools = JSON.stringify(connector.tools, null, 2);
  return `#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: ${JSON.stringify(connector.name)}, version: "0.1.0" });
const baseUrl = ${JSON.stringify(connector.baseUrl)};
const tools = ${tools};

for (const tool of tools) {
  server.registerTool(tool.name, {
    description: tool.description,
    inputSchema: z.object({}).passthrough(),
  }, async (args) => {
    if (tool.risk === "Write" && process.env.RELAYFORM_ALLOW_WRITE !== "true") {
      throw new Error("Write tools require RELAYFORM_ALLOW_WRITE=true");
    }
    let path = tool.path;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      const token = "{" + key + "}";
      if (path.includes(token)) path = path.replace(token, encodeURIComponent(String(value)));
      else query.set(key, String(value));
    }
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const url = new URL(relativePath, normalizedBaseUrl);
    if (tool.method === "GET") url.search = query.toString();
    const response = await fetch(url, {
      method: tool.method,
      headers: { "content-type": "application/json", ...(process.env.RELAYFORM_API_KEY ? { authorization: "Bearer " + process.env.RELAYFORM_API_KEY } : {}) },
      body: tool.method === "GET" ? undefined : JSON.stringify(args),
    });
    const text = await response.text();
    return { content: [{ type: "text", text: response.ok ? text : "HTTP " + response.status + ": " + text }] };
  });
}

await server.connect(new StdioServerTransport());
`;
}
