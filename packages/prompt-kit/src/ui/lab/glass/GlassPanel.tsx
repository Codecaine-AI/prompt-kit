// A persistent 44px rail; the outline and AI expand left over the document.
// View controls keep the same position in all three states.
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, FileText, ListTree, Sparkles, Wrench } from "lucide-react";
import { ANNOTATE_COLORS } from "../annotate/AmbientWash";
import { EDITOR_COLORS } from "../../surface/editor-surface";
import type { LabView, PanelViewEntry } from "./zones";
import { useViewTransition } from "./use-view-transition";
import { RailButton } from "./RailButton";
import { ContextIcon, StateIcon } from "./RailIcons";

export type LabPanelTab = "edit" | "ai";
export const PANEL_GEOMETRY = {
  rail: { width: 44 },
  edit: { width: 252, height: 480 },
  ai: { width: 520, heightFraction: 0.8 },
} as const;
export const PANEL_TOP_INSET = 12;
const PANEL_BOTTOM_GAP = 12;
const PANEL_HEADER_HEIGHT = 40;
/** Only the rail reserves document space, including while AI is open. */
export const DOCK_DEFAULT_WIDTH: number = PANEL_GEOMETRY.rail.width;

const VIEW_LABELS: Record<LabView, string> = {
  system: "Prompt", context: "Context", state: "State", tools: "Tools",
};
const VIEW_ICONS = { system: FileText, context: ContextIcon, state: StateIcon, tools: Wrench };
export interface GlassPanelProps {
  tab: LabPanelTab;
  onTabSelect: (tab: LabPanelTab) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  views: PanelViewEntry[];
  activeView: LabView;
  onViewSelect: (view: LabView) => void;
  /** An exceptional save state remains discoverable when collapsed. */
  promptStatus?: string;
  busy?: boolean;
  topInset?: number;
  children: ReactNode;
}

