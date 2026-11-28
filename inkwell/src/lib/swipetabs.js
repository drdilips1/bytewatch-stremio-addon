// Swiping left or right on Home, Discover, Podcasts, Library or Settings moves to the next tab
// (user, 28 Nov: "can't swipe between tabs, only tap"). Pure: the swipe's distance and time in,
// the tab to go to out (or null).

/** The tab a swipe lands on: a clear, quick, mostly sideways swipe; never past the ends. */
export function swipeTab(tabs, current, dx, dy, ms) {
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || ms > 700) return null;
  const i = tabs.indexOf(current);
  if (i < 0) return null;
  const j = dx < 0 ? i + 1 : i - 1; // finger to the left → the tab on the right
  return j >= 0 && j < tabs.length ? tabs[j] : null;
}

/**
 * Whether a swipe that starts on this element should be left alone: rows that scroll sideways
 * (covers, chips), sliders, text boxes, sheets — and the screen's edges (the phone's own back
 * gesture).
 */
export function keepsSwipe(el, x, width) {
  if (x < 24 || x > width - 24) return true;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable) return true;
    // Sheets, sliders, and things with a swipe of their own (Home's big carousel).
    if (n.classList?.contains('sheet') || n.classList?.contains('sheet-backdrop') || n.classList?.contains('feature') || n.dataset?.ownSwipe || n.getAttribute?.('role') === 'slider') return true;
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}
