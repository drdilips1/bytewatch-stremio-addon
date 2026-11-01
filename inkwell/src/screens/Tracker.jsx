import { useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { useStore } from '../lib/store.js';
import * as qb from '../sources/qbit.js';

/**
 * Tracker (in Settings): the tracker site you use, signed in inside the app —
 * tapping a .torrent download or magnet there sends it to your qBittorrent at home.
 * Optional search addresses let book pages and results open a search there.
 */
export function TrackerCard() {
  const tr = useStore(qb.tracker);
  const last = useStore(qb.lastCapture);
  const [site, setSite] = useState(tr.url || '');
  const ready = qb.available && qb.configured();
  const name = tr.url ? tr.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';

  if (!ready) {
    return (
      <p class="muted">
        {qb.available ? 'Set up the home server (qBittorrent) above first — tracker downloads are sent there.' : 'Works in the Android app.'}
      </p>
    );
  }
  if (!tr.url) {
    return (
      <>
        <p class="muted">Add the tracker site you use. You sign in inside the app once; tapping a .torrent or magnet there sends it to qBittorrent at home.</p>
        <form
          class="set-form inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (site.trim()) qb.tracker.set((t) => ({ ...t, url: site.trim() }));
          }}
        >
          <input value={site} placeholder="Your tracker's address (e.g. www.example.net)" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setSite(e.currentTarget.value)} />
          <button class="btn primary" disabled={!site.trim()}>
            Save
          </button>
        </form>
      </>
    );
  }
  return (
    <>
      <div class="set-row">
        <div>
          <b>{name}</b>
          <small>Downloads you tap there go to qBittorrent — ebooks to your ebooks folder.</small>
        </div>
        <button class="pill small" onClick={() => qb.openTracker().catch((e) => toast(e.message))}>
          <Icon name="external" size={14} /> Open
        </button>
      </div>
      {last.at > 0 && (
        <div class={'tracker-last' + (last.ok ? '' : ' bad')}>
          <Icon name={last.ok ? 'check' : 'info'} size={14} /> {last.text}
          <small> · {new Date(last.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
        </div>
      )}
      {/myanonamouse\.net$/i.test(name) && <GrabOptions />}
      <SearchAddress />
      <button
        class="link-btn tracker-change"
        onClick={() => {
          if (confirm('Remove this tracker site and its search addresses?')) qb.tracker.set({ url: '', search: '' });
        }}
      >
        Change site
      </button>
    </>
  );
}

/**
 * Optional: the site's search address, so book pages can open a search for that
 * book ("Search on your tracker"). Copy the address of a search results page and
 * put {q} where the search words are.
 */
function SearchAddress() {
  const tr = useStore(qb.tracker);
  const [v, setV] = useState(tr.search || '');
  const ok = !v.trim() || v.includes('{q}');
  return (
    <div class="tracker-search">
      <small class="muted">
        Search address (optional) — lets book pages open a search here. Search for any word on your site, copy the address of the results page, paste it below and replace that word with{' '}
        <b>{'{q}'}</b>.
      </small>
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return toast('Put {q} where the search words go');
          qb.tracker.set((t) => ({ ...t, search: v.trim() }));
          toast(v.trim() ? 'Saved — results can search your site now' : 'Search address removed');
        }}
      >
        <input value={v} placeholder="https://…/search?text={q}" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" disabled={v.trim() === (tr.search || '')}>
          Save
        </button>
      </form>
      <FilteredAddress />
    </div>
  );
}

/** A second search address with your site's own filters on, shown as an extra button on each result. */
function FilteredAddress() {
  const tr = useStore(qb.tracker);
  const [v, setV] = useState(tr.search2 || '');
  const [label, setLabel] = useState(tr.label2 || '');
  const ok = !v.trim() || v.includes('{q}');
  const changed = v.trim() !== (tr.search2 || '') || label.trim() !== (tr.label2 || '');
  return (
    <>
      <small class="muted">
        Filtered search (optional) — the same, but copied with your site's filters turned on. Each result then gets two buttons: this one first, and the plain search if it finds nothing.
      </small>
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return toast('Put {q} where the search words go');
          qb.tracker.set((t) => ({ ...t, search2: v.trim(), label2: label.trim().slice(0, 12) }));
          toast(v.trim() ? 'Saved' : 'Filtered search removed');
        }}
      >
        <input class="label-input" value={label} placeholder="Label" maxLength={12} onInput={(e) => setLabel(e.currentTarget.value)} />
        <input value={v} placeholder="https://…/search?text={q}&…" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" disabled={!changed}>
          Save
        </button>
      </form>
      <EbookAddress />
    </>
  );
}

