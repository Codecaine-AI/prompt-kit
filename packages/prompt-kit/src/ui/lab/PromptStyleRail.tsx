import {
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import type { PromptStyleSettings } from "../style/prompt-style-settings";

export interface PromptStyleRailProps {
  settings: PromptStyleSettings;
  onChange: (next: PromptStyleSettings) => void;
  onReset: () => void;
  onClose: () => void;
  className?: string;
}

const FONT_OPTIONS: Array<{
  value: PromptStyleSettings["fontFamily"];
  label: string;
}> = [
  { value: "system", label: "System mono" },
  { value: "sf-mono", label: "SF Mono" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
];

/**
 * A controlled, viewer-only style rail. The host owns its visibility,
 * persistence, and application to prompt surfaces.
 */
export function PromptStyleRail({
  settings,
  onChange,
  onReset,
  onClose,
  className,
}: PromptStyleRailProps) {
  function update<K extends keyof PromptStyleSettings>(
    key: K,
    value: PromptStyleSettings[K],
  ) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <aside
      aria-label="Prompt style"
      className={[
        "flex h-full min-w-0 flex-col bg-card text-foreground",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <SlidersHorizontal
          aria-hidden
          className="text-muted-foreground"
          size={15}
        />
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em]">
          Style
        </h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info-border"
          title="Reset to defaults"
          aria-label="Reset to defaults"
        >
          <RotateCcw aria-hidden size={13} />
          <span>Reset</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info-border"
          title="Close style sidebar"
          aria-label="Close style sidebar"
        >
          <X aria-hidden size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {/* ONE global theme (2026-08-04 audit): presets retired — these
            controls adjust the shared baseline directly. */}
        <p className="text-[11px] leading-4 text-muted-foreground">
          Appearance only — prompt content, hashes, and revisions never
          change.
        </p>

        <RailSection title="Type" defaultOpen>
          <label className="grid gap-1.5">
            <span className="text-xs text-foreground">Font family</span>
            <select
              value={settings.fontFamily}
              onChange={(event) =>
                update(
                  "fontFamily",
                  event.currentTarget
                    .value as PromptStyleSettings["fontFamily"],
                )
              }
              className={selectClassName}
            >
              {FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <RangeField
            label="Font size"
            value={settings.fontSize}
            min={10}
            max={24}
            step={0.5}
            unit="px"
            onChange={(value) => update("fontSize", value)}
          />
          <RangeField
            label="Line height"
            value={settings.lineHeight}
            min={14}
            max={40}
            step={1}
            unit="px"
            onChange={(value) => update("lineHeight", value)}
          />
          <RangeField
            label="Letter spacing"
            value={settings.letterSpacing}
            min={-0.05}
            max={0.15}
            step={0.01}
            unit="em"
            fractionDigits={2}
            onChange={(value) => update("letterSpacing", value)}
          />
        </RailSection>

        <RailSection title="Layout">
          <RangeField
            label="Indent"
            value={settings.indentWidth}
            min={12}
            max={48}
            step={2}
            unit="px"
            onChange={(value) => update("indentWidth", value)}
          />
          <RangeField
            label="Content width"
            value={settings.contentWidth}
            min={60}
            max={180}
            step={2}
            unit="ch"
            onChange={(value) => update("contentWidth", value)}
          />
          <RangeField
            label="Left margin"
            value={settings.marginLeft}
            min={0}
            max={240}
            step={4}
            unit="px"
            onChange={(value) => update("marginLeft", value)}
          />
          <RangeField
            label="Top margin"
            value={settings.marginTop}
            min={0}
            max={160}
            step={4}
            unit="px"
            onChange={(value) => update("marginTop", value)}
          />
          <RangeField
            label="Panel inset"
            value={settings.panelInset}
            min={8}
            max={96}
            step={2}
            unit="px"
            onChange={(value) => update("panelInset", value)}
          />
          <RangeField
            label="Panel top inset"
            value={settings.panelTopInset}
            min={0}
            max={120}
            step={2}
            unit="px"
            onChange={(value) => update("panelTopInset", value)}
          />
          <RangeField
            label="Composer width"
            value={settings.composerWidth}
            min={320}
            max={1600}
            step={20}
            unit="px"
            onChange={(value) => update("composerWidth", value)}
          />
          <RangeField
            label="Landmark scale"
            value={settings.landmarkFontScale}
            min={1}
            max={1.2}
            step={0.01}
            unit="×"
            fractionDigits={2}
            onChange={(value) => update("landmarkFontScale", value)}
          />
          <RangeField
            label="Section gap ramp"
            value={settings.gapRamp}
            min={0}
            max={1}
            step={0.05}
            percent
            onChange={(value) => update("gapRamp", value)}
          />
          <ToggleField
            label="Indent guides"
            checked={settings.showGuides}
            onChange={(checked) => update("showGuides", checked)}
          />
        </RailSection>

        <RailSection title="Syntax colors">
          <div className="space-y-1">
            <ColorField
              label="Surface"
              value={settings.surfaceColor}
              onChange={(value) => update("surfaceColor", value)}
            />
            <ColorField
              label="Text"
              value={settings.foregroundColor}
              onChange={(value) => update("foregroundColor", value)}
            />
            <ColorField
              label="Tag marks"
              value={settings.tagPunctuationColor}
              onChange={(value) => update("tagPunctuationColor", value)}
            />
            <ColorField
              label="Tag name"
              value={settings.tagNameColor}
              onChange={(value) => update("tagNameColor", value)}
            />
            <ColorField
              label="Landmark tag"
              value={settings.tagLandmarkColor}
              onChange={(value) => update("tagLandmarkColor", value)}
            />
            <ColorField
              label="Sub-landmark tag"
              value={settings.tagSublandmarkColor}
              onChange={(value) => update("tagSublandmarkColor", value)}
            />
            <ColorField
              label="Attribute"
              value={settings.attributeNameColor}
              onChange={(value) => update("attributeNameColor", value)}
            />
            <ColorField
              label="Attr value"
              value={settings.attributeValueColor}
              onChange={(value) => update("attributeValueColor", value)}
            />
            <ColorField
              label="Variable"
              value={settings.variableColor}
              onChange={(value) => update("variableColor", value)}
            />
            <ColorField
              label="Reference"
              value={settings.referenceColor}
              onChange={(value) => update("referenceColor", value)}
            />
            <ColorField
              label="Inline code"
              value={settings.inlineCodeColor}
              onChange={(value) => update("inlineCodeColor", value)}
            />
            <ColorField
              label="List marker"
              value={settings.listMarkerColor}
              onChange={(value) => update("listMarkerColor", value)}
            />
          </div>
        </RailSection>

        <RailSection title="Marks">
          <div className="space-y-1">
            <ColorField
              label="Guide"
              value={settings.guideColor}
              onChange={(value) => update("guideColor", value)}
            />
          </div>
          <RangeField
            label="Guide opacity"
            value={settings.guideOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("guideOpacity", value)}
          />
          <RangeField
            label="Inline chip opacity"
            value={settings.inlineChipOpacity}
            min={0}
            max={0.3}
            step={0.01}
            percent
            onChange={(value) => update("inlineChipOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Landmark"
              value={settings.landmarkColor}
              onChange={(value) => update("landmarkColor", value)}
            />
          </div>
          <RangeField
            label="Landmark opacity"
            value={settings.landmarkOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("landmarkOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Gutter"
              value={settings.gutterColor}
              onChange={(value) => update("gutterColor", value)}
            />
            <ColorField
              label="Line number"
              value={settings.lineNumberColor}
              onChange={(value) => update("lineNumberColor", value)}
            />
            <ColorField
              label="Active number"
              value={settings.activeLineNumberColor}
              onChange={(value) => update("activeLineNumberColor", value)}
            />
          </div>
        </RailSection>

        <RailSection title="Interaction">
          <div className="space-y-1">
            <ColorField
              label="Selection"
              value={settings.selectionColor}
              onChange={(value) => update("selectionColor", value)}
            />
          </div>
          <RangeField
            label="Selection opacity"
            value={settings.selectionOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("selectionOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Selection accent"
              value={settings.selectionAccentColor}
              onChange={(value) => update("selectionAccentColor", value)}
            />
            <ColorField
              label="Active line"
              value={settings.activeLineColor}
              onChange={(value) => update("activeLineColor", value)}
            />
          </div>
          <RangeField
            label="Active line opacity"
            value={settings.activeLineOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("activeLineOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Hover"
              value={settings.hoverColor}
              onChange={(value) => update("hoverColor", value)}
            />
          </div>
          <RangeField
            label="Hover opacity"
            value={settings.hoverOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("hoverOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Grip"
              value={settings.gripColor}
              onChange={(value) => update("gripColor", value)}
            />
          </div>
          <RangeField
            label="Grip size"
            value={settings.gripSize}
            min={8}
            max={32}
            step={1}
            unit="px"
            onChange={(value) => update("gripSize", value)}
          />
          <RangeField
            label="Grip opacity"
            value={settings.gripOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("gripOpacity", value)}
          />
          <div className="space-y-1">
            <ColorField
              label="Drop line"
              value={settings.dropIndicatorColor}
              onChange={(value) => update("dropIndicatorColor", value)}
            />
          </div>
          <RangeField
            label="Drop line width"
            value={settings.dropIndicatorWidth}
            min={1}
            max={6}
            step={1}
            unit="px"
            onChange={(value) => update("dropIndicatorWidth", value)}
          />
          <RangeField
            label="Drop line opacity"
            value={settings.dropIndicatorOpacity}
            min={0}
            max={1}
            step={0.01}
            percent
            onChange={(value) => update("dropIndicatorOpacity", value)}
          />
        </RailSection>
      </div>
    </aside>
  );
}

const SECTIONS_STORAGE_KEY = "promptLab.styleRail.sections.v1";

function readOpenSections(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SECTIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Unity-inspector foldout (2026-08-04 audit): every section header is a
 * disclosure — caret + title, click to fold. Open state persists per section;
 * only Type starts open so the rail reads as a tidy index at rest.
 */
function RailSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const stored = readOpenSections();
    return typeof stored[title] === "boolean" ? stored[title] : defaultOpen;
  });

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          SECTIONS_STORAGE_KEY,
          JSON.stringify({ ...readOpenSections(), [title]: next }),
        );
      } catch {
        // Storage unavailable — session state still folds/unfolds.
      }
      return next;
    });
  }, [title]);

  return (
    <section className={open ? "space-y-3" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <ChevronRight
          aria-hidden
          size={11}
          className="shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <h3 className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </button>
      {open && children}
    </section>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit,
  percent = false,
  fractionDigits,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  percent?: boolean;
  fractionDigits?: number;
  onChange: (value: number) => void;
}) {
  const displayedValue = percent
    ? `${Math.round(value * 100)}%`
    : `${value.toFixed(fractionDigits ?? (step < 1 ? 1 : 0))}${unit ?? ""}`;

  return (
    <label className="grid gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {displayedValue}
        </span>
      </span>
      <span className="flex h-5 items-center">
        <input
          type="range"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="h-5 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-status-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info-border [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-status-info [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-status-info"
        />
      </span>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 transition-colors hover:bg-muted/35 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-status-info-border">
      <span
        className="relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded border border-border"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          aria-label={label}
          title={`Choose ${label.toLowerCase()} color`}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none"
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {label}
      </span>
      <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {value.toUpperCase()}
      </span>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-8 w-full items-center justify-between gap-3 rounded px-1 text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-status-info-border"
    >
      <span>{label}</span>
      <span
        aria-hidden
        className={[
          "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
          checked ? "bg-status-info" : "bg-muted-foreground/35",
        ].join(" ")}
      >
        <span
          className={[
            "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

const selectClassName =
  "h-9 w-full rounded border border-border bg-background/60 px-2 text-xs text-foreground outline-none transition-colors hover:border-muted-foreground/60 focus-visible:border-status-info-border focus-visible:ring-2 focus-visible:ring-status-info-border";
