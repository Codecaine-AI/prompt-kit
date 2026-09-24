import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PromptInlineLab } from "../../../src/ui/lab";
import type { PromptDocument } from "../../../src/index";

afterEach(cleanup);

const prompt: PromptDocument = {
  kind: "prompt", schemaVersion: "prompt-kit/v1", id: "rail-test",
  nodes: [{ type: "section", id: "workflow", tag: "workflow", children: [
    { type: "section", id: "assess", tag: "assess", children: [{ type: "paragraph", id: "text", content: ["Read the scene."] }] },
    { type: "section", id: "validate", tag: "validate", children: [{ type: "paragraph", id: "text-2", content: ["Check the result."] }] },
  ] }],
};
const dock = () => document.querySelector<HTMLElement>("[data-lab-dock]")!;
const rail = () => document.querySelector<HTMLElement>("[data-lab-persistent-rail]")!;
const reserved = () => document.querySelector<HTMLElement>('[style*="--prompt-editor-reserved-right"]')!.style.getPropertyValue("--prompt-editor-reserved-right");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("persistent prompt rail", () => {
  test("host-controlled navigation restores the view without remounting the lab", () => {
    const requested: string[] = [];
    const props = { prompt, context: { renderedContext: "<context>Reference</context>" }, onViewChange: (view: string) => requested.push(view) };
    const { rerender } = render(<PromptInlineLab {...props} view="context" />);
    expect(document.querySelector('[data-lab-document-view="context"]')).toBeTruthy();
    click("Prompt");
    expect(requested).toEqual(["system"]);
    rerender(<PromptInlineLab {...props} view="system" />);
    expect(document.querySelector('[data-lab-document-view="system"]')).toBeTruthy();
    rerender(<PromptInlineLab {...props} view="context" />);
    expect(document.querySelector('[data-lab-document-view="context"]')).toBeTruthy();
    expect(dock().dataset.labPanelState).toBe("tree");
    click("AI");
    rerender(<PromptInlineLab {...props} view="system" />);
    expect(document.querySelector('[data-lab-mode="annotate"]')).toBeTruthy();
    rerender(<PromptInlineLab {...props} view="context" />);
    rerender(<PromptInlineLab {...props} view="system" />);
    expect(document.querySelector('[data-lab-mode="annotate"]')).toBeNull();
  });

  test("starts collapsed and keeps a constant document footprint through tree and AI", () => {
    render(<PromptInlineLab prompt={prompt} />);
    const initialRail = rail();
    const footprint = reserved();
    expect(dock().style.width).toBe("44px");
    expect(screen.queryByRole("navigation", { name: "Document outline" })).toBeNull();
    click("Expand outline");
    expect(dock().style.width).toBe("252px");
    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeTruthy();
    click("AI");
    expect(dock().style.width).toBe("520px");
    expect(rail()).toBe(initialRail);
    expect(reserved()).toBe(footprint);
    click("Edit");
    expect(dock().dataset.labPanelState).toBe("tree");
    click("Collapse outline");
    expect(dock().dataset.labPanelState).toBe("rail");
    expect(reserved()).toBe(footprint);
    click("AI");
    click("Edit");
    expect(dock().dataset.labPanelState).toBe("rail");
  });

  test("view icons expand the tree and return from system-only AI to the previous view", () => {
    render(<PromptInlineLab prompt={prompt} context={{ renderedContext: "<context>Reference</context>" }} toolsZone={{ renderedTools: "<tool>Tool</tool>" }} />);
    click("Context");
    expect(dock().dataset.labPanelState).toBe("tree");
    expect(document.querySelector('[data-context-scroll="context"]')).toBeTruthy();
    click("AI");
    expect(document.querySelector("[data-prompt-flow-rows]")).toBeTruthy();
    click("Edit");
    expect(document.querySelector('[data-context-scroll="context"]')).toBeTruthy();
    click("AI");
    click("Tools");
    expect(dock().dataset.labPanelState).toBe("tree");
    expect(document.querySelector('[data-context-scroll="tools"]')).toBeTruthy();
    expect(document.querySelector('[data-lab-mode="annotate"]')).toBeNull();
    click("Prompt");
    expect(document.querySelector('[data-lab-mode="edit"]')).toBeTruthy();
  });

  test("folded branches survive collapse, AI, and view switches", () => {
    render(<PromptInlineLab prompt={prompt} context={{ renderedContext: "<ctx>Reference</ctx>" }} />);
    click("Expand outline");
    click("Toggle workflow");
    expect(screen.queryByRole("button", { name: "assess" })).toBeNull();
    click("Collapse outline");
    click("Expand outline");
    click("AI");
    click("Edit");
    click("Context");
    click("Prompt");
    expect(screen.getByRole("button", { name: "Toggle workflow" }).getAttribute("aria-expanded")).toBe("false");
    click("Toggle workflow");
    expect(screen.getByRole("button", { name: "assess" })).toBeTruthy();
    const scroll = document.querySelector<HTMLElement>('[data-prompt-flow-scroll="xml"]')!;
    let scrolled = false;
    scroll.scrollTo = () => { scrolled = true; };
    click("validate");
    expect(scrolled).toBe(true);
    expect(screen.getByRole("button", { name: "validate" }).getAttribute("aria-current")).toBe("location");
  });

  test("Escape returns from AI before collapsing the tree and respects handled events", () => {
    render(<PromptInlineLab prompt={prompt} />);
    click("Expand outline");
    click("AI");
    fireEvent.keyDown(rail(), { key: "Escape" });
    expect(dock().dataset.labPanelState).toBe("tree");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(rail(), event);
    expect(dock().dataset.labPanelState).toBe("tree");
    fireEvent.keyDown(rail(), { key: "Escape" });
    expect(dock().dataset.labPanelState).toBe("rail");
    click("AI");
    click("Collapse outline");
    expect(dock().dataset.labPanelState).toBe("rail");
    expect(document.querySelector('[data-lab-mode="annotate"]')).toBeNull();
  });

  test("host-provided views disappear safely, and closed content is not keyboard reachable", () => {
    const { rerender } = render(<PromptInlineLab prompt={prompt} toolsZone={{ renderedTools: "<tool>Test</tool>" }} />);
    expect(within(rail()).getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "workflow" })).toBeNull();
    click("Tools");
    rerender(<PromptInlineLab prompt={prompt} />);
    expect(screen.queryByRole("button", { name: "Tools" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prompt" }).getAttribute("aria-pressed")).toBe("true");
  });
});
