// The shared visual substrate every prompt surface sits on: metrics, palette,
// indentation maths, and the XML syntax highlighter. Read-only views and the
// editable buffer both draw from here so a line looks identical in either.
export * from "./editor-surface";
export * from "./xml-highlight";
