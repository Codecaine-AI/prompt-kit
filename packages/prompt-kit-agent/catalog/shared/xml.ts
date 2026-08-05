/**
 * Tiny XML-ish block helpers shared by the prompt-editor sidecars: the
 * context sidecar frames its <doc> entries with them and the state sidecar
 * frames <target_prompt> / <requests>. String assembly only — no parsing,
 * no escaping — because the bodies are trusted bundle-rendered text, not
 * user input.
 */

export function indent(body: string): string[] {
	return body
		.split("\n")
		.map((line) => (line.length > 0 ? `    ${line}` : line));
}

export function block(tag: string, attrs: string, body: string): string {
	const open = attrs.length > 0 ? `<${tag} ${attrs}>` : `<${tag}>`;
	return [open, ...indent(body), `</${tag}>`].join("\n");
}
