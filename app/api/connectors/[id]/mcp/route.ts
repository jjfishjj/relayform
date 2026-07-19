import { generateMcpServer } from "../../../../../lib/connectors/mcp-generator";
import { getConnector } from "../../../../../lib/connectors/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connector = await getConnector(id);
  if (!connector) return new Response("Connector not found", { status: 404 });
  return new Response(generateMcpServer(connector), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "content-disposition": `attachment; filename="${connector.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-mcp-server.mjs"`,
    },
  });
}
