# Prompt Kit Agent

Development harness for the first-party `prompt-editor` agent. Prompt Kit is a
Bun workspace, so the harness can live beside the library while preserving the
dependency DAG:

```text
@codecaine-ai/prompt-kit ← agent-kernel ← @codecaine-ai/prompt-kit-agent
```

The kernel mounts exactly one catalog root: this package's `catalog/`, which
contains the `prompt-editor` bundle. Its valid edit target is `prompt-editor`
itself; recursive self-editing is intentional. Other projects' agents are not
included.

Runtime state is isolated under this package's `.agent-kernel/`, including
`trace.db`, `kernel.json`, prompt-edit session directories, and Pi session
transcripts. Each launched edit gets a kernel session container, so its agent
run appears in Observatory's trace viewer with active/done/error lifecycle.

## Start

From the `prompt-kit` repository root:

```bash
bun run dev:agent
```

Or run the package directly:

```bash
bun run --cwd packages/prompt-kit-agent dev
```

The API listens on `http://127.0.0.1:4850`. Override the port with
`PROMPT_KIT_KERNEL_PORT`. Override the prompt-editor model alias with
`PROMPT_KIT_KERNEL_PROMPT_EDITOR_MODEL`.

By default the harness reads models-process configuration from this package's
`.pi-agent/`. Set `PROMPT_KIT_KERNEL_PI_AGENT_DIR` to use another Pi agent
directory. The directory must contain the usual empty `auth.json` plus a
`models.json` that defines the selected model.

## Observatory

1. Start this kernel with `bun run dev:agent` from the `prompt-kit` repository.
2. Start Observatory from the Core checkout with `make observatory`.
3. Open `http://127.0.0.1:4891`.
4. Under **Projects → Prompt Kit**, click **Agents**.
5. Select **prompt-editor** to inspect its manifest and structured prompt.
6. Under **Projects → Prompt Kit**, click **Traces** to inspect prompt-editor
   session runs in the trace viewer.

Observatory probes `GET /health`. Catalog, annotation, prompt-edit session, and
trace-read routes are mounted under the plain `/kernel` prefix.
