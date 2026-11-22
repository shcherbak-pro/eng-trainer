/** Keep a keyboard-focused situation readable without following an unfocused selection. */
export function revealFocusedChip(strip: HTMLElement): { destroy(): void } {
  let frame: number | undefined;
  let destroyed = false;

  function cancel(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function schedule(): void {
    cancel();
    const target = document.activeElement;
    if (destroyed || !(target instanceof HTMLButtonElement) || target.parentElement !== strip) return;
    // Native focus scrolling and text/layout changes finish before measuring. Never revive an
    // old focus owner if the user tabs away or navigation destroys this action in the meantime.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (destroyed || !strip.isConnected || !target.isConnected || document.activeElement !== target || !target.matches(':focus-visible')) return;
      const style = getComputedStyle(target);
      // During native focus, computed style can still expose the UA ring. Reserve at least the
      // strip's authored clearance, shared with its padding and scroll margin.
      const outline = Math.max(parseFloat(getComputedStyle(strip).getPropertyValue('--chip-focus-clearance')) || 0,
        (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0));
      const box = target.getBoundingClientRect();
      const container = strip.getBoundingClientRect();
      const left = Math.max(0, container.left + strip.clientLeft);
      const right = Math.min(document.documentElement.clientWidth, container.left + strip.clientLeft + strip.clientWidth);
      // Round outward: scroll positions can be integral even when font metrics are fractional.
      if (box.left - outline < left) strip.scrollLeft = Math.floor(strip.scrollLeft + box.left - outline - left);
      else if (box.right + outline > right) strip.scrollLeft = Math.ceil(strip.scrollLeft + box.right + outline - right);

      // Native Tab focus normally handles the vertical axis. A font/width change, or a viewport-
      // height change that moves the phone bar, can also leave an already-focused chip out of
      // view; only then adjust the page, clearing the phone bar.
      const bar = document.querySelector('.tab-bar')?.getBoundingClientRect();
      const bottom = bar?.height ? Math.min(innerHeight, bar.top) : innerHeight;
      if (box.top - outline < 0) window.scrollBy({ top: box.top - outline, behavior: 'instant' });
      else if (box.bottom + outline > bottom) window.scrollBy({ top: box.bottom + outline - bottom, behavior: 'instant' });
    });
  }

  strip.addEventListener('focusin', schedule);
  strip.addEventListener('focusout', cancel);
  // Container width and individual label sizes can change independently (including 200% text).
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
  observer?.observe(strip);
  for (const chip of strip.children) observer?.observe(chip);
  // A viewport-height change moves the fixed phone bar without resizing the strip or a label, so
  // the observer never sees it. Each resize replaces any pending frame (one reveal per frame).
  window.addEventListener('resize', schedule);

  return {
    destroy() {
      destroyed = true;
      cancel();
      observer?.disconnect();
      strip.removeEventListener('focusin', schedule);
      strip.removeEventListener('focusout', cancel);
      window.removeEventListener('resize', schedule);
    }
  };
}
