// X-Ray in the player, with the Character Tracker: who and where is in the scene now; everyone so
// far (people, places); who's who grouped by house / family with each one's status at your point;
// and what changed since you last listened, with the story's open questions. Tap anyone for their
// page — aliases, first seen, status, the story so far, connections, and moments to jump to.
// Spoiler-safe (only up to where you are), from your own AI key; portraits are initials in a colour.
import { useEffect, useState } from 'preact/hooks';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { aiReady } from '../lib/ai.js';
import { subscribeTranscript } from '../lib/transcript.js';
import { loadXray, cachedXray, previousXray, timeline, inScene } from '../lib/xray.js';
import { groupsOf, counts, changesSince, initials, hueOf, statusOf, mapAround } from '../lib/xraytrack.js';
import { photoFor } from '../lib/xrayphotos.js';
import { knownCharacters } from './story-sheet.jsx';
import { fmtTime } from '../lib/format.js';

const share = (uid, data) => knownCharacters.set({ uid, at: data.at, list: data.people });

/** Lines heard in the last few minutes of the current part. */
function useRecent(s) {
  const [t, setT] = useState(null);
  useEffect(() => subscribeTranscript(setT), []);
  const segs = t?.segments || [];
  return segs.filter((g) => g.start != null && g.start <= s.time + 1 && g.start >= s.time - 180).map((g) => (t?.bookText?.state === 'on' && g.book) || g.text);
}

// The book whose X-Ray is open (photos are looked up for its characters).
let xrBook = null;
let xrWiki = '';
/** A person's Wikipedia photo (real people; characters with a page of their own), or null. */
function usePhoto(x, place) {
  const [p, setP] = useState(null);
  useEffect(() => {
    let live = true;
    setP(null);
    if (!place && x?.name && xrBook) photoFor(x, xrBook, xrWiki).then((r) => live && setP(r));
    return () => (live = false);
  }, [x?.name, x?.kind, place]);
  return p;
}

/** A portrait: the Wikipedia photo when there is one, else initials on the person's own colour. */
function Face({ x, size = 44, dot = false, place = false }) {
  const h = hueOf(x.name);
  const photo = usePhoto(x, place);
  return (
    <span class={'xr-face' + (place ? ' place' : '')} style={{ width: size, height: size, fontSize: size * 0.36, '--h': h }}>
      {photo ? <img src={photo.url} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} /> : place ? '📍' : initials(x.name)}
      {dot && <i class={'xr-dot ' + statusOf(x)} />}
    </span>
  );
}

/** The relationship map: this person in the middle, their connections around (tap to go there). */
function RelationMap({ x, people, open }) {
  const { nodes, edges } = mapAround(x, people);
  if (nodes.length < 2) return null;
  const at = new Map(nodes.map((n) => [n.name, n]));
  const W = 320, H = 290;
  return (
    <div class="xr-map" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {edges.map((e) => {
          const a = at.get(e.a), b = at.get(e.b);
          if (!a || !b) return null;
          return <line class={'xr-edge ' + e.type} x1={a.x * W} y1={a.y * H} x2={b.x * W} y2={b.y * H} />;
        })}
        {edges.map((e) => {
          const a = at.get(e.a), b = at.get(e.b);
          if (!a || !b || !e.label) return null;
          return (
            <text class={'xr-edge-label ' + e.type} x={((a.x + b.x) / 2) * W} y={((a.y + b.y) / 2) * H - 4} text-anchor="middle">
              {e.label.length > 16 ? e.label.slice(0, 15) + '…' : e.label}
            </text>
          );
        })}
      </svg>
      {nodes.map((n) => (
        <button class={'xr-node' + (n.centre ? ' centre' : '')} style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }} onClick={() => !n.centre && open(n.name)}>
          <Face x={people.find((p) => p.name === n.name) || { name: n.name }} size={n.centre ? 64 : 46} />
          <small>{n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}</small>
        </button>
      ))}
    </div>
  );
}

