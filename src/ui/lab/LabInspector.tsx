"use client";

import cn from "classnames";
import { Bot, FileSearch, History, PanelRightClose } from "lucide-react";

export type LabInspectorTab = "agent" | "details" | "revisions";

export interface LabInspectorPreference {
  collapsed: boolean;
  activeTab: LabInspectorTab;
}

export const LAB_INSPECTOR_STORAGE_KEY =
  "agentKernel.promptLabInspector.v1";

export const DEFAULT_LAB_INSPECTOR_PREFERENCE: LabInspectorPreference = {
  collapsed: false,
  activeTab: "details",
};

interface InspectorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadLabInspectorPreference(
  storage = browserStorage(),
): LabInspectorPreference {
  if (!storage) return DEFAULT_LAB_INSPECTOR_PREFERENCE;
  try {
    const parsed = JSON.parse(
      storage.getItem(LAB_INSPECTOR_STORAGE_KEY) ?? "",
    ) as Partial<LabInspectorPreference>;
    if (
      typeof parsed.collapsed !== "boolean" ||
      !isInspectorTab(parsed.activeTab)
    ) {
      return DEFAULT_LAB_INSPECTOR_PREFERENCE;
    }
    return {
      collapsed: parsed.collapsed,
      activeTab: parsed.activeTab,
    };
  } catch {
    return DEFAULT_LAB_INSPECTOR_PREFERENCE;
  }
}

export function saveLabInspectorPreference(
  preference: LabInspectorPreference,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAB_INSPECTOR_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Viewer preferences never block prompt editing.
  }
}

export function LabInspector({
  activeTab,
  onActiveTabChange,
  onCollapse,
  agent,
  details,
  revisions,
}: {
  activeTab: LabInspectorTab;
  onActiveTabChange: (tab: LabInspectorTab) => void;
  onCollapse: () => void;
  agent?: React.ReactNode;
  details: React.ReactNode;
  revisions?: React.ReactNode;
}) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border">
        <InspectorTab
          active={activeTab === "agent"}
          icon={<Bot size={12} />}
          onClick={() => onActiveTabChange("agent")}
        >
          Agent
        </InspectorTab>
        <InspectorTab
          active={activeTab === "details"}
          icon={<FileSearch size={12} />}
          onClick={() => onActiveTabChange("details")}
        >
          Details
        </InspectorTab>
        <InspectorTab
          active={activeTab === "revisions"}
          icon={<History size={12} />}
          onClick={() => onActiveTabChange("revisions")}
        >
          Revisions
        </InspectorTab>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse inspector"
          title="Collapse inspector"
          className="ml-auto inline-flex w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "agent"
          ? agent
          : activeTab === "details"
            ? details
            : revisions}
      </div>
    </aside>
  );
}

function InspectorTab({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-2 text-[11px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-status-info"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function isInspectorTab(value: unknown): value is LabInspectorTab {
  return value === "agent" || value === "details" || value === "revisions";
}

function browserStorage(): InspectorStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
