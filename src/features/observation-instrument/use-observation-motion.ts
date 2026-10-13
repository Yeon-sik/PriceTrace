"use client";

import { useEffect, useRef } from "react";

/** A single event-driven frame; never a continuous animation loop. */
export function useObservationMotion() {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const preference = window.matchMedia("(prefers-reduced-motion: no-preference) and (pointer: fine)");
    let visible = false;
    let frame: number | null = null;
    let x = 0;
    let y = 0;
    const reset = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      surface.style.removeProperty("--tilt-x");
      surface.style.removeProperty("--tilt-y");
      surface.dataset.motionActive = "false";
    };
    const move = (event: PointerEvent) => {
      if (!preference.matches || !visible || document.hidden || event.pointerType === "touch") return;
      const bounds = surface.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        surface.style.setProperty("--tilt-x", `${-y * 3}deg`);
        surface.style.setProperty("--tilt-y", `${x * 4}deg`);
        surface.dataset.motionActive = "true";
        frame = null;
      });
    };
    // Without IntersectionObserver the instrument stays fully usable and static.
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) reset();
    });
    observer?.observe(surface);
    preference.addEventListener("change", reset);
    document.addEventListener("visibilitychange", reset);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", reset);
    return () => {
      reset();
      observer?.disconnect();
      preference.removeEventListener("change", reset);
      document.removeEventListener("visibilitychange", reset);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
    };
  }, []);

  return surfaceRef;
}
