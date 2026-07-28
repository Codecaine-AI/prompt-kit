export interface AutosaveControllerState {
  pending: boolean;
  saving: boolean;
}

export interface AutosaveCompletion<T> {
  value: T;
  revision: number;
  isLatest: boolean;
}

export interface AutosaveScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveControllerOptions<T, R> {
  save: (value: T) => Promise<R>;
  delayMs?: number;
  scheduler?: AutosaveScheduler;
  onStateChange?: (state: AutosaveControllerState) => void;
  onAttempt?: (value: T) => void;
  onSuccess?: (result: R, completion: AutosaveCompletion<T>) => void;
  onFailure?: (error: unknown, completion: AutosaveCompletion<T>) => void;
}

export interface AutosaveController<T> {
  /** Debounces a save for the supplied value. */
  schedule(value: T): void;
  /** Runs the latest scheduled value immediately. */
  flush(): void;
  /** Re-attempts the latest value immediately. */
  retry(): void;
  /** Clears queued work and supersedes any save already in flight. */
  cancelPending(): void;
  /** Stops timers and suppresses completion callbacks. */
  dispose(): void;
  getState(): AutosaveControllerState;
}

const defaultScheduler: AutosaveScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

/**
 * Coordinates debounced saves while keeping at most one request in flight.
 *
 * A queued save becomes trailing work when its debounce expires during an
 * active request. A later edit resets that debounce and replaces the queued
 * value, so only the newest value is persisted.
 */
export function createAutosaveController<T, R>(
  options: AutosaveControllerOptions<T, R>,
): AutosaveController<T> {
  const scheduler = options.scheduler ?? defaultScheduler;
  const delayMs = options.delayMs ?? 1_500;

  let timer: unknown;
  let hasTimer = false;
  let saving = false;
  let activeRevision: number | undefined;
  let trailing = false;
  let disposed = false;
  let revision = 0;
  let latest: { value: T; revision: number } | undefined;
  let emittedState: AutosaveControllerState = {
    pending: false,
    saving: false,
  };

  function state(): AutosaveControllerState {
    return {
      pending: hasTimer || trailing,
      saving,
    };
  }

  function emitState() {
    if (disposed) return;
    const next = state();
    if (
      next.pending === emittedState.pending &&
      next.saving === emittedState.saving
    ) {
      return;
    }
    emittedState = next;
    options.onStateChange?.(next);
  }

  function clearTimer() {
    if (!hasTimer) return;
    scheduler.clearTimeout(timer);
    timer = undefined;
    hasTimer = false;
  }

  function completionFor(
    attempt: { value: T; revision: number },
  ): AutosaveCompletion<T> {
    return {
      ...attempt,
      isLatest: latest?.revision === attempt.revision,
    };
  }

  function finish(
    attempt: { value: T; revision: number },
    outcome:
      | { ok: true; result: R }
      | { ok: false; error: unknown },
  ) {
    if (!disposed) {
      const completion = completionFor(attempt);
      if (outcome.ok) {
        options.onSuccess?.(outcome.result, completion);
      } else {
        options.onFailure?.(outcome.error, completion);
      }
    }

    saving = false;
    activeRevision = undefined;
    if (disposed) return;

    if (trailing) {
      trailing = false;
      startLatest();
      return;
    }
    emitState();
  }

  function startLatest() {
    clearTimer();
    if (disposed || !latest) {
      emitState();
      return;
    }
    if (saving) {
      trailing = true;
      emitState();
      return;
    }

    const attempt = latest;
    saving = true;
    activeRevision = attempt.revision;
    trailing = false;
    emitState();
    options.onAttempt?.(attempt.value);

    let operation: Promise<R>;
    try {
      operation = options.save(attempt.value);
    } catch (error) {
      finish(attempt, { ok: false, error });
      return;
    }

    void operation.then(
      (result) => finish(attempt, { ok: true, result }),
      (error: unknown) => finish(attempt, { ok: false, error }),
    );
  }

  function runImmediately() {
    if (disposed || !latest) return;
    clearTimer();
    if (saving) {
      if (latest.revision !== activeRevision) {
        trailing = true;
        emitState();
      }
      return;
    }
    startLatest();
  }

  return {
    schedule(value) {
      if (disposed) return;
      revision += 1;
      latest = { value, revision };
      clearTimer();
      trailing = false;
      hasTimer = true;
      timer = scheduler.setTimeout(() => {
        hasTimer = false;
        timer = undefined;
        startLatest();
      }, delayMs);
      emitState();
    },
    flush: runImmediately,
    retry: runImmediately,
    cancelPending() {
      if (disposed) return;
      revision += 1;
      latest = undefined;
      clearTimer();
      trailing = false;
      emitState();
    },
    dispose() {
      if (disposed) return;
      clearTimer();
      trailing = false;
      latest = undefined;
      revision += 1;
      disposed = true;
    },
    getState: state,
  };
}
