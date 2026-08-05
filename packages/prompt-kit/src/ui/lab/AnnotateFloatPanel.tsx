// THE GLASS PANEL (2026-08-05 redesign): fixed furniture, not a floating
// window. No drag, no resize, no per-user geometry — the panel sits with the
// system like an instrument, and its header is a two-tab bar:
//
//   edit — the zone stack (VIEW / FIXTURE / OUTLINE / DETAILS), the lab's
//          resting chrome. A wide text tab (~3/4 of the bar).
//   ai   — the AI workspace (active runs, requests, comments). A small icon
//          tab (~1/4); selecting it is entering the AI state, and the panel
//          animates to that tab's own size.
//
// Each tab owns its geometry in PANEL_GEOMETRY below — width, height, and
// position are set per tab, and the element stays mounted across the switch
// so the box animates between them while the content cross-fades. The host
// still reserves the panel's footprint (the document always sits beside the
// glass, never under it).
"use client";

import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { Pencil, Sparkles } from "lucide-react";

import { ANNOTATE_COLORS } from "./AnnotateAmbient";

export type LabPanelTab = "edit" | "ai";

/**
 * Per-tab geometry — THE single place to set each view's size. The panel's
 * top-right corner is PINNED (top inset below, right inset from the style
 * rail's "Panel inset"); a tab switch widens leftward and extends downward
 * from that corner instead of moving the box.
 *
 *   edit — fits its content: height follows the zone stack (capped at the
 *          region).
 *   ai   — one consistent size: a fixed fraction of the region height.
 */
export const PANEL_GEOMETRY = {
	edit: { width: 300 },
	ai: { width: 520, heightFraction: 0.8 },
} as const;

/** The pinned corner's default distance from the region's top edge — both
 * insets are adjustable in the style rail (the right inset arrives via
 * --prompt-editor-panel-right, the top inset via the `topInset` prop since
 * the fit-to-content cap math needs it as a number). */
export const PANEL_TOP_INSET = 12;
/** Clearance kept below the panel when content would run past the region. */
const PANEL_BOTTOM_GAP = 12;

export const DOCK_DEFAULT_WIDTH: number = PANEL_GEOMETRY.edit.width;

const TRANSITION_MS = 260;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** The ACTIVE tab's share of the header bar; the inactive icon tab takes the
 * rest — the tabs swap roles (wide text ⇄ small icon) on switch. */
const WIDE_TAB_FRACTION = 0.75;

/** Tab contents fade in as the widths trade places. */
const fadeIn: CSSProperties = {
	animation: `labFloatContentIn ${TRANSITION_MS}ms ${EASE}`,
};

export interface AnnotateFloatPanelProps {
	tab: LabPanelTab;
	/** Tapping a tab IS the mode switch — the host owns what each tab means. */
	onTabSelect: (tab: LabPanelTab) => void;
	/** AI: a request is in flight — the tab's dot beats faster. */
	busy?: boolean;
	/** Distance from the region's top to the pinned corner (style rail). */
	topInset?: number;
	children: ReactNode;
	/** Reports the active tab's width so the host reserves the footprint
	 * beside the document — in both states. */
	onWidthChange?: (width: number) => void;
}

