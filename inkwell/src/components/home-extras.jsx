// Home: this week's listening as a ring (with your streak), and "Finish soon" — books you're
// most of the way through, the nearest to done first, so they don't get left at 90%.
import { useMemo } from 'preact/hooks';
import { progress, settings, useStore } from '../lib/store.js';
import { listenLog, summary } from '../lib/stats.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';
import { nav } from '../lib/nav.js';
import { sameWork } from '../lib/works.js';
import { fmtDuration } from '../lib/format.js';
import { Cover } from './common.jsx';
import { Icon } from './icons.jsx';

export function WeekRing() {
  useStore(listenLog);
  const st = useStore(settings);
  if (st.weekRing === false) return null;
  const s = summary('listen');
  const goal = (st.weekGoalH || 5) * 3600;
  if (!s.week && !s.streak) return null;
  const pct = Math.min(1, s.week / goal);
  const C = 2 * Math.PI * 31;
  return (
    <button class="week-ring" onClick={() => nav.push('stats')} aria-label="Listening this week">
      <svg width="70" height="70" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r="31" class="wr-bg" />
        <circle cx="37" cy="37" r="31" class="wr-on" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pct) }} transform="rotate(-90 37 37)" />
        <text x="37" y="42" text-anchor="middle">{Math.round(pct * 100)}%</text>
      </svg>
      <span>
        <b>{fmtDuration(s.week)}</b>
        <small>this week · goal {st.weekGoalH || 5} h</small>
        {s.streak > 1 && <em>🔥 {s.streak}-day streak</em>}
      </span>
      <Icon name="arrow" size={16} />
    </button>
  );
}

export function FinishSoon() {
  const prog = useStore(progress);
  const items = useMemo(
    () =>
      Object.entries(prog)
        .filter(([uid, p]) => p?.book && !p.finished && !p.hidden && p.kind !== 'text' && p.total > 0 && (p.global || 0) / p.total >= 0.7 && !/^(lbl?|sum):/.test(uid))
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .filter(([, p], i, all) => !all.slice(0, i).some(([, q]) => sameWork(q.book, p.book)))
        .sort((a, b) => a[1].total - a[1].global - (b[1].total - b[1].global))
        .slice(0, 4),
    [prog]
  );
  // The one on the Continue card already is left out when it's the only one.
  if (items.length < 2) return null;
  const play = (p) => {
    nav.openOverlay('player');
    player.openAndPlay(p.book, getDetails);
  };
  return (
    <section class="finish-soon">
      <div class="d-head home-head">
        <span class="d-ico">
          <Icon name="flag" size={20} />
        </span>
        <h3>Finish soon</h3>
      </div>
      {items.map(([uid, p]) => (
        <button key={uid} class="fs-row" onClick={() => play(p)}>
          <Cover book={p.book} />
          <span class="fs-text">
            <b>{p.book.title}</b>
            <small>{fmtDuration(Math.max(0, p.total - (p.global || 0)))} left</small>
            <i>
              <span style={{ width: `${Math.round(((p.global || 0) / p.total) * 100)}%` }} />
            </i>
          </span>
          <span class="fs-play">
            <Icon name="play" size={16} />
          </span>
        </button>
      ))}
    </section>
  );
}
