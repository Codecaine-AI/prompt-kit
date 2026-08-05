# State fixtures

Each `*.json` file here is a fixture envelope for the kernel lab's State view,
which discovers `state/fixtures/*.json` in every bundle:

```json
{ "label": "mid-session", "state": { "targetAgent": "…", … } }
```

`label` names the fixture in the lab (defaults to the filename), and `state`
is a sample of the state module's `S` (`PromptEditorState` in
`../index.ts`) — plug `state` straight into `render()` to preview section ③
without a live session. Fixtures are state samples, NOT `sessionData` for the
context sidecar's `assemble()` — section ② carries standing knowledge only.
Real spawns never load these; their state seeds from the session service's
spawn payload. Data only: no code, no loaders.
