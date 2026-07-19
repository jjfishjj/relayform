export type ConnectorSourceType = "website" | "openapi";

export type UniversalTool = {
  name: string;
  description: string;
  method: string;
  path: string;
  risk: "Read" | "Write";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
};

export type AnalyzedConnector = {
  id: string;
  name: string;
  sourceType: ConnectorSourceType;
  sourceUrl: string;
  baseUrl: string;
  status: "ready" | "error";
  tools: UniversalTool[];
  metadata: Record<string, unknown>;
  createdAt: string;
};
