# Relayform

An interactive prototype for a **Universal AI Connector** platform. Relayform turns websites and OpenAPI specifications into a normalized tool definition that can be exported to MCP, OpenAI tools, JSON Schema, and TypeScript.

## Prototype scope

- Website and OpenAPI source modes
- Simulated source analysis and capability detection
- Reviewable tool registry with read/write risk labels
- Universal Tool Definition JSON preview and copy action
- MCP, OpenAI, JSON Schema, and TypeScript export targets
- Responsive desktop and mobile interface

The analysis flow currently uses realistic sample data. Crawling, OpenAPI parsing, credential storage, and generated MCP server downloads are the next backend milestones.

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
