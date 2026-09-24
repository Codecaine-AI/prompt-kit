import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";

interface RailButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tip: string;
}

/** Portaled tooltips remain visible outside the glass panel's clipping edge. */
export const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
  { tip, children, onClick, ...props }, ref,
) {
  const id = useId();
  const [position, setPosition] = useState<{ x: number; y: number; right: boolean; font: string } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = () => {
    clearTimeout(hideTimer.current);
    clearTimeout(showTimer.current);
  };
  const close = () => { clearTimer(); setPosition(null); };
  const scheduleClose = () => {
    clearTimer();
    hideTimer.current = setTimeout(() => setPosition(null), 100);
  };
  function show(button: HTMLButtonElement) {
    clearTimer();
    const rect = button.getBoundingClientRect();
    const right = rect.left < 232;
    setPosition({
      x: right ? rect.right + 10 : window.innerWidth - rect.left + 10,
      y: Math.max(44, Math.min(window.innerHeight - 44, rect.top + rect.height / 2)),
      right,
      font: getComputedStyle(button).fontFamily,
    });
  }
  function scheduleOpen(button: HTMLButtonElement) {
    clearTimer();
    showTimer.current = setTimeout(() => show(button), 400);
  }

  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(showTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => { clearTimer(); setPosition(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [position]);

  return <>
    <button
      {...props}
      ref={ref}
      aria-describedby={position ? id : undefined}
      onMouseEnter={(event) => scheduleOpen(event.currentTarget)}
      onMouseLeave={scheduleClose}
      onFocus={(event) => scheduleOpen(event.currentTarget)}
      onBlur={close}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
      onClick={(event) => { close(); onClick?.(event); }}
    >{children}</button>
    {position && createPortal(
      <div
        id={id}
        role="tooltip"
        data-lab-rail-tooltip=""
        onMouseEnter={clearTimer}
        onMouseLeave={scheduleClose}
        style={{
          position: "fixed", zIndex: 1000,
          ...(position.right ? { left: position.x } : { right: position.x }),
          top: position.y, transform: "translateY(-50%)",
          width: "max-content", maxWidth: "min(220px, calc(100vw - 20px))",
          padding: "5px 8px", borderRadius: 6,
          background: "rgb(25 27 31 / 0.97)", color: "#F4F4F5",
          border: "1px solid rgb(255 255 255 / 0.12)",
          boxShadow: "0 6px 20px rgb(0 0 0 / 0.24)",
          fontFamily: position.font, fontSize: 12, lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 500 }}>{tip}</div>
      </div>, document.body,
    )}
  </>;
});
