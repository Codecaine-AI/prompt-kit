import type {
  ContextUsageNode,
  ExampleNode,
  FieldNode,
  ListItemNode,
  PromptBlockNode,
  SectionNode,
} from "../nodes/types";

export type BlockMapper = (
  node: PromptBlockNode,
) => PromptBlockNode | readonly PromptBlockNode[];

export function mapPromptBlocks(
  nodes: readonly PromptBlockNode[],
  mapper: BlockMapper,
): PromptBlockNode[] {
  return nodes.flatMap((node) => {
    const mapped = mapper(mapBlockChildren(node, mapper));
    return Array.isArray(mapped) ? [...mapped] : [mapped];
  });
}

function mapBlockChildren(
  node: PromptBlockNode,
  mapper: BlockMapper,
): PromptBlockNode {
  switch (node.type) {
    case "section":
      return mapSection(node, mapper);
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        items: node.items.map((item) => mapListItem(item, mapper)),
      };
    case "field":
      return mapField(node, mapper);
    case "example":
      return mapExample(node, mapper);
    case "contextUsage":
      return mapContextUsage(node, mapper);
    case "paragraph":
    case "codeBlock":
    case "raw":
      return node;
  }
}

function mapSection(node: SectionNode, mapper: BlockMapper): SectionNode {
  return {
    ...node,
    children: mapPromptBlocks(node.children, mapper),
  };
}

function mapListItem(node: ListItemNode, mapper: BlockMapper): ListItemNode {
  return {
    ...node,
    children: node.children ? mapPromptBlocks(node.children, mapper) : undefined,
  };
}

function mapField(node: FieldNode, mapper: BlockMapper): FieldNode {
  return {
    ...node,
    children: node.children ? mapPromptBlocks(node.children, mapper) : undefined,
  };
}

function mapExample(node: ExampleNode, mapper: BlockMapper): ExampleNode {
  return {
    ...node,
    children: mapPromptBlocks(node.children, mapper),
  };
}

function mapContextUsage(
  node: ContextUsageNode,
  mapper: BlockMapper,
): ContextUsageNode {
  return {
    ...node,
    instructions: mapPromptBlocks(node.instructions, mapper),
  };
}
