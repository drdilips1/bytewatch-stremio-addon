// The player's controls under the page, as in Narrato on Android: where you are (bar, chapter, time left),
// back · play · next, and speed, voice, sleep and More. One place to listen: the home screen's card, books
// and player bar all open the reader with these controls. While a book plays they slide away after a few
// seconds (a small pause button stays); a tap on the page brings them back.
import { getBook } from './db.js';
import { Speech, native, rate, setRate, voiceName, pickVoice, sheet, setSleep, pronounceSheet, chaptersOf } from './speech.js';

const bookId = new URLSearchParams(location.search).get('id');
const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const SLEEPS = [
  [0, 'Off'],
  [15, '15 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 hour'],
  [-1, 'End of chapter'],
];

const ICON = {
  play: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  prev: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6v12M18 6l-9 6 9 6z"/></svg>',
  next: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6v12M6 6l9 6-9 6z"/></svg>',
  speed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  voice: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  sleep: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
};

const CSS = `
#n-dock{--bg:#f4f6fa;--card:#fff;--line:#e3e8f0;--text:#161a22;--muted:#5e6573;--accent:#3f5fd6;--play:#3f5fd6;--on-play:#fff;
  position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--bg);color:var(--text);border-top:1px solid var(--line);
  padding:10px 16px calc(env(safe-area-inset-bottom) + 10px);font:15px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;
  transition:transform .22s ease;box-shadow:0 -8px 24px rgba(0,0,0,.18)}
#n-dock.dark{--bg:#171b22;--card:#0e1116;--line:#262c38;--text:#f3eee4;--muted:#a3aab8;--accent:#7c9bff;--play:#d5dce6;--on-play:#10141c}
#n-dock.away{transform:translateY(110%)}
#n-dock .wrap{max-width:720px;margin:0 auto}
#n-dock input[type=range]{width:100%;margin:0;accent-color:var(--accent)}
#n-dock .meta{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:13px;margin:4px 0 6px}
#n-dock .meta span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#n-dock .row{display:flex;align-items:center;justify-content:center;gap:34px}
#n-dock button{font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
#n-dock .round{width:52px;height:52px;display:flex;align-items:center;justify-content:center;border-radius:26px}
#n-dock .play,#n-mini{width:72px;height:72px;border-radius:36px;color:var(--on-play);display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 50%,rgba(0,0,0,.15)),var(--play);box-shadow:0 8px 20px rgba(0,0,0,.25)}
#n-dock .tools{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:6px}
#n-dock .tool{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:52px;justify-content:center;font-size:13px;font-weight:600}
#n-dock .tool span{max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#n-mini{position:fixed;right:18px;bottom:calc(env(safe-area-inset-bottom) + 22px);z-index:51;width:56px;height:56px;border:0;display:none;
  --play:#3f5fd6;--on-play:#fff}
#n-mini.dark{--play:#d5dce6;--on-play:#10141c}
#n-mini.show{display:flex}
/* The reader's own read-aloud strip: these controls take its place. */
.aloud-bar{display:none!important}
.reader-scroll{padding-bottom:var(--n-dock-h,0px)!important}
#p2a-sheet .chips{display:flex;flex-wrap:wrap;gap:8px}
#p2a-sheet .chips button{border:0;border-radius:999px;padding:10px 16px;font:inherit;color:inherit;background:rgba(127,127,127,.18)}
#p2a-sheet .chips button.on{background:var(--accent,#7c9bff);color:#10141c;font-weight:700}
`;

