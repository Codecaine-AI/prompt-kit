import { renderGuidanceSource } from "@codecaine-ai/prompt-kit-server";
import { readFile } from "node:fs/promises";
const p = process.argv[2]!;
console.log(renderGuidanceSource(p, await readFile(p, "utf8")));
