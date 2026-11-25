// Listener Challenges: a few small goals for this month, from what the app already counts
// (Stats' listening log, your finished books) — nothing is sent anywhere. Pure: give it the log
// and progress, get the challenges with how far you are.

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const surname = (a) => String(a || '').split(/,|&| and /)[0].trim().toLowerCase();

/** The longest run of days in a row (5+ minutes each) within this month so far. */
export function bestStreak(days, now = new Date()) {
  let best = 0;
  let run = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    const s = days?.[key(new Date(now.getFullYear(), now.getMonth(), d))]?.s || 0;
    run = s >= 300 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * This month's challenges: [{ id, icon, title, done (0…1 share), text }].
 * `log`: listenLog ({ days: { 'YYYY-MM-DD': { s, b: { uid: secs } } }, books: { uid: { author } } });
 * `prog`: progress (finished + updatedAt).
 */
export function challenges(log, prog, now = new Date()) {
  const days = log?.days || {};
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const inMonth = Object.keys(days).filter((k) => k.startsWith(month));
  const hours = inMonth.reduce((a, k) => a + (days[k].s || 0), 0) / 3600;
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const finished = Object.values(prog || {}).filter((p) => p?.finished && (p.updatedAt || 0) >= start && p.book?.source !== 'pod').length;
  const streak = bestStreak(days, now);
  // A new author: someone you listened to this month and never before it.
  const authorOf = (uid) => surname(log?.books?.[uid]?.author || prog?.[uid]?.book?.author);
  const before = new Set();
  const now$ = new Set();
  for (const [k, d] of Object.entries(days)) for (const uid of Object.keys(d.b || {})) (k.startsWith(month) ? now$ : k < month ? before : null)?.add(authorOf(uid));
  const fresh = [...now$].filter((a) => a && !before.has(a)).length;
  const goal = (n, g) => Math.min(1, n / g);
  return [
    { id: 'hours', icon: 'headphones', title: 'Listen 10 hours this month', done: goal(hours, 10), text: `${hours.toFixed(1)} of 10 hours` },
    { id: 'finish', icon: 'check', title: 'Finish 2 books', done: goal(finished, 2), text: `${finished} of 2 finished` },
    { id: 'streak', icon: 'flame', title: 'Listen 7 days in a row', done: goal(streak, 7), text: `Best run this month: ${streak} day${streak === 1 ? '' : 's'}` },
    { id: 'author', icon: 'user', title: 'Try an author new to you', done: goal(fresh, 1), text: fresh ? `${fresh} new author${fresh === 1 ? '' : 's'} this month` : 'Not yet this month' },
  ];
}