export function GlassPanel({
  tab, onTabSelect, expanded, onExpandedChange, views, activeView,
  onViewSelect, promptStatus, busy = false, topInset = PANEL_TOP_INSET, children,
}: GlassPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const viewContentRef = useViewTransition(`${tab}:${activeView}`);
  const contentId = useId();
  const [regionHeight, setRegionHeight] = useState<number | null>(null);
  const [regionWidth, setRegionWidth] = useState<number | null>(null);
  const ai = tab === "ai";
  const open = ai || expanded;
  const state = ai ? "ai" : expanded ? "tree" : "rail";
  const active = views.find((entry) => entry.id === activeView);
  // Shared header, 32px buttons, 4px gaps, one 9px separator, padding, border.
  const railHeight = PANEL_HEADER_HEIGHT + views.length * 36 + 59;
  const width = ai ? PANEL_GEOMETRY.ai.width : expanded ? PANEL_GEOMETRY.edit.width : DOCK_DEFAULT_WIDTH;
  const contentWidth = (ai ? PANEL_GEOMETRY.ai.width : PANEL_GEOMETRY.edit.width) - DOCK_DEFAULT_WIDTH;

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const region = panelRef.current?.parentElement;
    if (!region) return;
    const measure = () => {
      const bounds = region.getBoundingClientRect();
      setRegionHeight(bounds.height);
      setRegionWidth(bounds.width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  // Move focus out of content that becomes hidden, including Escape from AI.
  useEffect(() => {
    if (!open && panelRef.current?.querySelector("[data-lab-panel-content]")?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
  }, [open]);

  const cap = regionHeight === null ? null : Math.max(0, regionHeight - topInset - PANEL_BOTTOM_GAP);
  const naturalHeight = ai
    ? regionHeight === null ? 480 : Math.round(regionHeight * PANEL_GEOMETRY.ai.heightFraction)
    : expanded ? PANEL_GEOMETRY.edit.height : railHeight;

  function toggle() {
    if (open) {
      onExpandedChange(false);
      if (ai) onTabSelect("edit");
    } else onExpandedChange(true);
  }

  return (
    <div
      ref={panelRef}
      data-lab-dock=""
      data-lab-panel-state={state}
      data-lab-float-mode={ai ? "annotate" : "dock"}
      {...(ai ? { "data-lab-annotate-panel": "" } : {})}
      role="complementary"
      aria-label={ai ? "AI workspace" : "Prompt navigation"}
      className="absolute z-30 flex overflow-hidden rounded-lg border"
      style={{
        top: topInset,
        right: "var(--prompt-editor-panel-right, 24px)",
        width,
        height: cap === null ? naturalHeight : Math.min(naturalHeight, cap),
        maxWidth: "calc(100% - var(--prompt-editor-panel-right, 24px) - 8px)",
        maxHeight: `calc(100% - ${topInset + PANEL_BOTTOM_GAP}px)`,
        transition: "width 340ms cubic-bezier(0.2, 0.7, 0.2, 1), height 340ms cubic-bezier(0.2, 0.7, 0.2, 1)",
        background: `color-mix(in srgb, var(--prompt-editor-glass-bg, ${EDITOR_COLORS.bg}) 88%, transparent)`,
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        borderColor: ai ? ANNOTATE_COLORS.line : "var(--prompt-editor-panel-border, rgb(128 128 128 / 0.22))",
        boxShadow: "var(--prompt-editor-panel-shadow, 0 8px 28px rgb(0 0 0 / 0.24), 0 2px 6px rgb(0 0 0 / 0.12), inset 0 1px 0 rgb(255 255 255 / 0.07))",
      }}
    >
      <div
        id={contentId}
        data-lab-panel-content=""
        aria-hidden={!open}
        inert={!open}
        className="absolute inset-y-0 flex min-h-0 flex-col"
        style={{
          right: 42,
          // Keep text at its final measure while the outer glass reveals it.
          width: `min(${contentWidth}px, calc(${regionWidth === null ? "100vw" : `${regionWidth}px`} - var(--prompt-editor-panel-right, 24px) - 52px))`,
          opacity: open ? 1 : 0,
          visibility: open ? "visible" : "hidden",
          transition: open ? "opacity 180ms ease 50ms, visibility 0s" : "opacity 110ms ease, visibility 0s 110ms",
        }}
      >
        <header data-lab-annotate-panel-header="" className="flex shrink-0 items-center gap-2 border-b px-3" style={{ height: PANEL_HEADER_HEIGHT, borderColor: EDITOR_COLORS.guide }}>
          {ai && <RailButton type="button" data-lab-panel-tab="edit" aria-label="Edit" tip="Return to navigation" onClick={() => onTabSelect("edit")} className="rounded p-1 text-muted-foreground hover:bg-foreground/5"><ArrowLeft size={14} aria-hidden /></RailButton>}
          <span className="min-w-0 truncate text-[12px] font-medium">{ai ? "Annotations" : VIEW_LABELS[activeView]}</span>
          {!ai && <span className="ml-auto text-[10px] tabular-nums text-muted-foreground" title={`Estimated tokens in the ${activeView} view`}>{active?.tokens.toLocaleString()} tok</span>}
        </header>
        <div data-lab-panel-scroll="" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 pb-2 pt-1">
          <div ref={viewContentRef} data-lab-view-content="" className={ai ? "h-full" : undefined}>{children}</div>
        </div>
      </div>
      <nav
        aria-label="Prompt views"
        data-lab-persistent-rail=""
        className="absolute inset-y-0 right-0 flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ width: 42, borderLeft: `1px solid ${open ? EDITOR_COLORS.guide : "transparent"}`, transition: "border-color 180ms ease" }}
      >
        <div data-lab-rail-header="" className="flex shrink-0 items-center justify-center border-b" style={{ height: PANEL_HEADER_HEIGHT, borderColor: EDITOR_COLORS.guide }}>
        <RailButton ref={toggleRef} type="button" data-lab-rail-toggle="" aria-label={open ? "Collapse outline" : "Expand outline"} aria-expanded={open} aria-controls={contentId} tip={open ? "Collapse outline" : "Expand outline"} onClick={toggle} className="lab-rail-button">
          {open ? <ChevronRight size={16} aria-hidden /> : <ListTree size={16} aria-hidden />}
        </RailButton>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 py-1.5">
        {views.map((entry) => {
          const Icon = VIEW_ICONS[entry.id];
          const current = !ai && entry.id === activeView;
          const status = entry.id === "system" ? promptStatus : undefined;
          return <RailButton
            key={entry.id} type="button" data-lab-view={entry.id}
            aria-label={`${VIEW_LABELS[entry.id]}${status ? `: ${status}` : ""}`}
            aria-pressed={current}
            tip={entry.id === "system" ? "System" : VIEW_LABELS[entry.id]}
            onClick={() => { onViewSelect(entry.id); onExpandedChange(true); }}
            className="lab-rail-button relative"
            style={current ? { color: EDITOR_COLORS.selectionAccent, background: EDITOR_COLORS.hoverBg } : undefined}
          ><Icon size={16} aria-hidden />{status && <span data-lab-save-indicator="" aria-hidden className="absolute right-1 top-1 h-1 w-1 rounded-full bg-amber-400" />}</RailButton>;
        })}
        <span aria-hidden className="my-1 h-px w-5 shrink-0" style={{ background: EDITOR_COLORS.guide }} />
        <RailButton type="button" data-lab-panel-tab="ai" aria-label="AI" aria-pressed={ai} tip={ai ? "Return to navigation" : "AI workspace"} onClick={() => onTabSelect(ai ? "edit" : "ai")} className="lab-rail-button relative mt-auto" style={{ color: ANNOTATE_COLORS.accentLit, background: ai ? ANNOTATE_COLORS.fill : undefined }}>
          <Sparkles size={16} aria-hidden />
          {busy && <span data-lab-annotate-dot="fast" role="status" aria-label="AI is working" className="absolute right-1 top-1 h-1 w-1 rounded-full" style={{ background: ANNOTATE_COLORS.accentLit }} />}
        </RailButton>
        </div>
      </nav>
      <style>{`
        [data-lab-persistent-rail], [data-lab-panel-scroll] { scrollbar-width:none; }
        [data-lab-persistent-rail]::-webkit-scrollbar, [data-lab-panel-scroll]::-webkit-scrollbar { display:none; }
        [data-lab-dock] .lab-rail-button { display:flex; align-items:center; justify-content:center; width:32px; height:32px; flex-shrink:0; border-radius:4px; color:var(--prompt-editor-muted, #989FA9); transition:background-color 160ms ease, color 160ms ease; }
        [data-lab-dock] .lab-rail-button:hover { background:var(--prompt-editor-hover-bg, rgb(255 255 255 / 0.04)); }
        [data-lab-dock] button:focus-visible { outline:2px solid var(--prompt-editor-selection-accent, #6E9ECF); outline-offset:-2px; }
        @media (prefers-reduced-motion: reduce) { [data-lab-dock], [data-lab-dock] * { transition:none !important; } }
      `}</style>
    </div>
  );
}
