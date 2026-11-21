/**
 * Change a box's content and let its height glide from the old size to the new one, instead of snapping.
 * Used when a dialog or panel swaps between views of different heights (player settings tabs, request sheet steps).
 * Respects prefers-reduced-motion (then it just swaps).
 */
export function morphHeight(box: HTMLElement, change: () => void, ms = 260): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = box.getBoundingClientRect().height;
  if (reduce || from === 0) { change(); return; }
  box.style.transition = 'none';
  box.style.height = '';
  change();
  const to = box.getBoundingClientRect().height;
  if (Math.abs(from - to) < 2) { box.style.transition = ''; return; }
  const prevOverflow = box.style.overflow;
  box.style.overflow = 'hidden';
  box.style.height = `${from}px`;
  void box.offsetHeight;
  box.style.transition = `height ${ms}ms cubic-bezier(.22, 1, .36, 1)`;
  box.style.height = `${to}px`;
  const done = (): void => {
    box.removeEventListener('transitionend', onEnd);
    box.style.height = ''; box.style.transition = ''; box.style.overflow = prevOverflow;
  };
  const onEnd = (e: TransitionEvent): void => { if (e.target === box && e.propertyName === 'height') done(); };
  box.addEventListener('transitionend', onEnd);
  window.setTimeout(done, ms + 80);
}