function dark() {
  const t = localStorage.getItem('p2a:iosTheme') || 'system';
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

const minutes = (words, speed) => {
  const m = Math.max(0, Math.round(words / 150 / Math.max(0.5, speed)));
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
};

async function mount() {
  if (!bookId) return;
  const book = await getBook(bookId);
  if (!book) return;
  const blocks = book.blocks || [];
  const total = blocks.length;
  const chapters = chaptersOf(book);
  // Words still to come after each paragraph (for "time left"), worked out once.
  const after = new Array(total + 1).fill(0);
  for (let i = total - 1; i >= 0; i--) after[i] = after[i + 1] + (blocks[i].t ? blocks[i].t.split(' ').length : 0);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const dock = document.createElement('div');
  dock.id = 'n-dock';
  dock.innerHTML = `<div class="wrap">
    <input type="range" min="0" max="${Math.max(0, total - 1)}" value="0" aria-label="Position in the book">
    <div class="meta"><span class="where"></span><span class="left"></span></div>
    <div class="row">
      <button class="round prev" aria-label="Previous paragraph">${ICON.prev}</button>
      <button class="play" aria-label="Play">${ICON.play}</button>
      <button class="round next" aria-label="Next paragraph">${ICON.next}</button>
    </div>
    <div class="tools">
      <button class="tool speed">${ICON.speed}<span></span></button>
      <button class="tool voice">${ICON.voice}<span></span></button>
      <button class="tool sleep">${ICON.sleep}<span>Sleep</span></button>
      <button class="tool more">${ICON.more}<span>More</span></button>
    </div></div>`;
  document.body.appendChild(dock);
  const mini = document.createElement('button');
  mini.id = 'n-mini';
  mini.setAttribute('aria-label', 'Pause');
  mini.innerHTML = ICON.pause;
  document.body.appendChild(mini);

  const $ = (s) => dock.querySelector(s);
  const seek = $('input');
  let st = null; // the iPhone's reading state, when it is reading this book
  let dragging = false;

  const theme = () => {
    dock.classList.toggle('dark', dark());
    mini.classList.toggle('dark', dark());
  };
  const fitPage = () => document.documentElement.style.setProperty('--n-dock-h', dock.classList.contains('away') ? '0px' : dock.offsetHeight + 'px');

  const here = () => st && st.active && st.uid === bookId;
  const at = () => (here() ? st.para : Number(seek.value) || 0);
  function render() {
    theme();
    const playing = here() && st.playing;
    $('.play').innerHTML = playing ? ICON.pause : ICON.play;
    $('.play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (!dragging && here()) seek.value = String(st.para);
    const p = Number(seek.value) || 0;
    const ch = [...chapters].reverse().find((c) => c.para <= p);
    const pct = total > 1 ? Math.round((p * 100) / (total - 1)) : 0;
    $('.where').textContent = (ch ? ch.title + ' · ' : '') + pct + '%';
    $('.left').textContent = minutes(after[Math.min(p, total)] || 0, rate());
    $('.speed span').textContent = `${rate()}x`;
    $('.voice span').textContent = (voiceName() || 'Voice').split(' · ')[0];
    $('.sleep span').textContent = here() && st.sleep != null ? (st.sleep === 'chapter' ? 'Chapter end' : `${Math.ceil(st.sleep / 60)} min`) : 'Sleep';
    if (!playing) show(false);
    fitPage();
  }

  // ---- sliding away while playing ----
  let timer = 0;
  function show(thenHide = here() && st.playing) {
    clearTimeout(timer);
    dock.classList.remove('away');
    mini.classList.remove('show');
    fitPage();
    if (thenHide) timer = setTimeout(hide, 4000);
  }
  function hide() {
    if (!(here() && st.playing) || dragging) return;
    dock.classList.add('away');
    mini.classList.add('show');
    fitPage();
  }
  // A tap on the page (not a scroll) brings the controls back for a while.
  let down = null;
  addEventListener('touchstart', (e) => (down = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }), { passive: true });
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!down || Date.now() - down.t > 400 || Math.hypot(t.clientX - down.x, t.clientY - down.y) > 24) return;
    if (dock.contains(e.target) || mini.contains(e.target)) return;
    if (here() && st.playing) show(true);
  }, { passive: true });
  dock.addEventListener('touchstart', () => clearTimeout(timer), { passive: true });
  dock.addEventListener('touchend', () => here() && st.playing && show(true), { passive: true });

  // ---- the controls ----
  const play = () => {
    if (here() && st.finished) return Speech.seek({ para: 0 }).then(() => Speech.resume()).catch(() => {});
    if (here() && st.playing) return Speech.pause().catch(() => {});
    // The reader starts (or carries on) reading: from a tapped paragraph, else where the page is.
    if (window.__p2aAloud) window.__p2aAloud.play();
    else document.querySelector('button[aria-label="Read aloud"]')?.click();
  };
  $('.play').onclick = play;
  mini.onclick = () => {
    Speech.pause().catch(() => {});
    show(false);
  };
  const go = (para) => {
    const p = Math.max(0, Math.min(total - 1, para));
    seek.value = String(p);
    if (here()) Speech.seek({ para: p }).catch(() => {});
    else document.querySelector(`.reader-text [data-i="${p}"]`)?.scrollIntoView({ block: 'start' });
    render();
  };
  $('.prev').onclick = () => go(at() - 1);
  $('.next').onclick = () => go(at() + 1);
  seek.oninput = () => {
    dragging = true;
    render();
  };
  seek.onchange = () => {
    dragging = false;
    go(Number(seek.value));
  };
  $('.speed').onclick = () =>
    sheet('Reading speed', (box, close) => {
      const row = document.createElement('div');
      row.className = 'chips';
      for (const s of SPEEDS) {
        const b = document.createElement('button');
        b.textContent = `${s}x`;
        if (s === rate()) b.className = 'on';
        b.onclick = async () => {
          setRate(s);
          try {
            const { ttsCfg } = await import('../../reader-web/src/lib/tts.js');
            ttsCfg.patch({ rate: s });
          } catch {}
          close();
          render();
        };
        row.appendChild(b);
      }
      box.appendChild(row);
    });
  $('.voice').onclick = () => pickVoice();
  $('.sleep').onclick = () =>
    sheet('Sleep timer', (box, close) => {
      const row = document.createElement('div');
      row.className = 'chips';
      for (const [m, label] of SLEEPS) {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => {
          setSleep(m).catch(() => {});
          close();
        };
        row.appendChild(b);
      }
      box.appendChild(row);
    });
  $('.more').onclick = () =>
    sheet('More', (box, close) => {
      const item = (label, f) => {
        const b = document.createElement('button');
        b.className = 'v';
        b.textContent = label;
        b.onclick = () => {
          close();
          f();
        };
        box.appendChild(b);
      };
      if (chapters.length)
        item('Chapters', () =>
          sheet('Chapters', (cbox, cclose) => {
            for (const c of chapters) {
              const b = document.createElement('button');
              b.className = 'v' + (c.para <= at() && !chapters.some((d) => d.para > c.para && d.para <= at()) ? ' on' : '');
              b.textContent = c.title;
              b.onclick = () => {
                cclose();
                go(c.para);
              };
              cbox.appendChild(b);
            }
          })
        );
      item('Text and page', () => document.querySelector('button[aria-label="Text settings"]')?.click());
      item('Pronunciations', () => pronounceSheet());
    });

  // ---- following the iPhone's reading ----
  if (native) {
    Speech.status().then((s) => {
      st = s;
      if (!here()) seek.value = String(Math.min(total - 1, Number(JSON.parse(localStorage.getItem('p2a:pos') || '{}')[bookId]) || 0));
      render();
    }).catch(render);
    let wasPlaying = false;
    Speech.addListener('state', (s) => {
      st = s;
      const playing = here() && st.playing;
      if (playing && !wasPlaying) show(true);
      wasPlaying = playing;
      render();
    });
  } else render();
  // The voice may change in its sheet: the name follows when it closes.
  new MutationObserver(() => !document.getElementById('p2a-sheet') && render()).observe(document.body, { childList: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  addEventListener('resize', fitPage);
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
else mount();