export function AnnotateFloatPanel({
	tab,
	onTabSelect,
	busy = false,
	topInset = PANEL_TOP_INSET,
	children,
	onWidthChange,
}: AnnotateFloatPanelProps) {
	// Mount → next frame → visible: lets the transition-in actually run.
	const [entered, setEntered] = useState(false);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const headerRef = useRef<HTMLElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const innerRef = useRef<HTMLDivElement | null>(null);
	// Both heights resolve to PIXELS so the tab-switch height change tweens
	// (a %↔px pair would jump). Null until measured — the style falls back to
	// auto/% for the first paint and non-browser environments.
	const [regionHeight, setRegionHeight] = useState<number | null>(null);
	const [contentHeight, setContentHeight] = useState<number | null>(null);

	const ai = tab === "ai";
	const geometry = PANEL_GEOMETRY[tab];

	useEffect(() => {
		const frame = requestAnimationFrame(() => setEntered(true));
		return () => cancelAnimationFrame(frame);
	}, []);

	useEffect(() => {
		onWidthChange?.(geometry.width);
	}, [geometry.width, onWidthChange]);

	useEffect(() => {
		if (typeof ResizeObserver === "undefined") return;
		const region = panelRef.current?.parentElement;
		if (!region) return;
		const measure = () =>
			setRegionHeight(region.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(region);
		return () => observer.disconnect();
	}, []);

	// Fit-to-content (edit tab): track the zone stack's natural height so the
	// panel hugs it — and so returning from AI animates to the right size.
	useEffect(() => {
		if (typeof ResizeObserver === "undefined") return;
		if (tab !== "edit") return;
		const inner = innerRef.current;
		if (!inner) return;
		const measure = () => {
			const scroll = scrollRef.current;
			const header = headerRef.current;
			if (!scroll || !header) return;
			// The inner wrapper's height is content-intrinsic — the scroller
			// itself flex-fills the panel, so ITS scrollHeight would echo the
			// panel's current height back (and the panel would never shrink).
			const scrollStyle = window.getComputedStyle(scroll);
			const padding =
				(Number.parseFloat(scrollStyle.paddingTop) || 0) +
				(Number.parseFloat(scrollStyle.paddingBottom) || 0);
			setContentHeight(
				inner.offsetHeight + padding + header.offsetHeight + 2,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(inner);
		return () => observer.disconnect();
	}, [tab]);

	// The pinned corner leaves `cap` of room before the region's bottom.
	const cap =
		regionHeight === null
			? null
			: regionHeight - topInset - PANEL_BOTTOM_GAP;
	const height: CSSProperties["height"] = ai
		? cap === null
			? `${PANEL_GEOMETRY.ai.heightFraction * 100}%`
			: Math.round(
					Math.min(PANEL_GEOMETRY.ai.heightFraction * regionHeight!, cap),
				)
		: contentHeight === null || cap === null
			? "auto"
			: Math.min(contentHeight, cap);

	const tabStyle = (active: boolean): CSSProperties => ({
		color: active
			? ai
				? ANNOTATE_COLORS.accentLit
				: "var(--prompt-editor-foreground, #E6E6E6)"
			: "var(--prompt-editor-line-number, #5F6672)",
	});

	return (
		<div
			ref={panelRef}
			data-lab-dock=""
			data-lab-float-mode={ai ? "annotate" : "dock"}
			{...(ai ? { "data-lab-annotate-panel": "" } : {})}
			role="complementary"
			aria-label={ai ? "AI workspace" : "Lab panel"}
			className="absolute z-30 flex flex-col overflow-hidden rounded-[10px] border"
			style={{
				top: topInset,
				right: "var(--prompt-editor-panel-right, 24px)",
				width: geometry.width,
				height,
				maxWidth: "92%",
				transformOrigin: "top right",
				transform: entered ? "scale(1)" : "scale(0.985)",
				opacity: entered ? 1 : 0,
				transition: `opacity ${TRANSITION_MS}ms ${EASE}, transform ${TRANSITION_MS}ms ${EASE}, width ${TRANSITION_MS}ms ${EASE}, height ${TRANSITION_MS}ms ${EASE}`,
				background: "rgb(24 24 24 / 0.72)",
				backdropFilter: "blur(13px)",
				WebkitBackdropFilter: "blur(13px)",
				borderColor: ai
					? ANNOTATE_COLORS.line
					: "var(--prompt-editor-panel-border, #2B2B2B)",
				boxShadow:
					"0 18px 48px rgb(0 0 0 / 0.45), 0 2px 8px rgb(0 0 0 / 0.35)",
			}}
		>
			{/* THE TAB BAR — the panel's only header. The tabs SWAP roles on
			    switch: the active tab is the wide text tab, the inactive one
			    collapses to an icon, and both widths animate so the change
			    reads as the two trading places while the box takes the
			    incoming tab's geometry. */}
			<header
				ref={headerRef}
				data-lab-annotate-panel-header=""
				className="relative flex shrink-0 select-none border-b"
				style={{
					borderColor: ai
						? ANNOTATE_COLORS.line
						: "var(--prompt-editor-panel-border, #2B2B2B)",
				}}
			>
				<span
					aria-hidden
					data-lab-panel-tab-indicator=""
					className="absolute bottom-0 h-px"
					style={{
						left: ai ? `${(1 - WIDE_TAB_FRACTION) * 100}%` : 0,
						width: `${WIDE_TAB_FRACTION * 100}%`,
						background: ai
							? ANNOTATE_COLORS.accent
							: "var(--prompt-editor-selection-accent, #6E9ECF)",
						transition: `left ${TRANSITION_MS}ms ${EASE}, background ${TRANSITION_MS}ms ${EASE}`,
					}}
				/>
				<button
					type="button"
					data-lab-panel-tab="edit"
					aria-label="Edit"
					aria-pressed={!ai}
					title="Edit"
					onClick={() => onTabSelect("edit")}
					className="flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-[0.14em] transition-all hover:text-foreground"
					style={{
						width: ai
							? `${(1 - WIDE_TAB_FRACTION) * 100}%`
							: `${WIDE_TAB_FRACTION * 100}%`,
						transition: `width ${TRANSITION_MS}ms ${EASE}, color 150ms ease`,
						...tabStyle(!ai),
					}}
				>
					{ai ? (
						<Pencil key="icon" size={12} aria-hidden style={fadeIn} />
					) : (
						<span key="label" style={fadeIn}>
							Edit
						</span>
					)}
				</button>
				<button
					type="button"
					data-lab-panel-tab="ai"
					aria-label="AI"
					aria-pressed={ai}
					title={ai ? "AI workspace — esc to finish" : "AI workspace"}
					onClick={() => onTabSelect("ai")}
					className="flex items-center justify-center gap-1.5 border-l py-2 text-[10px] uppercase tracking-[0.14em] transition-all hover:text-foreground"
					style={{
						width: ai
							? `${WIDE_TAB_FRACTION * 100}%`
							: `${(1 - WIDE_TAB_FRACTION) * 100}%`,
						transition: `width ${TRANSITION_MS}ms ${EASE}, color 150ms ease`,
						borderColor: ai
							? ANNOTATE_COLORS.line
							: "var(--prompt-editor-panel-border, #2B2B2B)",
						...tabStyle(ai),
					}}
				>
					{ai && (
						<span
							data-lab-annotate-dot={busy ? "fast" : "slow"}
							aria-hidden
							className="h-[5px] w-[5px] rounded-full"
							style={{
								background: ANNOTATE_COLORS.accent,
								animation: `prompt-annotate-breathe ${busy ? "0.72s" : "2.6s"} ease-in-out infinite`,
							}}
						/>
					)}
					{ai ? (
						<span key="label" style={fadeIn}>
							Annotations
						</span>
					) : (
						<Sparkles key="icon" size={12} aria-hidden style={fadeIn} />
					)}
				</button>
			</header>
			{/* Keyed by tab: the content CROSS-FADES when the box changes role,
			    so the switch reads as one object changing shape. */}
			<div
				key={tab}
				ref={scrollRef}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2"
				style={{ animation: `labFloatContentIn ${TRANSITION_MS}ms ${EASE}` }}
			>
				{/* Measured wrapper: fit-to-content reads this element's size in
				    the edit tab; the AI tab fills the panel so its dock can pin
				    to the bottom (chat layout). */}
				<div ref={innerRef} className={ai ? "h-full" : undefined}>
					{children}
				</div>
			</div>
			<style>{`@keyframes labFloatContentIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
		</div>
	);
}
