#!/usr/bin/env bun
/** Rewrite this package's guidance/ bundle from the canonical docs. */
import { writeGuidanceBundle } from "../src/guidance";

await writeGuidanceBundle();
console.log("Wrote packages/prompt-kit-server/guidance from the canonical docs.");
