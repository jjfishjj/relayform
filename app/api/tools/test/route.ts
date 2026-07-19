import { NextResponse } from "next/server";
import { getConnector, recordToolRun } from "../../../../lib/connectors/store";
import { validateRemoteUrl } from "../../../../lib/connectors/security";

export async function POST(request: Request) {
  const started = Date.now();
  let connectorId = "";
  let toolName = "";
  try {
    const body = await request.json() as { connectorId?: string; toolName?: string; arguments?: Record<string, unknown> };
    connectorId = body.connectorId || ""; toolName = body.toolName || "";
    const connector = await getConnector(connectorId);
    const tool = connector?.tools.find((candidate) => candidate.name === toolName);
    if (!connector || !tool) return NextResponse.json({ error: "Connector or tool not found." }, { status: 404 });
    if (tool.risk === "Write") return NextResponse.json({ error: "Write tools are blocked in the test runner." }, { status: 403 });

    let path = tool.path;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(body.arguments || {})) {
      const token = `{${key}}`;
      if (path.includes(token)) path = path.replace(token, encodeURIComponent(String(value)));
      else query.set(key, String(value));
    }
    const target = validateRemoteUrl(new URL(path.replace(/^\//, ""), `${connector.baseUrl.replace(/\/$/, "")}/`).toString());
    target.search = query.toString();
    const response = await fetch(target, { headers: { accept: "application/json, text/plain" } });
    const text = (await response.text()).slice(0, 100_000);
    await recordToolRun({ connectorId, toolName, status: response.ok ? "success" : "error", durationMs: Date.now() - started, responseStatus: response.status });
    return NextResponse.json({ status: response.status, durationMs: Date.now() - started, body: text });
  } catch (error) {
    if (connectorId && toolName) await recordToolRun({ connectorId, toolName, status: "error", durationMs: Date.now() - started, error: error instanceof Error ? error.message : "Test failed" }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : "Test failed." }, { status: 422 });
  }
}
