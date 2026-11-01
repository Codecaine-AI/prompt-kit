import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The design system in its load order (guide/consume.md): fonts, tokens, the
// agent-viewer host contract the Lab's colors read, then the shell layout.
import "@codecaine-ai/design-system/fonts.css";
import "@codecaine-ai/design-system/tokens.css";
import "@codecaine-ai/design-system/host-contract.css";
import "@codecaine-ai/design-system/layout.css";
import "./index.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
