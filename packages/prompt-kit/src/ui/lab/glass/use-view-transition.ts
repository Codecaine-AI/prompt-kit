import { useLayoutEffect, useRef } from "react";

/** Fade each selected view into place without remounting its editor or forms. */
export function useViewTransition(view: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(view);
  useLayoutEffect(() => {
    if (previous.current === view) return;
    previous.current = view;
    const element = ref.current;
    if (!element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [view]);
  return ref;
}
