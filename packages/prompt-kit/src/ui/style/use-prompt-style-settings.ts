"use client";

import { useCallback, useEffect, useState } from "react";

import {
	loadPromptStyleSettings,
	normalizePromptStyleSettings,
	PROMPT_STYLE_DEFAULTS,
	PROMPT_STYLE_STORAGE_KEY,
	savePromptStyleSettings,
	type PromptStyleSettings,
} from "./prompt-style-settings";

export interface UsePromptStyleSettingsResult {
	settings: PromptStyleSettings;
	update(next: PromptStyleSettings): void;
	reset(): void;
}

/**
 * Owns viewer-only prompt presentation preferences and keeps browser tabs in
 * sync through the shared storage entry.
 */
export function usePromptStyleSettings(): UsePromptStyleSettingsResult {
	const [settings, setSettings] = useState<PromptStyleSettings>(
		loadPromptStyleSettings,
	);

	const update = useCallback((next: PromptStyleSettings) => {
		const normalized = normalizePromptStyleSettings(next);
		setSettings(normalized);
		savePromptStyleSettings(normalized);
	}, []);

	const reset = useCallback(() => {
		const defaults = { ...PROMPT_STYLE_DEFAULTS };
		setSettings(defaults);
		savePromptStyleSettings(defaults);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const handleStorage = (event: StorageEvent) => {
			if (event.key !== PROMPT_STYLE_STORAGE_KEY) return;
			setSettings(loadPromptStyleSettings());
		};

		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, []);

	return { settings, update, reset };
}