const chapterName = (i) => player.chapters()[i]?.title || `Part ${i + 1}`;
const short = (t, n = 26) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export function XraySheet({ s }) {
  xrBook = s.book;
  const [data, setData] = useState(() => cachedXray(s.book.uid));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('people');
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  xrWiki = data?.wiki || '';
  const recent = useRecent(s);
  const load = (force) => {
    setBusy(true);
    loadXray({ force })
      .then((d) => (setData(d), share(s.book.uid, d)))
      .catch((e) => toast(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (aiReady()) load(false);
  }, []);
  if (!aiReady()) return <p class="muted">X-Ray uses your AI service. Add a key once in Settings → AI.</p>;
  if (!data)
    return (
      <p class="muted">
        <span class="spinner small" /> Finding who and where…
      </p>
    );
  const isPlace = (x) => data.places.includes(x);
  const byName = (name) => data.people.find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || data.people.find((p) => p.name.toLowerCase().includes(String(name).toLowerCase()));
  if (pick) return <Person x={pick} data={data} place={isPlace(pick)} back={() => setPick(null)} open={(n) => byName(n) && setPick(byName(n))} />;

  const now = inScene(data, recent);
  const nowSet = new Set([...now.people, ...now.places].map((x) => x.name));
  const all = tab === 'places' ? data.places : data.people;
  const list = all.filter((x) => !q || `${x.name} ${(x.aliases || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const prev = previousXray(s.book.uid);
  const changes = changesSince(prev?.data, data);
  return (
    <div class="xray xr">
      <h3>X-Ray</h3>
      <p class="muted xr-sub">
        {short(s.book.title, 30)} · up to {short(chapterName(data.at), 28)} · no spoilers
      </p>
      {(now.people.length > 0 || now.places.length > 0) && (
        <>
          <b class="xr-kick">{now.heard ? 'In this scene' : 'In this chapter'}</b>
          <div class="xr-scene">
            {[...now.people, ...now.places].slice(0, 8).map((x) => (
              <button class="xr-card" onClick={() => setPick(x)} style={{ '--h': hueOf(x.name) }}>
                <span class="xr-card-art">{isPlace(x) ? '📍' : initials(x.name)}</span>
                <b>{x.name}</b>
                <small>{short(x.role || x.about || '', 34)}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <div class="segmented xr-tabs">
        <button class={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          People {data.people.length}
        </button>
        <button class={tab === 'places' ? 'on' : ''} onClick={() => setTab('places')}>
          Places {data.places.length}
        </button>
        <button class={tab === 'who' ? 'on' : ''} onClick={() => setTab('who')}>
          Who's who
        </button>
        <button class={tab === 'since' ? 'on' : ''} onClick={() => setTab('since')}>
          Since last{changes.length ? ` · ${changes.length}` : ''}
        </button>
      </div>

      {(tab === 'people' || tab === 'places') && (
        <>
          <input class="story-search" placeholder={tab === 'people' ? 'Find someone' : 'Find a place'} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <ul class="xr-list">
            {list.map((x) => (
              <li onClick={() => setPick(x)}>
                <Face x={x} place={tab === 'places'} />
                <div>
                  <b>{x.name}</b>
                  <small>
                    {short(x.role || x.about || '', 48)}
                    {x.chapters?.length ? ` · from ${short(chapterName(x.chapters[0]), 20)}` : ''}
                  </small>
                </div>
                {nowSet.has(x.name) ? <em class="xr-tag">in scene</em> : x.kind === 'real' ? <em class="xr-tag">real person</em> : ['missing', 'dead'].includes(statusOf(x)) ? <em class="xr-tag">{statusOf(x)}</em> : null}
              </li>
            ))}
          </ul>
          {!list.length && <p class="muted">Nothing here yet.</p>}
        </>
      )}

      {tab === 'who' && <WhosWho data={data} pick={setPick} />}
      {tab === 'since' && <Since data={data} prev={prev} changes={changes} open={(n) => byName(n) && setPick(byName(n))} />}

      <small class="muted xr-foot">Only as far as you've listened · from your own AI key</small>
      <button class="btn ghost-wide" disabled={busy} onClick={() => load(true)}>
        {busy ? <span class="spinner small" /> : 'Refresh'}
      </button>
    </div>
  );
}

/** Who's who: met / alive / missing / dead, and everyone grouped by house / family / side. */
function WhosWho({ data, pick }) {
  const c = counts(data.people);
  return (
    <div class="xr-who">
      <div class="xr-counts">
        {[
          ['met', c.met],
          ['alive', c.alive],
          ['missing', c.missing],
          ['dead', c.dead],
        ].map(([k, n]) => (
          <span>
            <b>{n}</b>
            <small>{k}</small>
          </span>
        ))}
      </div>
      <p class="xr-legend">
        <i class="xr-dot alive" /> alive <i class="xr-dot missing" /> missing <i class="xr-dot dead" /> dead <i class="xr-dot unknown" /> unknown
      </p>
      {groupsOf(data.people).map((g) => (
        <section class="xr-group">
          <header>
            <b>{g.name}</b>
            <small>{g.list.length}</small>
          </header>
          <div class="xr-faces">
            {g.list.map((x) => (
              <button onClick={() => pick(x)}>
                <Face x={x} size={52} dot />
                <small>{short(x.name.split(/\s+/)[0] === x.name ? x.name : x.name.split(/\s+/).slice(0, 2).join(' '), 14)}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Since you last listened: who's new, who changed, links now known; open questions; also called. */
function Since({ data, prev, changes, open }) {
  const called = data.people.filter((p) => p.aliases?.length).slice(0, 6);
  const ICON = { new: '✨', status: '⚑', link: '↔' };
  return (
    <div class="xr-since">
      <p class="muted">{prev ? `${chapterName(prev.data.at)} → ${chapterName(data.at)}` : 'Changes show here from the next chapter on.'}</p>
      {changes.length > 0 && <b class="xr-kick">Character changes</b>}
      {changes.map((c) => (
        <button class="xr-change" onClick={() => open(c.name)}>
          <Face x={{ name: c.name }} size={38} />
          <span>
            <b>
              {ICON[c.kind]} {c.kind === 'new' ? `New: ${c.name}` : c.name}
            </b>
            <small>{c.text}</small>
          </span>
        </button>
      ))}
      {prev && !changes.length && <p class="muted">Nothing new about the people since then.</p>}
      {data.questions?.length > 0 && (
        <>
          <b class="xr-kick">Open questions so far</b>
          {data.questions.map((x) => (
            <div class="xr-question">
              {x.q}
              {x.part ? <small>raised in {short(chapterName(x.part - 1), 24)} · still open</small> : null}
            </div>
          ))}
        </>
      )}
      {called.length > 0 && (
        <>
          <b class="xr-kick">Also called</b>
          {called.map((p) => (
            <button class="xr-change" onClick={() => open(p.name)}>
              <Face x={p} size={38} />
              <span>
                <b>{p.name}</b>
                <small>{p.aliases.map((a) => `“${a}”`).join(', ')}</small>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/** One person's (or place's) page: who they are so far, connections, and moments to jump to. */
function Person({ x, data, place, back, open }) {
  const tl = timeline(x, data);
  const photo = usePhoto(x, place);
  const first = x.chapters?.[0];
  const st = statusOf(x);
  return (
    <div class="xray xr xr-person">
      <div class="xr-hero" style={{ '--h': hueOf(x.name) }}>
        <button class="pill small" onClick={back}>
          ‹ X-Ray
        </button>
        {photo ? (
          <span class="xr-hero-photo">
            <img src={photo.url} alt="" referrerpolicy="no-referrer" />
            <small>Photo: {photo.from || 'Wikipedia'}{photo.page && photo.page !== x.name ? ` · ${photo.page}` : ''}</small>
          </span>
        ) : (
          <span class="xr-hero-art">{place ? '📍' : initials(x.name)}</span>
        )}
        <h3>{x.name}</h3>
        {x.role && <p>{x.role}</p>}
        <div class="xr-chips">
          {(x.aliases || []).slice(0, 4).map((a) => (
            <span>“{a}”</span>
          ))}
          {x.kind === 'real' && <span class="hi">Real person</span>}
        </div>
      </div>
      {!place && (
        <div class="xr-facts">
          <span>
            <small>First seen</small>
            <b>{first != null ? short(chapterName(first), 16) : '—'}</b>
          </span>
          <span>
            <small>Chapters</small>
            <b>
              {x.chapters?.length || 0} of {data.at + 1}
            </b>
          </span>
          <span>
            <small>Status now</small>
            <b class={'st-' + st}>{st[0].toUpperCase() + st.slice(1)}</b>
          </span>
        </div>
      )}
      <b class="xr-kick">In the story so far</b>
      <p>{x.about}</p>
      {x.connections?.length > 0 && (
        <>
          <b class="xr-kick">Connections</b>
          <RelationMap x={x} people={data.people} open={open} />
          <p class="xr-legend">
            <i class="xr-line family" /> family / bond <i class="xr-line enemy" /> enemies <i class="xr-line ally" /> allies · links only as the story reveals them
          </p>
          <div class="xr-faces">
            {x.connections.map((c) => (
              <button onClick={() => open(c.to)}>
                <Face x={{ name: c.to }} size={52} />
                <small class={'xr-link ' + c.type}>{short(c.label || c.to, 14)}</small>
                <small>{short(c.to, 14)}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <b class="xr-kick">{tl.length ? `Moments · ${tl.length} ${tl.length === 1 ? 'chapter' : 'chapters'}` : 'Not placed in a chapter yet'}</b>
      <ul class="xray-tl">
        {tl.map((e) => (
          <li>
            <button
              onClick={() => {
                player.seekGlobal(e.g);
                toast(`Jumped to ${e.title}`);
              }}
            >
              <b>{e.title}</b>
              <small>{e.said ? `“${e.said.slice(0, 90)}${e.said.length > 90 ? '…' : ''}”` : data.topics?.[e.chapter] || 'From the start of the chapter'}</small>
              <span class="xray-at">{fmtTime(e.g)}</span>
            </button>
          </li>
        ))}
      </ul>
      <small class="muted">Only what's known up to where you are · tap a moment to play from there.</small>
    </div>
  );
}
