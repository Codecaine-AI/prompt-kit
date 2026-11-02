import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type { StudioPrompt } from "../../server/studio-api";

export type { StudioPrompt };
export type LoadedPrompt = StudioPrompt & { document: PromptDocument; hash: string };

/** The page route for one prompt. The studio has no router: links reload the page. */
export const promptHref = (key: string): string => `/p/${key}`;

/** The prompt key in the current URL, or null on the index page. */
export function promptKeyFromPath(pathname: string): string | null {
  const match = /^\/p\/(.+?)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json().catch(() => ({}))) as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? `${path} answered ${response.status}`);
  return body;
}

export const fetchCatalog = () => getJson<{ workspace: string; prompts: StudioPrompt[] }>("/api/studio/prompts");
export const fetchPrompt = (key: string) => getJson<LoadedPrompt>(`/api/studio/prompt?key=${encodeURIComponent(key)}`);
