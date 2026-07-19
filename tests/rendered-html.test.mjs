import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the Relayform connector builder and runtime routes", async () => {
  const [page, connectorRoute, toolRoute, mcpRoute, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tools/test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/connectors/[id]/mcp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_clean_loners.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Analyze source/);
  assert.match(page, /Download MCP server/);
  assert.match(page, /\/api\/connectors/);
  assert.match(connectorRoute, /analyzeOpenApi/);
  assert.match(connectorRoute, /analyzeWebsite/);
  assert.match(toolRoute, /Write tools are blocked/);
  assert.match(mcpRoute, /generateMcpServer/);
  assert.match(migration, /CREATE TABLE `connectors`/);
  assert.match(migration, /CREATE TABLE `tool_runs`/);
});
