import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LAB_INSPECTOR_PREFERENCE,
  LAB_INSPECTOR_STORAGE_KEY,
  loadLabInspectorPreference,
  saveLabInspectorPreference,
} from "./LabInspector";

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

describe("lab inspector preference", () => {
  test("defaults when storage is unavailable", () => {
    expect(loadLabInspectorPreference(undefined)).toEqual(
      DEFAULT_LAB_INSPECTOR_PREFERENCE,
    );
  });

  test("defaults when the stored value is corrupt", () => {
    const storage = memoryStorage({
      [LAB_INSPECTOR_STORAGE_KEY]: "{not json",
    });
    expect(loadLabInspectorPreference(storage)).toEqual(
      DEFAULT_LAB_INSPECTOR_PREFERENCE,
    );
  });

  test("defaults when the stored shape is invalid", () => {
    const storage = memoryStorage({
      [LAB_INSPECTOR_STORAGE_KEY]: JSON.stringify({
        collapsed: "nope",
        activeTab: "agent",
      }),
    });
    expect(loadLabInspectorPreference(storage)).toEqual(
      DEFAULT_LAB_INSPECTOR_PREFERENCE,
    );
  });

  test("round-trips a saved preference", () => {
    const storage = memoryStorage();
    saveLabInspectorPreference(
      { collapsed: true, activeTab: "revisions" },
      storage,
    );
    expect(loadLabInspectorPreference(storage)).toEqual({
      collapsed: true,
      activeTab: "revisions",
    });
  });

  test("save failures never throw", () => {
    expect(() =>
      saveLabInspectorPreference(
        { collapsed: false, activeTab: "agent" },
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        },
      ),
    ).not.toThrow();
  });
});
