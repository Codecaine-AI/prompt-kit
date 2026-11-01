import { useEffect, useMemo, useState } from "react";
import { createRemoteAnnotationStore } from "@codecaine-ai/prompt-kit/annotations";
import { PromptInlineLab } from "@codecaine-ai/prompt-kit/ui/lab";
import { fetchPrompt, type LoadedPrompt } from "../../shared/catalog";

export type PromptLabProps = { promptKey: string };

/** Loads one catalog prompt and mounts the Lab on it, with requests saved through the studio's proxy. */
export function PromptLab({ promptKey }: PromptLabProps) {
  const [prompt, setPrompt] = useState<LoadedPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrompt(promptKey).then(setPrompt, (cause: Error) => setError(cause.message));
  }, [promptKey]);

  if (error) return <p className="studio-message" data-tone="danger">{error}</p>;
  if (!prompt) return <p className="studio-message">Loading the prompt…</p>;
  return <LoadedLab prompt={prompt} onError={setError} />;
}

function LoadedLab({ prompt, onError }: { prompt: LoadedPrompt; onError: (message: string) => void }) {
  // The studio's own origin: /api/annotations goes through its proxy, which adds the service token.
  const store = useMemo(
    () => createRemoteAnnotationStore({
      baseUrl: window.location.origin,
      promptPath: prompt.promptPath,
      root: prompt.root,
      onError: (cause) => onError(`Request not saved: ${cause.message}`),
    }),
    [prompt.promptPath, prompt.root, onError],
  );

  useEffect(() => {
    store.load().catch((cause: Error) => onError(`Requests not loaded: ${cause.message}`));
    // An agent's reply or resolve arrives on the event stream: reload this prompt's requests.
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as { root?: string; path?: string };
      if (event.root === prompt.root && event.path === prompt.promptPath) void store.load().catch(() => {});
    };
    return () => events.close();
  }, [store, prompt.root, prompt.promptPath, onError]);

  return (
    <div className="studio-lab">
      <PromptInlineLab
        prompt={prompt.document}
        declaredVariables={prompt.declaredVariables}
        savedHash={prompt.hash}
        annotationStore={store}
        followTheme
      />
    </div>
  );
}