/** Optional: a filtered search for ebook results (a site's filters are often per category). */
function EbookAddress() {
  const tr = useStore(qb.tracker);
  const [v, setV] = useState(tr.search3 || '');
  const ok = !v.trim() || v.includes('{q}');
  return (
    <>
      <small class="muted">Filtered search for ebooks (optional) — if your filtered address above is for audiobooks only, copy one with the same filters for ebooks. Ebook results use it.</small>
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return toast('Put {q} where the search words go');
          qb.tracker.set((t) => ({ ...t, search3: v.trim() }));
          toast(v.trim() ? 'Saved' : 'Ebook search removed');
        }}
      >
        <input value={v} placeholder="https://…/search?text={q}&…" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" disabled={v.trim() === (tr.search3 || '')}>
          Save
        </button>
      </form>
    </>
  );
}

/** MyAnonamouse: tap M to grab in the background; optionally spend a freeleech wedge. */
function GrabOptions() {
  const tr = useStore(qb.tracker);
  const row = (on, set, label, hint) => (
    <label class="set-row">
      <div>
        <b>{label}</b>
        <small>{hint}</small>
      </div>
      <input type="checkbox" class="switch" checked={on} onChange={(e) => set(e.currentTarget.checked)} />
    </label>
  );
  return (
    <div class="tracker-grab">
      {row(
        tr.background !== false,
        (v) => qb.tracker.set((t) => ({ ...t, background: v })),
        'Tap M to get it in the background',
        'Finds the book (freeleech or VIP first, M4B / MP3 or EPUB, most seeders), downloads it and sends it to qBittorrent — nothing opens. Press and hold M to open the search instead.'
      )}
      {tr.background !== false && <MamSession />}
      {tr.background !== false &&
        row(
          tr.wedge === true,
          (v) => qb.tracker.set((t) => ({ ...t, wedge: v })),
          'Use a freeleech wedge',
          'When the best copy isn’t freeleech or VIP, spend one of your wedges on it first. Off: it downloads normally (counts toward your ratio).'
        )}
    </div>
  );
}

/** Your MAM session id (Security page), so a change of network doesn't sign the app out. */
function MamSession() {
  const m = useStore(qb.mamSession);
  const [v, setV] = useState('');
  const has = !!m.id;
  return (
    <div class="tracker-search">
      <b>MAM session</b>
      <small class="muted">
        {has
          ? `Saved${m.updatedAt ? ` · network last updated ${new Date(m.updatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. When MAM says your network changed, the app tells it the new one and carries on.`
          : 'On MyAnonamouse: Preferences → Security → create a session (your current IP, ASN lock, tick "Allow session to set dynamic seedbox"). Paste its mam_id here. It stays on this phone only.'}
      </small>
      <form
        class="set-form inline"
        onSubmit={(e) => {
          e.preventDefault();
          const id = v.trim().replace(/^mam_id=/, '');
          qb.mamSession.set({ id, updatedAt: 0, note: '' });
          setV('');
          toast(id ? 'MAM session saved' : 'MAM session removed');
        }}
      >
        <input type="password" value={v} placeholder={has ? 'Paste a new mam_id to replace it' : 'Paste mam_id'} autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setV(e.currentTarget.value)} />
        <button class="btn primary" disabled={!v.trim()}>
          Save
        </button>
        {has && (
          <button type="button" class="btn secondary" onClick={() => (qb.mamSession.set({ id: '', updatedAt: 0, note: '' }), toast('MAM session removed'))}>
            Remove
          </button>
        )}
      </form>
    </div>
  );
}
