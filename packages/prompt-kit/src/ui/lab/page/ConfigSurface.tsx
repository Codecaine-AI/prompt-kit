// Host-owned agent configuration shown inside the CONFIG zone.
"use client";

import { useId } from "react";

/** The CONFIG zone's host contract. */
export interface LabConfigZone {
	model: string | null;
	modelOptions?: string[];
	onModelChange?: (model: string) => void;
	thinking?: string | null;
	thinkingOptions?: string[];
	onThinkingChange?: (thinking: string) => void;
	/** Disable edits while a save is pending or the host is read-only. */
	disabled?: boolean;
	status?: string;
	error?: string;
}

export function ConfigSurface({ configZone }: { configZone: LabConfigZone }) {
	const id = useId();
	return (
		<div className="grid gap-3 text-[12px]">
			{([
				{ key: "model", label: "Model", value: configZone.model, options: configZone.modelOptions, onChange: configZone.onModelChange },
				...(configZone.thinking !== undefined ? [{ key: "thinking", label: "Default thinking", value: configZone.thinking, options: configZone.thinkingOptions, onChange: configZone.onThinkingChange }] : []),
			]).map(({ key, label, value, options, onChange }) => (
				<div key={key} className="grid gap-1.5">
					<label htmlFor={`${id}-${key}`} className="text-muted-foreground">{label}</label>
					{options?.length && onChange ? (
						<select id={`${id}-${key}`} value={value ?? ""} disabled={configZone.disabled}
							onChange={(event) => onChange(event.target.value)}
							className="w-full min-w-0 rounded-[3px] border border-border bg-background px-2 py-1 text-foreground outline-none focus:border-foreground/40 disabled:opacity-50">
							{!options.includes(value ?? "") && <option value={value ?? ""} disabled>{value ?? "Select a value"}</option>}
							{options.map((option) => <option key={option} value={option}>{option}</option>)}
						</select>
					) : <span className="min-w-0 truncate text-foreground">{value ?? "Not configured"}</span>}
				</div>
			))}
			{configZone.status && <p role="status" className="text-muted-foreground">{configZone.status}</p>}
			{configZone.error && <p role="alert" className="text-destructive">{configZone.error}</p>}
		</div>
	);
}
