/**
 * Auto-scroll helper: keeps a scroll container pinned to the bottom when
 * `enabled` is true, and exposes a manual scroll-to-bottom toggle.
 */
import { useCallback, useState } from "react";

export default function useAutoScroll(containerRef: React.RefObject<HTMLElement>) {
  const [enabled, setEnabled] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [containerRef]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return { autoScroll: enabled, toggleAutoScroll: toggle, scrollToBottom };
}
