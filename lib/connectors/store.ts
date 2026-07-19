import { desc, eq } from "drizzle-orm";
import { ensureDbSchema, getDb } from "../../db";
import { connectors, toolRuns, tools } from "../../db/schema";
import type { AnalyzedConnector } from "./types";

function normalizeToolRow(row: typeof tools.$inferSelect) {
  return {
    name: row.name,
    description: row.description,
    method: row.method,
    path: row.path,
    risk: row.risk as "Read" | "Write",
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: row.outputSchema as Record<string, unknown> | null,
  };
}

export async function saveConnector(connector: AnalyzedConnector, rawDocument: string): Promise<void> {
  await ensureDbSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(connectors).values({
    id: connector.id, name: connector.name, sourceType: connector.sourceType, sourceUrl: connector.sourceUrl,
    baseUrl: connector.baseUrl, status: connector.status, metadata: connector.metadata, rawDocument,
    createdAt: connector.createdAt, updatedAt: now,
  }).onConflictDoUpdate({ target: connectors.id, set: { name: connector.name, status: connector.status, metadata: connector.metadata, rawDocument, updatedAt: now } });
  await db.delete(tools).where(eq(tools.connectorId, connector.id));
  for (let index = 0; index < connector.tools.length; index += 8) {
    const chunk = connector.tools.slice(index, index + 8);
    await db.insert(tools).values(chunk.map((tool) => ({ connectorId: connector.id, ...tool })));
  }
}

export async function listConnectors(): Promise<AnalyzedConnector[]> {
  await ensureDbSchema();
  const db = getDb();
  const rows = await db.select().from(connectors).orderBy(desc(connectors.createdAt)).limit(50);
  return Promise.all(rows.map(async (row) => {
    const toolRows = await db.select().from(tools).where(eq(tools.connectorId, row.id));
    return { ...row, sourceType: row.sourceType as "website" | "openapi", status: row.status as "ready" | "error", metadata: row.metadata as Record<string, unknown>, tools: toolRows.map(normalizeToolRow) };
  }));
}

export async function getConnector(id: string): Promise<AnalyzedConnector | null> {
  await ensureDbSchema();
  const db = getDb();
  const [row] = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
  if (!row) return null;
  const toolRows = await db.select().from(tools).where(eq(tools.connectorId, id));
  return { ...row, sourceType: row.sourceType as "website" | "openapi", status: row.status as "ready" | "error", metadata: row.metadata as Record<string, unknown>, tools: toolRows.map(normalizeToolRow) };
}

export async function recordToolRun(run: { connectorId: string; toolName: string; status: string; durationMs: number; responseStatus?: number; error?: string }): Promise<void> {
  await ensureDbSchema();
  await getDb().insert(toolRuns).values({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...run });
}
