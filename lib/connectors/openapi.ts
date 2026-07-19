import { parse as parseYaml } from "yaml";
import type { AnalyzedConnector, UniversalTool } from "./types";
import { fetchText, safeToolName, validateRemoteUrl } from "./security";

/* OpenAPI documents are intentionally schemaless at this parser boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonObject = Record<string, any>;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

function resolveRef(document: JsonObject, value: any): any {
  if (!value?.$ref || typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) return value;
  return value.$ref.slice(2).split("/").reduce((current: any, part: string) => current?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], document) || value;
}

function mergeInputSchema(document: JsonObject, operation: JsonObject, pathItem: JsonObject): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];

  for (const rawParameter of parameters) {
    const parameter = resolveRef(document, rawParameter);
    if (!parameter?.name) continue;
    properties[parameter.name] = {
      ...(resolveRef(document, parameter.schema) || { type: "string" }),
      description: parameter.description,
      "x-relayform-in": parameter.in,
    };
    if (parameter.required) required.push(parameter.name);
  }

  const requestBody = resolveRef(document, operation.requestBody);
  const bodySchema = requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    const resolved = resolveRef(document, bodySchema);
    if (resolved?.type === "object" && resolved.properties) {
      Object.assign(properties, resolved.properties);
      required.push(...(resolved.required || []));
    } else {
      properties.body = resolved;
      if (requestBody.required) required.push("body");
    }
  }

  return { type: "object", properties, ...(required.length ? { required: [...new Set(required)] } : {}) };
}

function outputSchema(document: JsonObject, operation: JsonObject): Record<string, unknown> | null {
  const responses = operation.responses || {};
  const success = responses["200"] || responses["201"] || responses["202"] || responses.default;
  const response = resolveRef(document, success);
  const schema = response?.content?.["application/json"]?.schema;
  return schema ? resolveRef(document, schema) : null;
}

function baseUrl(document: JsonObject, sourceUrl: URL): string {
  if (document.openapi) {
    const server = document.servers?.[0]?.url;
    if (server) return new URL(server, sourceUrl).toString().replace(/\/$/, "");
  }
  if (document.swagger === "2.0") {
    const scheme = document.schemes?.[0] || sourceUrl.protocol.replace(":", "");
    return `${scheme}://${document.host || sourceUrl.host}${document.basePath || ""}`.replace(/\/$/, "");
  }
  return sourceUrl.origin;
}

export async function analyzeOpenApi(value: string): Promise<{ connector: AnalyzedConnector; rawDocument: string }> {
  const url = validateRemoteUrl(value);
  const { text } = await fetchText(url);
  let document: JsonObject;
  try {
    document = parseYaml(text) as JsonObject;
  } catch {
    throw new Error("The source is not valid JSON or YAML.");
  }
  if (!document || (!document.openapi && document.swagger !== "2.0") || !document.paths) {
    throw new Error("The document is not a valid OpenAPI or Swagger specification.");
  }

  const tools: UniversalTool[] = [];
  for (const [path, pathItem] of Object.entries<JsonObject>(document.paths)) {
    for (const [method, operation] of Object.entries<JsonObject>(pathItem || {})) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || typeof operation !== "object") continue;
      const risk: "Read" | "Write" = ["get", "head", "options"].includes(method.toLowerCase()) ? "Read" : "Write";
      tools.push({
        name: safeToolName(operation.operationId || `${method}_${path}`),
        description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        risk,
        inputSchema: mergeInputSchema(document, operation, pathItem),
        outputSchema: outputSchema(document, operation),
      });
    }
  }
  if (!tools.length) throw new Error("No callable operations were found in this specification.");

  const createdAt = new Date().toISOString();
  return {
    connector: {
      id: crypto.randomUUID(),
      name: document.info?.title || url.hostname,
      sourceType: "openapi",
      sourceUrl: url.toString(),
      baseUrl: baseUrl(document, url),
      status: "ready",
      tools,
      metadata: { version: document.info?.version, openapi: document.openapi || document.swagger, description: document.info?.description },
      createdAt,
    },
    rawDocument: text,
  };
}
