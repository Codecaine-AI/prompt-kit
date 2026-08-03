/**
 * bun test preload — de-duplicates React across the
 * `@codecaine-ai/annotations` `link:` boundary.
 *
 * annotations is a bun-linked sibling repo with its own node_modules
 * (installed by its own bun.lock), so its sources resolve react/react-dom to
 * a second copy while this repo's tests render with the root copy. Two React
 * instances share no dispatcher, so any test that mounts an annotations
 * component would die with "Invalid hook call".
 *
 * mock.module() accepts resolved absolute paths, so point every React-family
 * module reachable from the annotations package at the root instances. No-op
 * when its node_modules is absent (resolution already unifies).
 *
 * Adapted from docs-system/react-dedup.ts.
 */
import { mock } from "bun:test";
import * as RootReact from "react";
import * as RootJsxRuntime from "react/jsx-runtime";
import * as RootJsxDevRuntime from "react/jsx-dev-runtime";
import * as RootReactDom from "react-dom";
import * as RootReactDomClient from "react-dom/client";

{
  const reactFamily: Array<[string, object]> = [
    ["react", RootReact],
    ["react/jsx-runtime", RootJsxRuntime],
    ["react/jsx-dev-runtime", RootJsxDevRuntime],
    ["react-dom", RootReactDom],
    ["react-dom/client", RootReactDomClient],
  ];
  try {
    const pkgEntry = Bun.resolveSync("@codecaine-ai/annotations", import.meta.dir);
    const pkgDir = pkgEntry.slice(0, pkgEntry.lastIndexOf("/"));
    for (const [spec, rootNamespace] of reactFamily) {
      try {
        const pkgPath = Bun.resolveSync(spec, pkgDir);
        const rootPath = Bun.resolveSync(spec, import.meta.dir);
        if (pkgPath !== rootPath) {
          const copy = { ...rootNamespace };
          mock.module(pkgPath, () => copy);
        }
      } catch {
        // Spec not resolvable from the annotations package — nothing to unify.
      }
    }
  } catch {
    // Package not installed — nothing to unify.
  }
}
