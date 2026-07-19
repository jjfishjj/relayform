import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const connectors = sqliteTable("connectors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  baseUrl: text("base_url").notNull(),
  status: text("status").notNull(),
  metadata: text("metadata", { mode: "json" }).notNull(),
  rawDocument: text("raw_document").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tools = sqliteTable("tools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  connectorId: text("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  risk: text("risk").notNull(),
  inputSchema: text("input_schema", { mode: "json" }).notNull(),
  outputSchema: text("output_schema", { mode: "json" }),
});

export const toolRuns = sqliteTable("tool_runs", {
  id: text("id").primaryKey(),
  connectorId: text("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  durationMs: integer("duration_ms").notNull(),
  responseStatus: integer("response_status"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});
