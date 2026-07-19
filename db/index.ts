import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let initialized: Promise<void> | null = null;

export function ensureDbSchema(): Promise<void> {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  initialized ??= env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS connectors (id text PRIMARY KEY NOT NULL, name text NOT NULL, source_type text NOT NULL, source_url text NOT NULL, base_url text NOT NULL, status text NOT NULL, metadata text NOT NULL, raw_document text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tools (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, connector_id text NOT NULL, name text NOT NULL, description text NOT NULL, method text NOT NULL, path text NOT NULL, risk text NOT NULL, input_schema text NOT NULL, output_schema text, FOREIGN KEY (connector_id) REFERENCES connectors(id) ON UPDATE no action ON DELETE cascade)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tool_runs (id text PRIMARY KEY NOT NULL, connector_id text NOT NULL, tool_name text NOT NULL, status text NOT NULL, duration_ms integer NOT NULL, response_status integer, error text, created_at text NOT NULL, FOREIGN KEY (connector_id) REFERENCES connectors(id) ON UPDATE no action ON DELETE cascade)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tools_connector_id_idx ON tools (connector_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS tool_runs_connector_id_idx ON tool_runs (connector_id)"),
  ]).then(() => undefined);
  return initialized;
}
