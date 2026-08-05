import { describe, expect, test } from "bun:test";

import {
  createAutosaveController,
  type AutosaveScheduler,
} from "../../../src/ui/lab/autosave-controller";

class ManualScheduler implements AutosaveScheduler {
  now = 0;
  nextId = 1;
  tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.at - right.at || leftId - rightId,
        )[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  return { promise, resolve, reject };
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createAutosaveController", () => {
  test("saves 1500ms after the last edit", async () => {
    const scheduler = new ManualScheduler();
    const saved: string[] = [];
    const controller = createAutosaveController({
      scheduler,
      save: async (value: string) => {
        saved.push(value);
        return value;
      },
    });

    controller.schedule("first");
    scheduler.advance(1_499);
    expect(saved).toEqual([]);

    controller.schedule("latest");
    scheduler.advance(1_499);
    expect(saved).toEqual([]);

    scheduler.advance(1);
    expect(saved).toEqual(["latest"]);
    await settlePromises();
    expect(controller.getState()).toEqual({ pending: false, saving: false });
  });

  test("runs one trailing save after an active save resolves", async () => {
    const scheduler = new ManualScheduler();
    const first = deferred<string>();
    const saved: string[] = [];
    const controller = createAutosaveController({
      scheduler,
      save(value: string) {
        saved.push(value);
        return saved.length === 1 ? first.promise : Promise.resolve(value);
      },
    });

    controller.schedule("first");
    scheduler.advance(1_500);
    expect(saved).toEqual(["first"]);

    controller.schedule("second");
    scheduler.advance(500);
    controller.schedule("latest");
    scheduler.advance(1_499);
    expect(saved).toEqual(["first"]);

    scheduler.advance(1);
    expect(controller.getState()).toEqual({ pending: true, saving: true });
    expect(saved).toEqual(["first"]);

    first.resolve("first");
    await settlePromises();
    expect(saved).toEqual(["first", "latest"]);
    await settlePromises();
    expect(controller.getState()).toEqual({ pending: false, saving: false });
  });

  test("flush saves pending work immediately", async () => {
    const scheduler = new ManualScheduler();
    const saved: string[] = [];
    const controller = createAutosaveController({
      scheduler,
      save: async (value: string) => {
        saved.push(value);
        return value;
      },
    });

    controller.schedule("draft");
    scheduler.advance(200);
    controller.flush();

    expect(saved).toEqual(["draft"]);
    expect(controller.getState()).toEqual({ pending: false, saving: true });
    scheduler.advance(2_000);
    expect(saved).toEqual(["draft"]);
    await settlePromises();
  });

  test("flush does not duplicate the active value", async () => {
    const scheduler = new ManualScheduler();
    const active = deferred<string>();
    const saved: string[] = [];
    const controller = createAutosaveController({
      scheduler,
      save(value: string) {
        saved.push(value);
        return active.promise;
      },
    });

    controller.schedule("draft");
    scheduler.advance(1_500);
    controller.flush();
    active.resolve("draft");
    await settlePromises();

    expect(saved).toEqual(["draft"]);
    expect(controller.getState()).toEqual({ pending: false, saving: false });
  });

  test("retry immediately re-attempts the latest failed value", async () => {
    const scheduler = new ManualScheduler();
    const failure = new Error("offline");
    const attempts: string[] = [];
    const failures: unknown[] = [];
    const successes: string[] = [];
    const controller = createAutosaveController({
      scheduler,
      save(value: string) {
        attempts.push(value);
        return attempts.length === 1
          ? Promise.reject(failure)
          : Promise.resolve(value);
      },
      onFailure(error) {
        failures.push(error);
      },
      onSuccess(result) {
        successes.push(result);
      },
    });

    controller.schedule("draft");
    scheduler.advance(1_500);
    await settlePromises();

    expect(failures).toEqual([failure]);
    expect(controller.getState()).toEqual({ pending: false, saving: false });

    controller.retry();
    expect(attempts).toEqual(["draft", "draft"]);
    await settlePromises();
    expect(successes).toEqual(["draft"]);
  });

  test("marks an in-flight completion as superseded by a later edit", async () => {
    const scheduler = new ManualScheduler();
    const first = deferred<string>();
    const completions: Array<{ value: string; isLatest: boolean }> = [];
    const controller = createAutosaveController({
      scheduler,
      save: (value: string) =>
        value === "first" ? first.promise : Promise.resolve(value),
      onSuccess(_result, completion) {
        completions.push({
          value: completion.value,
          isLatest: completion.isLatest,
        });
      },
    });

    controller.schedule("first");
    scheduler.advance(1_500);
    controller.schedule("second");
    first.resolve("first");
    await settlePromises();

    expect(completions).toEqual([{ value: "first", isLatest: false }]);
    scheduler.advance(1_500);
    await settlePromises();
    expect(completions).toEqual([
      { value: "first", isLatest: false },
      { value: "second", isLatest: true },
    ]);
  });

  test("cancelPending clears queued work and supersedes an active save", async () => {
    const scheduler = new ManualScheduler();
    const active = deferred<string>();
    const completions: boolean[] = [];
    const controller = createAutosaveController({
      scheduler,
      save: () => active.promise,
      onSuccess(_result, completion) {
        completions.push(completion.isLatest);
      },
    });

    controller.schedule("draft");
    scheduler.advance(1_500);
    controller.cancelPending();
    active.resolve("draft");
    await settlePromises();

    expect(completions).toEqual([false]);
    expect(controller.getState()).toEqual({ pending: false, saving: false });
  });
});
