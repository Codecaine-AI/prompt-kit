import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathConfinementError extends Error {
  readonly code = "invalid_path" as const;

  constructor(message: string) {
    super(message);
    this.name = "PathConfinementError";
  }
}

export function assertRelativePath(path: string, label = "path"): void {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    throw new PathConfinementError(`${label} must be a non-empty relative path`);
  }
  const parts = path.split(/[\\/]+/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new PathConfinementError(`${label} must not contain empty, dot, or parent segments`);
  }
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve a relative path and reject every symlink already present in its chain. */
export async function confinePath(
  root: string,
  relativePath: string,
  options: { createParent?: boolean } = {},
): Promise<string> {
  assertRelativePath(relativePath);
  const realRoot = await realpath(root).catch(() => {
    throw new PathConfinementError(`store root does not exist: ${root}`);
  });
  const candidate = resolve(realRoot, relativePath);
  if (!isWithin(realRoot, candidate)) {
    throw new PathConfinementError(`path escapes store root: ${relativePath}`);
  }

  const parts = relativePath.split(/[\\/]+/);
  let cursor = realRoot;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]!);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw new PathConfinementError(`symlink paths are not allowed: ${relativePath}`);
      }
    } catch (error) {
      if (error instanceof PathConfinementError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (options.createParent && index < parts.length - 1) {
        await mkdir(cursor, { recursive: false }).catch((mkdirError: NodeJS.ErrnoException) => {
          if (mkdirError.code !== "EEXIST") throw mkdirError;
        });
        const stat = await lstat(cursor);
        if (stat.isSymbolicLink()) {
          throw new PathConfinementError(`symlink paths are not allowed: ${relativePath}`);
        }
      }
    }
  }
  return candidate;
}
