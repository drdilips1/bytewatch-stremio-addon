// Lesionaut History: everything done in the app, newest first: cases (their own store), "Teach me
// this slide" sessions, rare-case detective searches, Explore answers (patterns, relationships,
// literature) and calculator results. Search, filters, reopen as it was, ★ keep, delete.
(() => {
  'use strict';
  const L = window.LX;
  const { $, esc, icon, toast, md, go, bar, actions, routes, DB, list, fmt } = L;
  const view = () => $('#view');

  const KIND = {
    case: ['Case', 'cases'], slide: ['Slide', 'graduation'], dermoscopy: ['Dermoscopy', 'search'],
    detective: ['Detective', 'detective'], notes: ['Note', 'note'], score: ['Score', 'tools'],
  };
  const FILTERS = [['all', 'All'], ['star', '★ Kept'], ['case', 'Cases'], ['slide', 'Slides'], ['dermoscopy', 'Dermoscopy'], ['detective', 'Detective'], ['notes', 'Notes'], ['score', 'Scores']];

  /** Cases and the other saved things as one list of { id, kind, title, sub, at, thumb, star, to }. */
  async function everything() {
    const [cs, hs] = await Promise.all([DB.all().catch(() => []), DB.hist.all().catch(() => [])]);
    const cases = cs.filter((c) => c.pics.length || c.assessments.length || c.title || c.patient || Object.values(c.pt).some(Boolean)).map((c) => {
      const top = list(L.last(c)?.r?.differentials)[0];
      const dermo = c.pics.some((p) => p.kind === 'dermoscopy');
      return { id: c.id, kind: 'case', dermo, title: L.titleOf(c), sub: [L.ptLine(c), c.final?.dx ? '✓ ' + c.final.dx : top ? 'Leading: ' + top.name : 'Not assessed'].filter(Boolean).join(' · '),
        at: c.updated, thumb: c.pics[0]?.url || '', star: !!c.star, to: 'case/' + c.id, text: JSON.stringify([c.pt, c.final, list(L.last(c)?.r?.differentials).map((d) => d.name)]) };
    });
    const rest = hs.map((h) => ({ ...h, at: h.updated || h.at, to: 'hist/' + encodeURIComponent(h.id), text: JSON.stringify(h.data || {}).slice(0, 4000) }));
    return [...cases, ...rest].sort((a, b) => b.at - a.at);
  }

  routes.history = async (_, params) => {
    const f = params.f || 'all', q = (params.q || '').toLowerCase();
    view().innerHTML = `${bar('History', { back: false })}
      <form class="search" data-form="hq">${icon('search')}<input name="q" value="${esc(params.q || '')}" placeholder="Search everything you've done" enterkeyhint="search"></form>
      <div class="chips" style="margin-top:8px">${FILTERS.map(([k, l]) => `<button class="chip ${k === f ? 'on' : ''}" data-act="go" data-to="history?f=${k}${q ? '&q=' + encodeURIComponent(params.q) : ''}">${l}</button>`).join('')}</div>
      <div class="card list" id="hlist" style="margin-top:8px"><div class="busy"><span class="spin"></span>Loading…</div></div>
      <p class="disc">Saved automatically on this device: cases, teaching sessions, detective searches, answers and scores.</p>`;
    $('[data-form=hq]').addEventListener('submit', (e) => { e.preventDefault(); go(`history?f=${f}&q=${encodeURIComponent(e.target.q.value.trim())}`, { replace: true }); });
    let items = await everything();
    if (f === 'star') items = items.filter((x) => x.star);
    else if (f === 'dermoscopy') items = items.filter((x) => x.kind === 'dermoscopy' || x.dermo);
    else if (f !== 'all') items = items.filter((x) => x.kind === f);
    if (q) items = items.filter((x) => (x.title + ' ' + (x.sub || '') + ' ' + x.text).toLowerCase().includes(q));
    // Kept items first, then newest first.
    items.sort((a, b) => (b.star - a.star) || (b.at - a.at));
    $('#hlist').innerHTML = items.length ? items.map((x) => `<button class="li" data-act="go" data-to="${esc(x.to)}">
        ${x.thumb ? `<img src="${x.thumb}" alt="">` : `<span class="ph">${icon(KIND[x.kind]?.[1] || 'note')}</span>`}
        <span><small class="hk">${x.star ? '<span class="hist-star">★</span> ' : ''}${esc(KIND[x.kind]?.[0] || 'Saved')}</small><b>${esc(x.title || 'Untitled')}</b><small>${esc([x.sub, fmt(x.at)].filter(Boolean).join(' · '))}</small></span>${icon('chev')}</button>`).join('')
      : `<div class="empty">${icon('history')}<b>${q || f !== 'all' ? 'Nothing matches' : 'Nothing saved yet'}</b>Cases, teaching sessions, detective searches, answers and scores appear here as you use the app.</div>`;
  };

  // ---- One saved item, as it was
  let h = null;
  routes.hist = async (arg) => {
    h = await DB.hist.get(decodeURIComponent(arg)).catch(() => null);
    if (!h) { view().innerHTML = `${bar('History')}<div class="empty">${icon('alert')}<b>Not found</b>It may have been deleted.</div>`; return; }
    const d = h.data || {};
    const right = `<button class="ib" data-act="hist-star" aria-label="Keep">${h.star ? '<span class="hist-star" style="font-size:20px">★</span>' : icon('star')}</button><button class="ib" data-act="hist-del" aria-label="Delete">${icon('trash')}</button>`;
    let body = '';
    if (h.kind === 'slide' || h.kind === 'dermoscopy') {
      body = `${d.pic ? `<div class="teach-pic"><img src="${d.pic}" alt="" data-act="hist-zoom"></div>` : ''}
        ${d.ctx ? `<p class="small muted">${esc(d.ctx)}</p>` : ''}
        <div class="card" style="margin-top:10px">${md(d.out || '')}</div>
        <button class="btn full" style="margin-top:10px" data-act="go" data-to="teach?h=${encodeURIComponent(h.id)}">${icon('graduation')}Open in Teach me (ask again, quiz)</button>`;
    } else if (h.kind === 'detective') {
      body = `${d.text ? `<div class="card"><p class="small" style="margin:0;white-space:pre-wrap">${esc(d.text)}</p></div>` : ''}
        ${list(d.pics).length ? `<div class="pics" style="margin-top:10px">${list(d.pics).map((u, i) => `<div class="pic"><img src="${u}" alt="" data-act="hist-zoom" data-i="${i}"></div>`).join('')}</div>` : ''}
        <div style="margin-top:10px">${d.out ? L.rareHtml(d.out) : ''}</div>`;
    } else if (h.kind === 'score') {
      const t = L.TOOLS?.[d.tool];
      body = `<div class="calc-out"><b>${esc(d.val)}</b><span>${esc(d.band || '')}</span></div><p class="muted small">${esc(t?.full || '')}</p>
        <button class="btn full" data-act="hist-tool">${icon('tools')}Open in the calculator with these inputs</button>`;
    } else {
      body = `${d.text ? `<div class="card">${md(d.text)}</div>` : ''}${list(d.reports).length ? `<div class="card list">${L.reportsHtml(d.reports)}</div>` : ''}
        ${d.link ? `<button class="btn full" style="margin-top:10px" data-act="go" data-to="${esc(d.link)}">${icon('refresh')}Open again (fresh answer)</button>` : ''}`;
    }
    view().innerHTML = `${bar(KIND[h.kind]?.[0] || 'Saved', { right })}
      <h2 style="margin:0 0 4px;font-size:20px">${esc(h.title || '')}</h2><p class="tiny muted" style="margin-top:0">${esc([h.sub, fmt(h.updated || h.at)].filter(Boolean).join(' · '))}</p>${body}`;
  };
  actions['hist-zoom'] = (b) => {
    const d = h.data || {}, pics = d.pic ? [d.pic] : list(d.pics);
    L.lightbox(pics.map((src) => ({ src })), +(b.dataset.i || 0));
  };
  actions['hist-star'] = async () => { h.star = !h.star; await DB.hist.put(h); toast(h.star ? '★ Kept' : 'Unmarked'); routes.hist(encodeURIComponent(h.id)); };
  actions['hist-del'] = async () => { if (!confirm('Delete this from History?')) return; await DB.hist.del(h.id); toast('Deleted'); actions.back(); };
  actions['hist-tool'] = () => { L.store.set('histTool', { tool: h.data.tool, state: h.data.state }); go(`tool/${h.data.tool}?from=1`); };
})();
