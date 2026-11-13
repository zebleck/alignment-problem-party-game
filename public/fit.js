// Keeps a fixed-height layout free of scrolling: shrinks the font size of each
// column until its content fits its height. Sizes inside the columns must be
// in em for this to work. Below `min` px it gives up and the column scrolls.
//
// Returns a function to call after every render.
export function autoFit(root, columnSelector, { min = 11, media = '(min-width: 901px)' } = {}) {
  const mq = window.matchMedia(media);
  const fits = (c) => c.scrollHeight <= c.clientHeight + 1;
  const run = () => {
    for (const c of root.querySelectorAll(columnSelector)) {
      c.style.fontSize = '';
      if (!mq.matches || fits(c)) continue;
      let hi = parseFloat(getComputedStyle(c).fontSize);
      let lo = min;
      if (!(hi > lo)) continue;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        c.style.fontSize = `${mid}px`;
        if (fits(c)) lo = mid;
        else hi = mid;
      }
      c.style.fontSize = `${lo}px`;
    }
  };
  // A column's height also changes without a render, for example when the timer appears in the header.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => run());
    for (const c of root.querySelectorAll(columnSelector)) ro.observe(c);
  }
  window.addEventListener('resize', run);
  mq.addEventListener('change', run);
  return run;
}
