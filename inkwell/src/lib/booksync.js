// Following the book by the audio's time: the maths (no app state), so it can be tested.

/** Words a second, from the last few [time, word] points (kept to a speaking range). */
export const paceOf = (pts) => {
  const tail = pts.slice(-8);
  const dt = tail[tail.length - 1][0] - tail[0][0];
  const dw = tail[tail.length - 1][1] - tail[0][1];
  return Math.min(4.5, Math.max(1.2, dt > 0 ? dw / dt : 2.5));
};

/** The book word at an audio time, from [time, word] points (exported for tests). */
export function wordAtTime(pts, time, total) {
  const pace = paceOf(pts);
  let w;
  if (time <= pts[0][0]) w = pts[0][1] - (pts[0][0] - time) * pace;
  else if (time >= pts[pts.length - 1][0]) w = pts[pts.length - 1][1] + (time - pts[pts.length - 1][0]) * pace;
  else {
    let i = 1;
    while (pts[i][0] < time) i++;
    const [t0, w0] = pts[i - 1];
    const [t1, w1] = pts[i];
    w = t1 > t0 ? w0 + ((time - t0) / (t1 - t0)) * (w1 - w0) : w0;
  }
  return Math.max(0, Math.min(total - 1, Math.round(w)));
}

