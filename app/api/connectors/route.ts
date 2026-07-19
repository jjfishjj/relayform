import { NextResponse } from "next/server";
import { analyzeOpenApi } from "../../../lib/connectors/openapi";
import { saveConnector, listConnectors } from "../../../lib/connectors/store";
import { analyzeWebsite } from "../../../lib/connectors/website";

export async function GET() {
  try { return NextResponse.json({ connectors: await listConnectors() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load connectors." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceType?: string; sourceUrl?: string };
    if (!body.sourceUrl || !["website", "openapi"].includes(body.sourceType || "")) {
      return NextResponse.json({ error: "sourceType and sourceUrl are required." }, { status: 400 });
    }
    const analyzed = body.sourceType === "openapi" ? await analyzeOpenApi(body.sourceUrl) : await analyzeWebsite(body.sourceUrl);
    await saveConnector(analyzed.connector, analyzed.rawDocument);
    return NextResponse.json({ connector: analyzed.connector }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 422 });
  }
}
