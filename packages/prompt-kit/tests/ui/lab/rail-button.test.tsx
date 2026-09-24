import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RailButton } from "../../../src/ui/lab/glass/RailButton";

afterEach(cleanup);

const waitForTooltip = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });

describe("rail tooltips", () => {
  test("hover exposes an accessible tooltip outside the clipping container", async () => {
    const { container } = render(<div style={{ overflow: "hidden" }}><RailButton tip="Context" aria-label="Context">Icon</RailButton></div>);
    const button = screen.getByRole("button", { name: "Context" });
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await waitForTooltip();
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Context");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(container.contains(tooltip)).toBe(false);
    expect(button.hasAttribute("title")).toBe(false);
  });

  test("keyboard focus shows the label and Escape dismisses it before the panel", async () => {
    let escaped = false;
    render(<div onKeyDown={() => { escaped = true; }}><RailButton tip="State" aria-label="State">Icon</RailButton></div>);
    const button = screen.getByRole("button", { name: "State" });
    fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await waitForTooltip();
    expect(screen.getByRole("tooltip").textContent).toBe("State");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(escaped).toBe(false);
    fireEvent.focus(button);
    fireEvent.blur(button);
    await waitForTooltip();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("clicking still selects the view and removes the tooltip", async () => {
    let selected = false;
    render(<RailButton tip="Tools" onClick={() => { selected = true; }}>Tools</RailButton>);
    const button = screen.getByRole("button", { name: "Tools" });
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    expect(selected).toBe(true);
    await waitForTooltip();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
