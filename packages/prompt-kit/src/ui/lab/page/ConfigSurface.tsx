// Host-owned agent configuration shown inside the glass panel's CONFIG zone.
"use client";

/** The CONFIG zone's host contract. */
export interface LabConfigZone {
	model: string | null;
	modelOptions?: string[];
	onModelChange?: (model: string) => void;
}

export function ConfigSurface({
	configZone,
}: {
	configZone: LabConfigZone;
}) {
	const canSelectModel =
		(configZone.modelOptions?.length ?? 0) > 0 &&
		Boolean(configZone.onModelChange);

	return (
		<div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-[12px]">
			<label htmlFor="lab-config-model" className="text-muted-foreground">
				Model
			</label>
			{canSelectModel ? (
				<select
					id="lab-config-model"
					value={configZone.model ?? ""}
					onChange={(event) => configZone.onModelChange?.(event.target.value)}
					className="min-w-0 rounded-[3px] border border-border bg-background px-2 py-1 text-foreground outline-none focus:border-foreground/40"
				>
					{configZone.model === null && (
						<option value="" disabled>
							Select a model
						</option>
					)}
					{configZone.modelOptions!.map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</select>
			) : (
				<span className="min-w-0 truncate text-foreground">
					{configZone.model ?? "—"}
				</span>
			)}
		</div>
	);
}
