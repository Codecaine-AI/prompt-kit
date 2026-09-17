"use client";

import { useId } from "react";

/** The host changes context and tool previews together when a fixture is selected. */
export interface LabContextFixtures {
	fixtures: Array<{ id: string; label: string }>;
	activeFixtureId: string | null;
	onFixtureSelect: (id: string) => void;
}

export function FixtureSelect({ fixtures, activeFixtureId, onFixtureSelect }: LabContextFixtures) {
	const id = useId();
	return <div className="grid gap-1.5 text-[12px]">
		<label htmlFor={id} className="text-muted-foreground">Context fixture</label>
		<select id={id} value={activeFixtureId ?? ""} onChange={event => onFixtureSelect(event.target.value)}
			className="w-full min-w-0 rounded-[3px] border border-border bg-background px-2 py-1 text-foreground outline-none focus:border-foreground/40">
			{activeFixtureId === null && <option value="" disabled>Select a fixture</option>}
			{fixtures.map(fixture => <option key={fixture.id} value={fixture.id}>{fixture.label}</option>)}
		</select>
		<p className="text-muted-foreground">Preview only</p>
	</div>;
}
