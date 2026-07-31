"use client";

// Lab statusbar: LEFT holds wayfinding (view tabs and the active view's token
// count); RIGHT holds editing state (autosave status) and the
// collapsed-inspector affordance. Validity surfaces only through the save
// status here — diagnostics detail lives in the DETAILS tab. Undo/redo are
// keyboard-only (⌘Z / ⌘⇧Z, bound in the lab root) — no statusbar buttons.

import cn from "classnames";
import { MessageSquarePlus, PanelRightOpen } from "lucide-react";

export type LabView = "system" | "context";

export interface LabStatusBarProps {
  view: LabView;
  onViewChange: (view: LabView) => void;
  /** Token estimate for the ACTIVE view (system prompt or assembled context). */
  tokenCount: number;
  errorCount: number;
  dirty: boolean;
  hasSave: boolean;
  savePending: boolean;
  saving: boolean;
  saveErrors?: string[];
  lastSavedAt?: Date;
  inspectorCollapsed: boolean;
  /** Whether the lab is in annotate mode (the ANNOTATE toggle's pressed state). */
  annotateMode: boolean;
  onRetrySave: () => void;
  onOpenInspector: () => void;
  onToggleAnnotate: () => void;
}

export function LabStatusBar({
  view,
  onViewChange,
  tokenCount,
  errorCount,
  dirty,
  hasSave,
  savePending,
  saving,
  saveErrors = [],
  lastSavedAt,
  inspectorCollapsed,
  annotateMode,
  onRetrySave,
  onOpenInspector,
  onToggleAnnotate,
}: LabStatusBarProps) {
  const inContext = view === "context";

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 font-mono">
      {/* LEFT: view tabs · active-view token count. */}
      <div className="flex h-full shrink-0 items-stretch">
        <ViewTab
          active={view === "system"}
          onClick={() => onViewChange("system")}
        >
          System
        </ViewTab>
        <ViewTab
          active={view === "context"}
          onClick={() => onViewChange("context")}
        >
          Context
        </ViewTab>
      </div>

      <span aria-hidden className="h-4 w-px shrink-0 bg-border" />

      <span
        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
        title={
          inContext
            ? "Estimated tokens in the assembled context"
            : "Estimated tokens in the system prompt"
        }
      >
        {tokenCount.toLocaleString()} tok
      </span>

      {/* RIGHT: editing state — hidden entirely in the read-only context
          view — then the collapsed-inspector affordance. */}
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
        {!inContext && (
          <>
            <AutosaveStatus
              dirty={dirty}
              errorCount={errorCount}
              hasSave={hasSave}
              pending={savePending}
              saving={saving}
              saveErrors={saveErrors}
              lastSavedAt={lastSavedAt}
              retryDisabled={errorCount > 0 || !hasSave}
              onRetry={onRetrySave}
            />
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          </>
        )}

        {/* MODE toggle: annotate swaps the right-hand inspector for the
            annotations pane. Always visible — annotate mode is a lab-wide
            mode, not an editing control. */}
        <button
          type="button"
          onClick={onToggleAnnotate}
          aria-pressed={annotateMode}
          title={annotateMode ? "Exit annotate mode" : "Enter annotate mode"}
          className={cn(
            "ml-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] transition-colors",
            annotateMode
              ? "border-status-info/40 bg-status-info-fill/30 text-status-info"
              : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <MessageSquarePlus size={13} />
          Annotate
        </button>

        {inspectorCollapsed && (
          <button
            type="button"
            onClick={onOpenInspector}
            className="ml-1 inline-flex h-6 items-center gap-1.5 rounded-[2px] border border-border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <PanelRightOpen size={13} />
            Inspect
          </button>
        )}
      </div>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-full items-center px-3 text-[11px] uppercase tracking-[0.12em] transition-colors",
        active
          ? "bg-status-info-fill/30 text-status-info"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function AutosaveStatus({
  dirty,
  errorCount,
  hasSave,
  pending,
  saving,
  saveErrors,
  lastSavedAt,
  retryDisabled,
  onRetry,
}: {
  dirty: boolean;
  errorCount: number;
  hasSave: boolean;
  pending: boolean;
  saving: boolean;
  saveErrors: string[];
  lastSavedAt?: Date;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  if (dirty && errorCount > 0) {
    return (
      <span className="whitespace-nowrap text-[11px] text-destructive/70">
        unsaved — {errorCount} {errorCount === 1 ? "error" : "errors"}
      </span>
    );
  }

  if (dirty && hasSave && (pending || saving)) {
    return (
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        saving…
      </span>
    );
  }

  if (dirty && saveErrors.length > 0) {
    const firstLine = saveErrors[0]?.split(/\r?\n/, 1)[0] ?? "Save failed";
    return (
      <span
        className="whitespace-nowrap text-[11px] text-destructive"
        title={firstLine}
      >
        save failed —{" "}
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="underline underline-offset-2 hover:text-destructive/80 disabled:cursor-not-allowed disabled:no-underline"
        >
          retry
        </button>
      </span>
    );
  }

  if (dirty) {
    return (
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        unsaved
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
      saved
      {lastSavedAt ? ` ${formatSaveTime(lastSavedAt)}` : ""}
    </span>
  );
}

function formatSaveTime(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
