// Slice: inspector UI atoms (labeled section, mini read-out, text input).
"use client";

import type { ReactNode } from "react";

export function TextInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
				{label}
			</span>
			<input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-8 rounded-[2px] border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-status-success"
			/>
		</label>
	);
}

export function InspectorSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section>
			<h3 className="mb-2 flex items-center gap-2">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					{title}
				</span>
				<span className="h-px flex-1 bg-border" />
			</h3>
			<div className="flex flex-col gap-2">{children}</div>
		</section>
	);
}

export function MiniField({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
			<span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
			<span className="max-w-[62%] break-all text-right text-[12px] tabular-nums text-foreground">{value}</span>
		</div>
	);
}
