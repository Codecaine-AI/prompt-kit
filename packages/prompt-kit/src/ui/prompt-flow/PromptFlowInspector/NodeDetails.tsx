// Slice: per-node-type detail editors — only properties the renderer actually
// reads. A section renders its name and its attributes; a code block renders
// its language; an example renders its title as an attribute.
"use client";

import type {
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	OrderedListNode,
	PromptDocument,
	SectionNode,
} from "../../../index";
import type { PromptEditorTreeEntry } from "../../editors";

import { updateNode } from "../PromptFlowShared";
import { sanitizeSectionTag } from "../PromptFlowXml/node-mutations";
import type { PromptFlowChangeHandler } from "../types";
import { InspectorSection, MiniField, TextInput } from "./fields";
import { LanguageField } from "./LanguageField";
import { SectionAttributesField } from "./SectionAttributesField";

export function NodeDetails({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowChangeHandler;
}) {
	const node = entry.node;

	if (node.type === "section") {
		// The section's name is its tag — `<name>` — and everything else in the
		// open tag is an attribute. `title` is deliberately absent: the renderer
		// never reads it on a section, so a field for it would be dead input.
		return (
			<InspectorSection title="Section">
				<TextInput
					label="name"
					value={node.tag}
					onChange={(value) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section"
								? ({ ...current, tag: sanitizeSectionTag(value) } satisfies SectionNode)
								: current,
						)
					}
				/>
				<SectionAttributesField
					key={entry.id}
					entry={entry}
					node={node}
					prompt={prompt}
					onPromptChange={onPromptChange}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "field") {
		return (
			<InspectorSection title="Field">
				<TextInput
					label="label"
					value={node.label}
					onChange={(label) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field"
								? ({ ...current, label } satisfies FieldNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children?.length ?? 0)} />
			</InspectorSection>
		);
	}

	if (node.type === "codeBlock") {
		return (
			<InspectorSection title="Code">
				<LanguageField
					entry={entry}
					node={node}
					prompt={prompt}
					onPromptChange={onPromptChange}
				/>
			</InspectorSection>
		);
	}

	if (node.type === "example") {
		// An example's title is real: the renderer turns it into the open tag's
		// `title="…"` attribute, so this field edits `<example title="…">`.
		return (
			<InspectorSection title="Example">
				<TextInput
					label="title"
					value={node.title ?? ""}
					onChange={(title) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "example"
								? ({ ...current, title: title || undefined } satisfies ExampleNode)
								: current,
						)
					}
				/>
				<MiniField label="children" value={String(node.children.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "orderedList") {
		// `start` renders: the first marker is `start.`, the rest count on from it.
		return (
			<InspectorSection title="List">
				<TextInput
					label="start"
					value={String(node.start ?? 1)}
					onChange={(value) => {
						const start = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "orderedList"
								? ({
										...current,
										start: Number.isFinite(start) ? start : undefined,
									} satisfies OrderedListNode)
								: current,
						);
					}}
				/>
				<MiniField label="items" value={String(node.items.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "bulletList") {
		return (
			<InspectorSection title="List">
				<MiniField label="items" value={String(node.items.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "contextUsage") {
		return (
			<InspectorSection title="Context">
				<TextInput
					label="context id"
					value={node.contextId}
					onChange={(contextId) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, contextId } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<TextInput
					label="name"
					value={node.tag ?? ""}
					onChange={(tag) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, tag: tag || undefined } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
				<MiniField label="instructions" value={String(node.instructions.length)} />
			</InspectorSection>
		);
	}

	if (node.type === "raw") {
		return (
			<InspectorSection title="Raw">
				<MiniField label="chars" value={String(node.value.length)} />
			</InspectorSection>
		);
	}

	return null;
}
