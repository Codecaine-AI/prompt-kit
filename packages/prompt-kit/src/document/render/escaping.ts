export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

export function isXmlName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
}
