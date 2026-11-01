import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { AppShell, resolveNav, type NavSection } from "./_components/AppShell";
import { PromptLab } from "./_components/PromptLab";
import { ThemeToggle } from "./_components/ThemeToggle";
import { fetchCatalog, promptHref, promptKeyFromPath, type StudioPrompt } from "./shared/catalog";

/** One nav section per catalog project, one row per prompt. */
function navSections(prompts: StudioPrompt[]): NavSection[] {
  const projects = new Map<string, NavSection>();
  for (const prompt of prompts) {
    let section = projects.get(prompt.projectId);
    if (!section) {
      section = { id: prompt.projectId, label: prompt.projectName, showHeading: true, items: [] };
      projects.set(prompt.projectId, section);
    }
    section.items.push({ id: prompt.key, label: prompt.title, href: promptHref(prompt.key), icon: <FileText aria-hidden="true" /> });
  }
  return [...projects.values()];
}

export function App() {
  const pathname = window.location.pathname;
  const key = promptKeyFromPath(pathname);
  const [prompts, setPrompts] = useState<StudioPrompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalog().then((catalog) => setPrompts(catalog.prompts), (cause: Error) => setError(cause.message));
  }, []);

  const selected = prompts?.find((prompt) => prompt.key === key);
  return (
    <AppShell
      appName="Prompt Studio"
      storageKey="prompt-studio.sidebar"
      sections={resolveNav(navSections(prompts ?? []), pathname)}
      title={selected?.title ?? "Prompts"}
      actions={<ThemeToggle />}
      lane="full"
    >
      {error ? (
        <p className="studio-message" data-tone="danger">{error}</p>
      ) : !prompts ? (
        <p className="studio-message">Loading the catalog…</p>
      ) : key ? (
        <PromptLab key={key} promptKey={key} />
      ) : (
        <p className="studio-message">
          {prompts.length ? "Choose a prompt in the sidebar to open it in the Lab." : "The catalog has no prompts."}
        </p>
      )}
    </AppShell>
  );
}
