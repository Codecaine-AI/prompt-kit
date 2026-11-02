# Prompt Studio

`@codecaine-ai/prompt-kit-studio` is Prompt Kit's own page. It lists the catalog's prompts and opens one in the Lab (`PromptInlineLab`). Requests you file in the Lab are saved by the Prompt service, so they come back after a reload, and agents read and resolve them through the MCP request tools.

## Commands

Run these in `packages/studio`. Install dependencies once with `bun install` at the Codecaine Core root.

```sh
bun run dev     # Vite dev server with hot reload on http://127.0.0.1:4860
bun run start   # production build, then serve it on http://127.0.0.1:4860
bun run test    # starts the studio and a Prompt service in temp folders, files and reloads a request
```

## How it works

- `server/studio-api.ts` is a middleware that `vite.config.ts` mounts in dev and preview.
  - `GET /api/studio/prompts` lists the catalog. `GET /api/studio/prompt?key=` reads one prompt.
  - `/api/annotations*` and `/api/events` go to the Prompt service. The studio adds the bearer token on the server, so the page never sees it.
  - The proxy answers 403 to another origin, to a non-local Host, and to a `root` that is not in the studio's catalog.
- The studio finds the service through `ensureDaemon` (the state file `daemon.json` in `~/.local/state/codecaine-prompts`). It starts the service when none runs, the same way the MCP CLI does.
- A Prompt service started before the annotation routes existed answers 404 on `/api/annotations`. Restart it with `bun packages/prompt-kit-mcp/src/cli.ts stop`, then `start`.

## Settings

- `PROMPT_KIT_STUDIO_WORKSPACE`: the folder whose catalog the studio lists. Default: this prompt-kit checkout.
- `PROMPT_KIT_STUDIO_PORT`: the port. Default: 4860.
- `CODECAINE_PROMPTS_STATE_DIR`: the Prompt service's state folder, as for the MCP CLI.
