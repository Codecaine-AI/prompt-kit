import { useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/** index.html sets the first theme before paint; this button switches it and stores the choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="ds-shell-button"
      aria-label={`Switch to the ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          window.localStorage.setItem("prompt-studio.theme", next);
        } catch {
          // Blocked storage: the choice lasts until the page reloads.
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
