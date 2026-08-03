export const DEFAULT_INDENT = "    ";

export function indent(level: number, indentText = DEFAULT_INDENT): string {
  return indentText.repeat(level);
}

export function indentMultiline(
  value: string,
  level: number,
  indentText = DEFAULT_INDENT,
): string {
  const prefix = indent(level, indentText);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join("\n");
}
