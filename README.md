# Relayform

An interactive prototype for a **Universal AI Connector** platform. Relayform turns websites and OpenAPI specifications into a normalized tool definition that can be exported to MCP, OpenAI tools, JSON Schema, and TypeScript.

## Implemented runtime

- Website crawling of the homepage, `robots.txt`, `sitemap.xml`, and a bounded set of same-origin pages
- OpenAPI 3.x and Swagger 2 JSON/YAML parsing
- Automatic input/output schema extraction and read/write classification
- Durable D1 storage for connectors, normalized tools, and tool-run records
- Read-only remote Tool test runner with response and latency reporting
- Downloadable MCP Server source with write operations disabled by default
- URL validation, private-network blocking, response-size limits, and bounded crawling
- Interactive Universal Tool Definition preview

OAuth/API-key management and encrypted hosted credentials are intentionally deferred until an identity and authorization model is selected. Generated MCP servers accept credentials through `RELAYFORM_API_KEY` and require `RELAYFORM_ALLOW_WRITE=true` before enabling write operations.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validate

```bash
npm test
```

## Architecture direction

```text
Source → Parser → Universal Tool Definition → Exporter
```

The internal definition is intentionally protocol-neutral so new sources and agent runtimes can be added independently.

## API

- `POST /api/connectors` analyzes and saves a Website or OpenAPI source.
- `GET /api/connectors` lists saved connectors.
- `POST /api/tools/test` executes saved read-only HTTP tools.
- `GET /api/connectors/:id/mcp` downloads a generated MCP server.

Example request:

```json
{
  "sourceType": "openapi",
  "sourceUrl": "https://petstore3.swagger.io/api/v3/openapi.json"
}
```
