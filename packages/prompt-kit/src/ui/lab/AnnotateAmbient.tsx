// Slice: the mode as a TEMPERATURE, not a gesture. Entering annotate mode
// moves nothing and resizes nothing — one restrained desaturated violet
// appears in two places at once:
//
//   (a) the dock's hairlines and zone micro-headers tint toward it,
//   (b) the target rows of in-flight work shimmer where the work is happening.
//
// Retired: the status chip (its breathing dot lives in the glass panel's AI
// tab now) and the far-left edge line (2026-08-05 — read as stray chrome).
"use client";

/**
 * The mode's hue, one step off the surface's tag purple, behind host-
 * overridable custom properties like every other colour in the lab.
 */
export const ANNOTATE_COLORS = {
	accent: "var(--prompt-annotate-accent, #8A7AB0)",
	accentLit: "var(--prompt-annotate-accent-lit, #AD9DD0)",
	accentDim: "var(--prompt-annotate-accent-dim, #7A6D98)",
	line: "var(--prompt-annotate-line, rgb(138 122 176 / 0.26))",
	wash: "var(--prompt-annotate-wash, rgb(138 122 176 / 0.075))",
	fill: "var(--prompt-annotate-fill, rgb(138 122 176 / 0.055))",
	panel: "var(--prompt-editor-panel-bg, #181818)",
} as const;

/**
 * Signal (a) + (b): the dock tint and the working shimmer, as one stylesheet
 * mounted only while the mode is on.
 *
 * The shimmer is keyed on `data-row-index` rather than the node id because
 * prompt node ids are user-editable and may carry selector metacharacters;
 * row indices are integers the lab already derives from the line model.
 * `!important` is required (not decorative): `XmlRow` paints its zebra tint
 * through the inline `background` SHORTHAND, which would otherwise reset the
 * gradient this rule installs.
 */
export function annotateAmbientCss(shimmerRows: readonly number[]): string {
	const rowSelector = shimmerRows
		.map(
			(row) =>
				`[data-annotation-targeting="true"] [data-row-index="${row}"]`,
		)
		.join(",\n  ");
	return `
  @keyframes prompt-annotate-shimmer {
    from { background-position: -130% 0; }
    to   { background-position: 230% 0; }
  }
  @keyframes prompt-annotate-breathe {
    0%, 100% { opacity: 0.3; transform: scale(0.82); }
    50%      { opacity: 1;   transform: scale(1); }
  }
  [data-lab-dock][data-lab-annotating="true"] [data-lab-zone] {
    border-bottom-color: ${ANNOTATE_COLORS.line};
  }
  [data-lab-dock][data-lab-annotating="true"] [data-lab-zone-header] {
    color: ${ANNOTATE_COLORS.accentDim};
  }
${
	rowSelector
		? `  ${rowSelector} {
    background-image: linear-gradient(100deg,
      rgb(138 122 176 / 0) 22%,
      rgb(138 122 176 / 0.19) 46%,
      rgb(138 122 176 / 0.05) 58%,
      rgb(138 122 176 / 0) 76%) !important;
    background-size: 230% 100% !important;
    background-repeat: no-repeat !important;
    animation: prompt-annotate-shimmer 1.6s linear infinite !important;
    box-shadow: inset 2px 0 0 ${ANNOTATE_COLORS.accent};
  }`
		: ""
}
  @media (prefers-reduced-motion: reduce) {
    [data-lab-annotate-chip] [data-lab-annotate-dot],
    [data-annotation-targeting="true"] [data-row-index] {
      animation: none !important;
    }
  }
`;
}

export interface AnnotateAmbientProps {
	/** Annotate mode is on. */
	active: boolean;
	/** Line-model row indices to wash with the working shimmer. */
	shimmerRows: readonly number[];
}

/** The stylesheet carrying (a) and (b) — nothing else renders. */
export function AnnotateAmbient({ active, shimmerRows }: AnnotateAmbientProps) {
	if (!active) return null;

	return <style>{annotateAmbientCss(shimmerRows)}</style>;
}
