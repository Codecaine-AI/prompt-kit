import type {
  ContextUsageNode,
  ExampleNode,
  FieldNode,
  ListItemNode,
  PromptBlockNode,
  PromptInline,
  PromptListNode,
  RawNode,
  ReferenceNode,
  SectionNode,
  VariableReferenceNode,
} from "../nodes/types";
import { escapeXmlAttribute, escapeXmlText } from "./escaping";
import { DEFAULT_INDENT, indent, indentMultiline } from "./indentation";

export interface XmlMarkdownRenderOptions {
  indentText?: string;
  variables?: Record<string, unknown>;
  missingVariable?: "placeholder" | "empty" | "error";
}

export interface XmlMarkdownRenderContext {
  indentText: string;
  variables: Record<string, unknown>;
  missingVariable: "placeholder" | "empty" | "error";
}

export function createRenderContext(
  options: XmlMarkdownRenderOptions = {},
): XmlMarkdownRenderContext {
  return {
    indentText: options.indentText ?? DEFAULT_INDENT,
    variables: options.variables ?? {},
    missingVariable: options.missingVariable ?? "placeholder",
  };
}

export function renderNodes(
  nodes: readonly PromptBlockNode[],
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  return nodes
    .map((node) => renderNode(node, level, ctx))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

export function renderNode(
  node: PromptBlockNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  switch (node.type) {
    case "section":
      return renderSection(node, level, ctx);
    case "paragraph":
      return `${indent(level, ctx.indentText)}${renderInline(node.content, ctx)}`;
    case "bulletList":
    case "orderedList":
      return renderList(node, level, ctx);
    case "field":
      return renderField(node, level, ctx);
    case "codeBlock":
      return renderCodeBlock(node, level, ctx);
    case "example":
      return renderExample(node, level, ctx);
    case "raw":
      return renderRaw(node, level, ctx);
    case "contextUsage":
      return renderContextUsage(node, level, ctx);
  }
}

export function renderInline(
  content: readonly PromptInline[],
  ctx: XmlMarkdownRenderContext,
): string {
  return content.map((part) => renderInlinePart(part, ctx)).join("");
}

function renderInlinePart(
  part: PromptInline,
  ctx: XmlMarkdownRenderContext,
): string {
  if (typeof part === "string") return escapeXmlText(part);
  if (part.type === "variable") return renderVariable(part, ctx);
  return renderReference(part);
}

function renderVariable(
  variable: VariableReferenceNode,
  ctx: XmlMarkdownRenderContext,
): string {
  if (Object.hasOwn(ctx.variables, variable.name)) {
    return escapeXmlText(formatVariableValue(ctx.variables[variable.name]));
  }
  if (variable.fallback && variable.fallback.length > 0) {
    return renderInline(variable.fallback, ctx);
  }
  if (ctx.missingVariable === "empty") return "";
  if (ctx.missingVariable === "error") {
    throw new Error(`Missing prompt variable: ${variable.name}`);
  }
  return `{{${variable.name}}}`;
}

function renderReference(reference: ReferenceNode): string {
  return `{{${reference.kind}:${reference.name}}}`;
}

function formatVariableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function renderSection(
  node: SectionNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const pad = indent(level, ctx.indentText);
  const open = renderOpenTag(node.tag, node.attrs);
  const body = renderNodes(node.children, level + 1, ctx);
  if (body.length === 0) return `${pad}${open}\n${pad}</${node.tag}>`;
  return `${pad}${open}\n${body}\n${pad}</${node.tag}>`;
}

function renderOpenTag(
  tag: string,
  attrs?: SectionNode["attrs"],
): string {
  const renderedAttrs = Object.entries(attrs ?? {})
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return value !== null && value !== undefined;
    })
    .map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`);

  if (renderedAttrs.length === 0) return `<${tag}>`;
  return `<${tag} ${renderedAttrs.join(" ")}>`;
}

function renderList(
  node: PromptListNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const start = node.type === "orderedList" ? (node.start ?? 1) : 0;
  return node.items
    .map((listItem, index) => {
      const marker = node.type === "orderedList" ? `${start + index}.` : "-";
      return renderListItem(listItem, marker, level, ctx);
    })
    .join("\n");
}

function renderListItem(
  node: ListItemNode,
  marker: string,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const pad = indent(level, ctx.indentText);
  const line = `${pad}${marker} ${renderInline(node.content, ctx)}`.trimEnd();
  const children = node.children ?? [];
  if (children.length === 0) return line;
  return `${line}\n${renderNodes(children, level + 1, ctx)}`;
}

function renderField(
  node: FieldNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const pad = indent(level, ctx.indentText);
  const value = renderInline(node.value, ctx);
  const line = `${pad}${escapeXmlText(node.label)}: ${value}`.trimEnd();
  const children = node.children ?? [];
  if (children.length === 0) return line;
  return `${line}\n${renderNodes(children, level + 1, ctx)}`;
}

function renderCodeBlock(
  node: { language?: string; code: string },
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const pad = indent(level, ctx.indentText);
  const language = node.language ?? "";
  const code = indentMultiline(node.code, level, ctx.indentText);
  return `${pad}\`\`\`${language}\n${code}\n${pad}\`\`\``;
}

function renderExample(
  node: ExampleNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  const attrs = node.title ? { title: node.title } : undefined;
  return renderSection(
    {
      type: "section",
      tag: "example",
      attrs,
      children: node.children,
    },
    level,
    ctx,
  );
}

function renderRaw(
  node: RawNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  return indentMultiline(node.value, level, ctx.indentText);
}

function renderContextUsage(
  node: ContextUsageNode,
  level: number,
  ctx: XmlMarkdownRenderContext,
): string {
  return renderSection(
    {
      type: "section",
      tag: node.tag ?? "context_usage",
      attrs: { context_id: node.contextId },
      children: node.instructions,
    },
    level,
    ctx,
  );
}
