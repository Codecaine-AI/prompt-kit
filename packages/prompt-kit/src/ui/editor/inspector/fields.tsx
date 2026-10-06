// Slice: inspector UI atoms (labeled section, text input).
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
			<span className="text-[length:var(--ds-font-size-micro)] uppercase tracking-[var(--ds-letter-spacing-micro-wide)] text-muted-foreground">
				{label}
			</span>
			<input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-8 rounded-[var(--ds-radius-base)] border border-border bg-background px-2 text-[length:var(--ds-font-size-ui-xs)] text-foreground outline-none focus:border-status-success"
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
				<span className="text-[length:var(--ds-font-size-micro)] font-medium uppercase tracking-[var(--ds-letter-spacing-micro-wide)] text-muted-foreground">
					{title}
				</span>
				<span className="h-px flex-1 bg-border" />
			</h3>
			<div className="flex flex-col gap-2">{children}</div>
		</section>
	);
}
