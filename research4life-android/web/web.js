/* DermScholar on the web (iPhone Safari → Share → Add to Home Screen) and in the iPhone app.
 * Loaded before app.js in the web build and the iPhone app only. The Android app does AI requests, PDF storage,
 * read aloud and file picking in Java (MainActivity's "Native" bridge); this file does the same
 * jobs with browser features, so the shared screens work unchanged. Features that need Android
 * (Research4Life/UpToDate sign-in inside the app, MyLOFT handoff) open the website in a new tab.
 * Inside the iPhone app (ios/), those open in its built-in browser instead, PDFs opened there are
 * filed into the library, and pages are fetched through the app (no browser CORS limits).
 */
(() => {
  'use strict';

  // The iPhone app's native side (ios/DermScholar/MainViewController.swift), when running inside it.
  const IOS = (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ios) || null;
  const ios = (cmd, o = {}) => IOS.postMessage({ cmd, ...o });
  const emit = (e) => setTimeout(() => window.App && window.App.onNative(e), 0);
  const toast = (m) => (window.DS ? window.DS.toast(m) : console.log(m));
  // Own prefix: kept out of the account sync (which syncs "ds." keys), so API keys stay on this phone.
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('dsweb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dsweb.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem('dsweb.' + k); } catch { /* blocked */ } },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const userActive = () => (navigator.userActivation ? navigator.userActivation.isActive : true);

  /** Opens a link in a new tab; when the tap that asked for it is long gone (Safari blocks the
   * pop-up), shows a button to open it instead. */
  function openTab(url, label = 'Open', key = '') {
    if (!url) return;
    if (IOS) { try { document.activeElement && document.activeElement.blur(); } catch { /* none */ } toast('Opening…'); ios('browse', { url, key }); return; }
    let w = null;
    if (userActive()) { try { w = window.open(url, '_blank', 'noopener'); } catch { w = null; } }
    if (w || (userActive() && !navigator.userActivation)) return;
    tapToContinue(label, () => window.open(url, '_blank', 'noopener'), url.replace(/^https?:\/\//, '').slice(0, 60));
  }

  /** A small card with one button: Safari only opens pickers and tabs from a direct tap. */
  function tapToContinue(label, run, sub = '') {
    document.getElementById('dsweb-tap')?.remove();
    const el = document.createElement('div');
    el.id = 'dsweb-tap';
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:9999;background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--line,#ddd);border-radius:16px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center';
    el.innerHTML = '<div style="flex:1;min-width:0;font-size:14px"></div><button class="btn primary"></button><button class="btn" aria-label="Close">✕</button>';
    el.children[0].textContent = sub || '';
    el.children[1].textContent = label;
    el.children[1].onclick = () => { el.remove(); run(); };
    el.children[2].onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60000);
  }

  // ================================================================ files (PDFs and imports)
  // Stored with the Cache API; an index in localStorage answers listPdfs() synchronously.
  const FILES = 'dsweb-files';
  const fileUrl = (kind, key) => new URL('__files/' + kind + '/' + encodeURIComponent(key), location.href).href;
  const pdfIndex = () => ls.get('pdfs', {});
  // The Cache API needs a secure http(s) page: the iPhone app's own pages (dsapp://, secure but
  // not http) keep files in IndexedDB instead ("Request url is not HTTP/HTTPS" otherwise).
  const useCache = typeof caches !== 'undefined' && window.isSecureContext && /^https?:$/.test(location.protocol);
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => {
    const r = indexedDB.open('dsweb-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const idbDo = async (mode, f) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('files', mode); const q = f(t.objectStore('files')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  async function putFile(kind, key, blob, type) {
    const t = type || blob.type || 'application/octet-stream';
    if (!useCache) { await idbDo('readwrite', (st) => st.put({ blob: new Blob([blob], { type: t }), type: t }, kind + '/' + key)); return; }
    const c = await caches.open(FILES);
    await c.put(fileUrl(kind, key), new Response(blob, { headers: { 'Content-Type': t } }));
  }
  async function getFile(kind, key) {
    try {
      if (!useCache) { const o = await idbDo('readonly', (st) => st.get(kind + '/' + key)); return o ? new Response(o.blob, { headers: { 'Content-Type': o.type } }) : null; }
      const c = await caches.open(FILES); return await c.match(fileUrl(kind, key));
    } catch { return null; }
  }
  async function delFile(kind, key) {
    try {
      if (!useCache) { await idbDo('readwrite', (st) => st.delete(kind + '/' + key)); return; }
      const c = await caches.open(FILES); await c.delete(fileUrl(kind, key));
    } catch { /* gone */ }
  }
  /** Fetches another site: through the iPhone app when inside it (no CORS limits), else directly. */
  const nfetch = (url) => (IOS ? realFetch('/proxy?u=' + encodeURIComponent(url)) : realFetch(url));
  async function savePdf(key, blob, title, source) {
    await putFile('pdf', key, blob, 'application/pdf');
    const idx = pdfIndex();
    idx[key] = { title: title || 'Document', size: blob.size, added: Date.now(), source: source || '' };
    ls.set('pdfs', idx);
  }
  const keyOf = (url) => decodeURIComponent(String(url).split('?')[0].replace(/\/+$/, '').split('/').pop());
  const isPdf = (buf) => { const b = new Uint8Array(buf.slice(0, 1024)); for (let i = 0; i < b.length - 4; i++) if (b[i] === 37 && b[i + 1] === 80 && b[i + 2] === 68 && b[i + 3] === 70) return true; return false; };

  // The shared screens read files from /pdf/<key> and /import/<key> (served by the Android app).
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url;
    const m = u && /^(?:https?:\/\/[^/]+)?\/(pdf|import)\/([^?#]+)/.exec(u);
    if (m && (!/^https?:/.test(u) || new URL(u).origin === location.origin)) {
      const r = await getFile(m[1] === 'pdf' ? 'pdf' : 'doc', decodeURIComponent(m[2]));
      return r || new Response('Not found', { status: 404 });
    }
    return realFetch(input, init);
  };

  /** A file the user picked or shared: PDFs go to the library, anything else to the document importer. */
  async function receiveFile(file) {
    const name = file.name || 'Document';
    const mime = file.type || '';
    try {
      if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
        const p = ls.get('pending', null);
        const attached = !!(p && Date.now() - p.t < 2 * 3600e3);
        const key = attached ? p.key : 'import_' + Date.now();
        const title = attached ? p.title : name.replace(/\.pdf$/i, '');
        await savePdf(key, file, title, 'import');
        if (attached) ls.del('pending');
        emit({ type: 'pdfReceived', key, title, attached });
      } else {
        const key = 'doc_' + Date.now();
        await putFile('doc', key, file, mime);
        emit({ type: 'docReceived', key, name, mime });
      }
    } catch (e) {
      toast("Couldn't import " + name + (e && e.message ? ': ' + e.message : ''));
    }
  }

  function pickFiles(accept, onFiles, { capture = false, label = 'Choose a file' } = {}) {
    const run = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      if (capture) inp.capture = 'environment';
      inp.style.display = 'none';
      inp.onchange = () => { const fs = Array.from(inp.files || []); inp.remove(); if (fs.length) onFiles(fs); };
      document.body.appendChild(inp);
      inp.click();
    };
    if (userActive()) run(); else tapToContinue(label, run);
  }

  /** A picked photo as a JPEG data URL, longer side at most `max` px (as the Android app sends). */
  function imageDataUrl(file, max = 1280) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image")); };
      img.src = url;
    });
  }

  // ================================================================ AI (own keys, called from the browser)
  const PROVIDERS = ['groq', 'gemini', 'claude'];
  const DEFAULT_MODEL = { groq: 'openai/gpt-oss-120b', gemini: 'gemini-3.8-flash', claude: 'claude-opus-5-5' };
  const LABEL = { groq: 'Groq', gemini: 'Gemini', claude: 'Claude' };
  const known = (p) => (p === 'claude' || p === 'gemini' ? p : 'groq');
  const provider = () => known(ls.get('ai.provider', 'groq'));
  const keyFor = (p) => ls.get('ai.key.' + p, '');
  const modelFor = (p) => ls.get('ai.model.' + p, DEFAULT_MODEL[p]);
  const auto = () => ls.get('ai.auto', true);
  class AiError extends Error {}
  const CUT = '\n\n_(The answer was cut off at the length limit. Tap Regenerate for a complete one.)_';

  function aiOrder(docChars, imageOnly) {
    const order = [];
    const chosen = provider();
    if (!imageOnly || chosen !== 'claude') order.push(chosen);
    if (auto()) {
      for (const p of ['groq', 'gemini']) if (!order.includes(p) && keyFor(p)) order.push(p);
      if (docChars > 60000 && order.includes('gemini') && keyFor('gemini')) { order.splice(order.indexOf('gemini'), 1); order.unshift('gemini'); }
    }
    return order;
  }

  function recordUsage(model, r) {
    const all = ls.get('ai.usage', {});
    const month = new Date().toISOString().slice(0, 7);
    const m = all[month] = all[month] || {};
    const row = m[model] || [0, 0, 0, 0];
    m[model] = [row[0] + (r.inTok || 0), row[1] + (r.outTok || 0), row[2] + (r.cached || 0), row[3] + 1];
    ls.set('ai.usage', all);
  }

  // An AI that doesn't answer in time is given up on and the other AI is tried: 45 s to start a
  // streamed reply, 150 s for a whole one (long structured answers take a minute or two).
  async function post(url, headers, body, name) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), body.stream || /stream/i.test(url) ? 45000 : 150000);
    let res;
    try {
      res = await realFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      throw new AiError(ctl.signal.aborted ? `${name} didn't answer in time.` : `Couldn't reach ${name} (${(e && e.message) || e}). Check your connection.`);
    } finally {
      clearTimeout(t);
    }
    return res;
  }
  async function errText(res) { try { const o = await res.json(); return (o.error && (o.error.message || o.error)) || ''; } catch { return ''; } }

  /** Reads a Server-Sent Events stream, calling onData with each "data:" payload. */
  async function readSse(res, onData) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) { if (onData(line.slice(5).trim()) === false) return; }
      }
    }
  }
  const throttle = (f) => { let last = 0; return (t, force) => { const n = Date.now(); if (force || n - last > 250) { last = n; f(t); } }; };
  const userText = (doc, task) => (doc ? '<document>\n' + doc + '\n</document>\n\n' + task : task);

  // ---- Groq (OpenAI-compatible)
  const GROQ = 'https://api.groq.com/openai/v1/';
  async function groqError(res) {
    const msg = String(await errText(res));
    const lim = /Limit (\d+), Requested (\d+)/.exec(msg);
    const c = res.status;
    if ((c === 413 || c === 429) && lim && /per minute/i.test(msg)) return new AiError('TOO_LARGE:' + lim[1] + ':' + lim[2]);
    if (c === 401) return new AiError('Your Groq API key was rejected. Check it in Settings → AI.');
    if (c === 404) return new AiError("This Groq model isn't available to your key. Pick another model in Settings → AI.");
    if (c === 429) return new AiError(/per day/i.test(msg) ? "Groq's daily free limit is used up. It resets within a day, or add billing on console.groq.com." : "Groq's rate limit was reached. Wait a minute and try again.");
    if (c === 400 && msg.includes('json')) return new AiError("Groq couldn't produce the answer in the expected format. Try again.");
    return new AiError(`Groq returned an error (${c})` + (msg ? ': ' + msg : '.'));
  }
  async function groq({ system, doc, task, max, schema, onText, image }) {
    const key = keyFor('groq');
    const model = image ? 'meta-llama/llama-4-scout-17b-16e-instruct' : modelFor('groq');
    const strict = model.startsWith('openai/gpt-oss') || model.startsWith('qwen/');
    const messages = [{ role: 'system', content: system }];
    if (image) messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: task }] });
    else messages.push({ role: 'user', content: userText(doc, task) });
    const body = { model, messages, max_completion_tokens: image ? Math.min(max, 4000) : max };
    if (model.startsWith('openai/gpt-oss')) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    if (schema) {
      if (strict) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: JSON.parse(schema) } };
      else { body.response_format = { type: 'json_object' }; messages[0].content = system + '\nReply with JSON only, matching this JSON Schema: ' + schema; }
    }
    const headers = { Authorization: 'Bearer ' + key };
    if (onText && !schema) {
      try {
        const res = await post(GROQ + 'chat/completions', headers, { ...body, stream: true, stream_options: { include_usage: true } }, 'Groq');
        if (res.ok) {
          let out = '', finish = '', served = model, usage = null;
          const push = throttle(onText);
          await readSse(res, (d) => {
            if (d === '[DONE]') return false;
            const o = JSON.parse(d);
            served = o.model || served;
            const ch = o.choices && o.choices[0];
            if (ch && ch.delta && ch.delta.content) out += ch.delta.content;
            if (ch && ch.finish_reason) finish = ch.finish_reason;
            usage = o.usage || (o.x_groq && o.x_groq.usage) || usage;
            if (out) push(out);
            return true;
          });
          let text = out.trim();
          if (text) {
            if (finish === 'length') text += CUT;
            onText(text);
            const cached = (usage && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
            return { text, model: served, inTok: Math.max(0, ((usage && usage.prompt_tokens) || 0) - cached), outTok: (usage && usage.completion_tokens) || 0, cached };
          }
        }
      } catch (e) { if (e instanceof AiError && /TOO_LARGE|rejected/.test(e.message)) throw e; }
    }
    const res = await post(GROQ + 'chat/completions', headers, body, 'Groq');
    if (!res.ok) throw await groqError(res);
    const o = await res.json();
    const ch = o.choices[0];
    const text = ((ch.message && ch.message.content) || '').trim();
    if (!text) throw new AiError(ch.finish_reason === 'length' ? 'The answer was cut off. Try again, or use a shorter request.' : 'Groq returned an empty answer. Try again.');
    const u = o.usage || {};
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    if (onText) onText(text);
    return { text, model: o.model || model, inTok: Math.max(0, (u.prompt_tokens || 0) - cached), outTok: u.completion_tokens || 0, cached };
  }
  async function groqModels() {
    const res = await realFetch(GROQ + 'models', { headers: { Authorization: 'Bearer ' + keyFor('groq') } });
    if (!res.ok) throw new Error("Couldn't list Groq models.");
    const o = await res.json();
    return (o.data || []).filter((m) => !/whisper|guard|orpheus|tts/.test(m.id) && m.active !== false).map((m) => ({ id: m.id, context: m.context_window || 0 }));
  }

  // ---- Gemini
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const gem = { model: ls.get('ai.geminiWorking', null), sendSchema: true, headroom: 16384, light: true, noQuota: new Set() };
  /** Another free Gemini model this key can use (Flash first, newest first, then Flash-Lite), or null. */
  async function nextFreeGemini(current) {
    try {
      const res = await realFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': keyFor('gemini') } });
      if (!res.ok) return null;
      const names = ((await res.json()).models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((n) => n.startsWith('gemini') && n.includes('flash') && !/image|tts|audio|live|embed|vision/.test(n) && !gem.noQuota.has(n) && n !== current);
      const rank = (n) => (n.includes('lite') ? 2 : 0) + (/preview|exp/.test(n) ? 1 : 0);
      names.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
      return names[0] || null;
    } catch { return null; }
  }
  async function gemini({ system, doc, task, max, schema, onText, image }) {
    const key = keyFor('gemini');
    let model = gem.model && gem.model.startsWith('gemini') ? gem.model : modelFor('gemini');
    if (!model.startsWith('gemini')) model = DEFAULT_MODEL.gemini;
    const build = (streaming) => {
      let sys = system || '';
      if (schema && !streaming) sys += '\nReply with JSON only, matching this JSON Schema: ' + schema;
      const parts = [];
      if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image.slice(image.indexOf(',') + 1) } });
      parts.push({ text: userText(doc, task) });
      const gen = { maxOutputTokens: Math.min(65536, Math.max(1024, max) + gem.headroom), temperature: 0.3 };
      if (gem.light) gen.thinkingConfig = model.startsWith('gemini-2') ? { thinkingBudget: 1024 } : { thinkingLevel: 'low' };
      if (schema && !streaming) { gen.responseMimeType = 'application/json'; if (gem.sendSchema) gen.responseJsonSchema = JSON.parse(schema); }
      const body = { contents: [{ role: 'user', parts }], generationConfig: gen };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      return body;
    };
    const textOf = (o) => { const c = o.candidates && o.candidates[0]; return { t: ((c && c.content && c.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join(''), finish: (c && c.finishReason) || '' }; };
    const usageOf = (u) => ({ inTok: Math.max(0, ((u && u.promptTokenCount) || 0) - ((u && u.cachedContentTokenCount) || 0)), outTok: (u && u.candidatesTokenCount) || 0, cached: (u && u.cachedContentTokenCount) || 0 });

    if (onText && !schema) {
      try {
        const res = await post(GEMINI + model + ':streamGenerateContent?alt=sse', { 'x-goog-api-key': key }, build(true), 'Gemini');
        if (res.ok) {
          let out = '', finish = '', usage = null;
          const push = throttle(onText);
          await readSse(res, (d) => { const o = JSON.parse(d); const r = textOf(o); out += r.t; if (r.finish) finish = r.finish; usage = o.usageMetadata || usage; if (out) push(out); return true; });
          let text = out.trim();
          if (text) {
            if (finish === 'MAX_TOKENS') text += CUT;
            onText(text);
            if (model !== DEFAULT_MODEL.gemini) ls.set('ai.geminiWorking', model);
            return { text, model, ...usageOf(usage) };
          }
        }
      } catch { /* fall back to the normal request below */ }
    }
    for (let attempt = 0; ; attempt++) {
      const res = await post(GEMINI + model + ':generateContent', { 'x-goog-api-key': key }, build(false), 'Gemini');
      const c = res.status;
      if (c === 429 || c === 503) {
        const why = c === 429 ? String(await errText(res)) : '';
        // Free allowances are per model: "limit: 0" (none for this model) or a used-up day → another free model.
        if (c === 429 && /limit:\s*0\b|per ?day|daily/i.test(why) && gem.noQuota.size < 4) {
          gem.noQuota.add(model);
          const next = await nextFreeGemini(model);
          if (next) { model = next; gem.model = next; attempt = -1; continue; }
        }
        const daily = /per ?day|daily/i.test(why), noFree = /limit:\s*0\b/i.test(why);
        if (attempt < 3 && !daily && !noFree) { await sleep(6000 * (attempt + 1)); continue; }
        const g = why ? ` (Google: ${why.slice(0, 160)})` : '';
        throw new AiError(c === 429
          ? (noFree ? `Your Gemini key has no free allowance for ${model} (or any other free Gemini model it could find).` : daily ? `Gemini's free daily limit for ${model} is used up. It resets tomorrow.` : "Gemini's free limit was reached. Wait a minute and try again.") + g
          : 'Gemini is busy right now. Try again in a minute.');
      }
      if (c >= 400) {
        const msg = String(await errText(res));
        const lm = msg.toLowerCase();
        if (c === 400 && gem.light && lm.includes('thinking')) { gem.light = false; attempt--; continue; }
        if (c === 400 && gem.sendSchema && schema && /schema|unknown name|invalid json payload/.test(lm)) { gem.sendSchema = false; attempt--; continue; }
        if (c === 404 && attempt < 4) {
          const m = /use models\/(gemini-[\w.-]+)/.exec(msg);
          const next = m ? m[1] : model === DEFAULT_MODEL.gemini ? null : DEFAULT_MODEL.gemini;
          if (next && next !== model) { model = next; gem.model = next; attempt = 3; continue; }
        }
        if (c === 400 && lm.includes('api key')) throw new AiError('Your Gemini API key was rejected. Check it in Settings → AI.');
        if (c === 403) throw new AiError("Your Gemini API key isn't allowed to use this model. Check it in Settings → AI.");
        throw new AiError(`Gemini returned an error (${c})` + (msg ? ': ' + msg : '.'));
      }
      const o = await res.json();
      const r = textOf(o);
      if (r.finish === 'MAX_TOKENS' && gem.headroom < 48000) { gem.headroom = 48000; attempt--; continue; }
      let text = r.t.trim();
      if (r.finish === 'MAX_TOKENS') text += CUT;
      if (!text) throw new AiError('Gemini returned an empty answer. Try again.');
      if (onText) onText(text);
      if (model !== DEFAULT_MODEL.gemini) ls.set('ai.geminiWorking', model);
      return { text, model, ...usageOf(o.usageMetadata) };
    }
  }

  // ---- Claude (Anthropic API, direct from the browser)
  const takesFallback = (m) => ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'].includes(m);
  async function claude({ system, doc, task, max, schema, onText }) {
    const model = modelFor('claude');
    const content = [];
    if (doc) content.push({ type: 'text', text: doc, cache_control: { type: 'ephemeral' } });
    content.push({ type: 'text', text: task });
    const body = { model, max_tokens: max, system: system || '', messages: [{ role: 'user', content }] };
    const oc = {};
    if (!model.startsWith('claude-haiku')) oc.effort = 'medium';
    if (schema) oc.format = { type: 'json_schema', schema: JSON.parse(schema) };
    if (Object.keys(oc).length) body.output_config = oc;
    if (takesFallback(model)) body.fallbacks = 'default';
    const headers = { 'x-api-key': keyFor('claude'), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (takesFallback(model)) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const fail = async (res) => {
      const m = String(await errText(res)); const lm = m.toLowerCase(); const c = res.status;
      if (c === 401) return new AiError('Your Claude API key was rejected. Check it in Settings → AI.');
      if (c === 403) return new AiError(`This API key can't use ${model}. Pick another model in Settings → AI.`);
      if (c === 404) return new AiError(`Model ${model} isn't available to this key. Pick another model in Settings → AI.`);
      if (c === 429 || c === 529) return new AiError('Claude is busy or your usage limit was reached. Try again in a minute.');
      if (c === 400) {
        if (lm.includes('credit')) return new AiError('Your Anthropic account is out of credit.');
        if (lm.includes('too long') || lm.includes('context')) return new AiError('This document is too long for one request.');
        return new AiError("Claude couldn't process this request" + (m ? ': ' + m : ' (400).'));
      }
      return new AiError(`Claude returned an error (${c}). Try again.`);
    };
    if (onText && !schema) {
      const res = await post('https://api.anthropic.com/v1/messages', headers, { ...body, stream: true }, 'Claude');
      if (!res.ok) throw await fail(res);
      let out = '', stop = '', served = model, inTok = 0, outTok = 0, cached = 0;
      const push = throttle(onText);
      await readSse(res, (d) => {
        const o = JSON.parse(d);
        if (o.type === 'message_start' && o.message) { served = o.message.model || served; const u = o.message.usage || {}; cached = u.cache_read_input_tokens || 0; inTok = (u.input_tokens || 0) + cached + (u.cache_creation_input_tokens || 0); }
        if (o.type === 'content_block_delta' && o.delta && o.delta.type === 'text_delta') { out += o.delta.text; push(out); }
        if (o.type === 'message_delta') { stop = (o.delta && o.delta.stop_reason) || stop; outTok = (o.usage && o.usage.output_tokens) || outTok; }
        if (o.type === 'error') throw new AiError((o.error && o.error.message) || 'Claude stopped with an error. Try again.');
        return true;
      });
      if (stop === 'refusal') throw new AiError('Claude declined this request.');
      let text = out.trim();
      if (!text) throw new AiError('Claude returned an empty answer. Try again.');
      if (stop === 'max_tokens') text += CUT;
      onText(text);
      return { text, model: served, inTok, outTok, cached };
    }
    const res = await post('https://api.anthropic.com/v1/messages', headers, body, 'Claude');
    if (!res.ok) throw await fail(res);
    const msg = await res.json();
    if (msg.stop_reason === 'refusal') throw new AiError('Claude declined this request.');
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw new AiError(msg.stop_reason === 'max_tokens' ? 'The answer was cut off. Try again, or use a shorter request.' : 'Claude returned an empty answer. Try again.');
    const u = msg.usage || {};
    if (onText) onText(text);
    return { text, model: msg.model || model, inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), outTok: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 };
  }

  const RUN = { groq, gemini, claude };
  /** Runs one request on the chosen AI, falling back to the other free AI like the Android app. */
  async function aiRun(id, req, { imageOnly = false } = {}) {
    let first = null;
    const others = [];
    try {
      for (const p of aiOrder((req.doc || '').length, imageOnly)) {
        if (req.image && p === 'claude') continue;
        try {
          if (!keyFor(p)) throw new AiError(`Add your ${LABEL[p]} API key in Settings → AI.`);
          const r = await RUN[p](req);
          recordUsage(r.model, r);
          emit({ type: 'ai', id, state: 'done', text: r.text, model: r.model, fallback: first ? LABEL[p] : '' });
          return;
        } catch (e) {
          const err = e instanceof AiError ? e : new AiError(`${LABEL[p]} request failed: ${e && e.message ? e.message : e}`);
          if (!first) first = err; else others.push(`${LABEL[p]}: ${err.message}`);
        }
      }
      // Why the fallback AIs failed too (a Gemini problem behind a Groq limit); TOO_LARGE stays as is.
      if (first && others.length && !/^TOO_LARGE:/.test(first.message)) first = new AiError(first.message + ' · ' + others.join(' · '));
      throw first || new AiError(imageOnly ? 'Image questions work with Gemini or Groq. Add a key in Settings → AI.' : `Add your ${LABEL[provider()]} API key in Settings → AI.`);
    } catch (e) {
      emit({ type: 'ai', id, state: 'error', message: e.message || 'AI request failed' });
    }
  }

  /** Text recognition with the AI's vision (the Android app uses on-phone OCR). */
  async function recognise(id, dataUrl) {
    const order = aiOrder(0, true).filter((p) => p !== 'claude' && keyFor(p));
    if (!order.length) { emit({ type: 'ocr', id, error: 'Text recognition on iPhone uses your free Gemini or Groq key. Add one in Settings → AI.' }); return; }
    let err = null;
    for (const p of order) {
      try {
        const r = await RUN[p]({ system: 'You transcribe printed pages exactly.', task: 'Transcribe all the text on this page exactly as printed, in reading order. Keep each heading and paragraph as its own block, separated by one blank line. Output only the text.', max: 6000, image: dataUrl });
        recordUsage(r.model, r);
        const blocks = r.text.split(/\n\s*\n/).map((b) => ({ lines: b.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ t })) })).filter((b) => b.lines.length);
        emit({ type: 'ocr', id, result: { w: 1000, h: 1000, blocks } });
        return;
      } catch (e) { err = err || e; }
    }
    emit({ type: 'ocr', id, error: (err && err.message) || 'Text recognition failed' });
  }

  // ================================================================ read aloud (the phone's voices)
  const synth = window.speechSynthesis;
  const tts = { items: [], i: 0, playing: false, rate: 1, voice: '', title: '', token: 0, stopAfter: -1, sleepAt: 0 };
  const voices = () => (synth ? synth.getVoices() : []);
  const findVoice = (name) => (name && !String(name).startsWith('neural:') ? voices().find((v) => v.name === name || v.voiceURI === name) : null);
  const ttsEvt = (state) => emit({ type: 'tts', state, index: tts.i, total: tts.items.length });
  function speakCurrent() {
    if (!synth) { ttsEvt('error'); return; }
    const token = ++tts.token;
    synth.cancel();
    const it = tts.items[tts.i];
    if (!it) { tts.playing = false; ttsEvt('ended'); return; }
    const u = new SpeechSynthesisUtterance(it.t || ' ');
    const v = findVoice(it.voice) || findVoice(tts.voice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = Math.max(0.5, Math.min(2, tts.rate || 1));
    if (it.pitch > 0) u.pitch = Math.max(0.5, Math.min(2, it.pitch));
    u.onend = () => {
      if (token !== tts.token || !tts.playing) return;
      if (tts.sleepAt && Date.now() >= tts.sleepAt) { tts.sleepAt = 0; tts.playing = false; ttsEvt('sleep'); return; }
      if (tts.stopAfter >= 0 && tts.i >= tts.stopAfter) { tts.stopAfter = -1; tts.playing = false; ttsEvt('sleep'); return; }
      if (tts.i + 1 >= tts.items.length) { tts.playing = false; ttsEvt('ended'); return; }
      tts.i++;
      speakCurrent();
    };
    u.onerror = (e) => { if (token === tts.token && e.error !== 'interrupted' && e.error !== 'canceled') { tts.playing = false; ttsEvt('paused'); } };
    tts.playing = true;
    synth.speak(u);
    ttsEvt('playing');
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: tts.title || 'DermScholar', artist: 'DermScholar' });
        navigator.mediaSession.setActionHandler('play', () => N.ttsToggle());
        navigator.mediaSession.setActionHandler('pause', () => N.ttsToggle());
        navigator.mediaSession.setActionHandler('nexttrack', () => N.ttsSkip(1));
        navigator.mediaSession.setActionHandler('previoustrack', () => N.ttsSkip(-1));
      } catch { /* not supported */ }
    }
  }
  // iOS speaks only after a first tap: unlock speech on the first touch.
  const unlock = () => { try { if (synth && !tts.playing) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } } catch { /* ignore */ } document.removeEventListener('touchend', unlock, true); document.removeEventListener('click', unlock, true); };
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('click', unlock, true);
  if (synth) synth.onvoiceschanged = () => emit({ type: 'tts', state: 'voices' });

  // ================================================================ the bridge
  const N = {
    isWeb: !IOS,
    isIos: !!IOS,
    version: () => (IOS ? '5.11 iOS' : '5.11 web'),

    // ---- PDFs
    listPdfs: () => JSON.stringify(Object.entries(pdfIndex()).map(([key, o]) => ({ ...o, key }))),
    hasPdf: (k) => !!pdfIndex()[k],
    storageBytes: () => Object.values(pdfIndex()).reduce((n, o) => n + (o.size || 0), 0),
    deletePdf: (k) => { const idx = pdfIndex(); delete idx[k]; ls.set('pdfs', idx); delFile('pdf', k); },
    renamePdf: (from, to, title) => {
      const idx = pdfIndex();
      if (!idx[from] || idx[to]) return false;
      idx[to] = { ...idx[from], title: title || idx[from].title };
      delete idx[from];
      ls.set('pdfs', idx);
      // The index moves now; the file follows a moment later (reads wait for it, see pdfBytes).
      moving[to] = (async () => { const r = await getFile('pdf', from); if (r) { await putFile('pdf', to, await r.blob(), 'application/pdf'); await delFile('pdf', from); } delete moving[to]; })();
      return true;
    },
    /** The PDF reader asks for a file's bytes (the Android app serves /pdf/<key> instead). */
    pdfBytes: async (url) => {
      const key = keyOf(url);
      if (moving[key]) await moving[key];
      const r = await getFile('pdf', key);
      if (!r) throw new Error('This PDF isn\'t on this phone any more. Add it again.');
      return new Uint8Array(await r.arrayBuffer());
    },
    importPdf: () => pickFiles('application/pdf,.pdf', (fs) => fs.forEach(receiveFile), { label: 'Choose a PDF' }),
    setPendingPdf: (key, title) => ls.set('pending', { key, title: title || '', t: Date.now() }),
    pickDocument: (imagesOnly) => pickFiles(imagesOnly ? 'image/*' : 'application/pdf,.pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm,image/*', (fs) => fs.forEach(receiveFile), { label: 'Choose a file' }),
    takePhoto: () => pickFiles('image/*', (fs) => fs.forEach(receiveFile), { capture: true, label: 'Take a photo' }),
    pickImage: (id) => pickFiles('image/*', async (fs) => {
      try { emit({ type: 'imagePicked', id, dataUrl: await imageDataUrl(fs[0]) }); } catch (e) { emit({ type: 'imagePicked', id, error: e.message }); }
    }, { label: 'Choose a photo' }),
    deleteImport: (k) => delFile('doc', k),
    consumeReceived: () => '[]',
    ocrImport: async (id, key) => {
      const r = await getFile('doc', key);
      if (!r) { emit({ type: 'ocr', id, error: 'The photo is gone. Take it again.' }); return; }
      try { await recognise(id, await imageDataUrl(await r.blob(), 2000)); } catch (e) { emit({ type: 'ocr', id, error: e.message }); }
    },
    ocrPage: (id, dataUrl) => recognise(id, dataUrl),
    fetchPage: async (id, url) => {
      const key = 'web_' + Date.now();
      try {
        const res = await nfetch(url);
        if (!res.ok) throw new Error('The site answered ' + res.status);
        const buf = await res.arrayBuffer();
        const type = res.headers.get('content-type') || '';
        if (/pdf/i.test(type) || isPdf(buf)) {
          await savePdf(key, new Blob([buf], { type: 'application/pdf' }), url.replace(/.*\//, '').replace(/\.pdf.*$/i, ''), url);
          emit({ type: 'pageFetched', id, key, pdf: true });
        } else {
          await putFile('doc', key, new Blob([buf], { type }), type);
          emit({ type: 'pageFetched', id, key, url: (!IOS && res.url) || url, type });
        }
      } catch {
        // Most sites don't let other websites read their pages: open it instead.
        openTab(url, 'Open page');
        emit({ type: 'pageFetched', id, error: 'This site doesn\'t allow reading it from the web app. It opened in a new tab: use Share → Print → save as PDF, then add the PDF here.' });
      }
    },

    /** One-tap PDF: a free copy if the site allows it; otherwise the page opens for a manual download. */
    getPdf: async (key, doi, title, freeUrl, pii) => {
      if (freeUrl) {
        try {
          const res = await nfetch(freeUrl);
          const buf = res.ok ? await res.arrayBuffer() : null;
          if (buf && isPdf(buf)) {
            await savePdf(key, new Blob([buf], { type: 'application/pdf' }), title, freeUrl);
            emit({ type: 'pdfSaved', key });
            return;
          }
        } catch { /* the site doesn't allow it */ }
      }
      if (!freeUrl && !doi) { emit({ type: 'pdfFailed', key, message: "This paper has no DOI, so it can't be fetched automatically." }); return; }
      N.setPendingPdf(key, title);
      ls.set('fetch.' + key, { doi, free: freeUrl || '', pii: pii || '' });
      if (IOS) {
        // The app's browser signs in to Research4Life by itself and files the PDF when it opens.
        N.showFetchPage(key, doi);
        emit({ type: 'fetchStatus', key, message: 'Opened in the browser: open the PDF there (or tap Save PDF) and it saves under this paper.' });
        return;
      }
      emit({ type: 'pdfFailed', key, canShow: true, message: 'Tap Show page, download the PDF there (Research4Life, MyLOFT or the journal), then come back and tap Add PDF: it files itself under this paper.' });
    },
    downloadPdf: (key, url, title) => N.getPdf(key, '', title, url),
    showFetchPage: (key, doi) => {
      const f = ls.get('fetch.' + key, {});
      N.setPendingPdf(key, (window.DS && window.DS.saved.get(key) && window.DS.saved.get(key).title) || '');
      const d = doi || f.doi;
      // With a Research4Life account, go through its proxy (sign in once in Safari); else the publisher.
      const r4l = (() => { try { return !!localStorage.getItem('ds.acc.r4l'); } catch { return false; } })();
      // Elsevier (JAAD…): Research4Life gives the PDF through ClinicalKey, not ScienceDirect.
      const viaR4L = f.pii ? 'https://www.clinicalkey.com/#!/content/journal/1-s2.0-' + f.pii
        : d ? (r4l ? 'https://login.research4life.org/tacsgr1doi_org/' : 'https://doi.org/') + d : '';
      openTab(f.free || viaR4L, 'Open the paper', key);
    },
    cancelFetch: () => {},
    openPdf: (key) => N.openPdfPages(key),
    openPdfPages: async (key) => {
      if (IOS) { N.sharePdf(key, (pdfIndex()[key] || {}).title || 'paper'); return; }
      const r = await getFile('pdf', key);
      if (!r) { toast('This PDF isn\'t on this phone'); return; }
      const url = URL.createObjectURL(await r.blob());
      openTab(url, 'Open PDF');
    },
    sharePdf: async (key, title) => {
      const r = await getFile('pdf', key);
      if (!r) return;
      const name = (title || 'paper').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.pdf';
      if (IOS) { ios('share', { title: title || '', fileName: name, b64: await b64(await r.blob()), mime: 'application/pdf' }); return; }
      const file = new File([await r.blob()], name, { type: 'application/pdf' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title });
        else N.openPdfPages(key);
      } catch { /* cancelled */ }
    },

    // ---- links, sharing
    openPortal: (url) => openTab(url),
    openBrowser: (url) => {
      // Google sign-in returns to this page (the Android app uses its dermscholar:// link).
      if (!IOS && /\/auth\/v1\/authorize/.test(url)) { location.assign(url.replace(/redirect_to=[^&]*/, 'redirect_to=' + encodeURIComponent(location.origin + location.pathname))); return; }
      openTab(url);
    },
    openUpToDateAt: (u) => openTab(u, 'Open UpToDate'),
    openUpToDate: (q) => openTab('https://www.uptodate.com/contents/search' + (q ? '?search=' + encodeURIComponent(q) : ''), 'Open UpToDate'),
    utdSearch: (q) => {
      openTab('https://www.uptodate.com/contents/search' + (q ? '?search=' + encodeURIComponent(q) : ''), 'Open UpToDate');
      emit({ type: 'utdResults', state: 'error', message: 'UpToDate opened in a new tab (sign in there with your UpToDate account).' });
    },
    utdTopic: (u) => {
      openTab(u, 'Open UpToDate');
      emit({ type: 'utdTopic', state: 'error', message: 'The topic opened in a new tab (sign in there with your UpToDate account).' });
    },
    utdShowPage: () => openTab('https://www.uptodate.com/login', 'Open UpToDate'),
    // MyLOFT: the paper's link is copied and MyLOFT opens (app or website), to paste it there.
    hasMyLoftApp: () => true,
    openMyLoftApp: () => openTab('https://app.myloft.xyz/', 'Open MyLOFT'),
    sendToMyLoft: (text) => {
      N.copy(text);
      openTab(/^https?:/.test(text) ? text : 'https://app.myloft.xyz/', 'Open in MyLOFT', (ls.get('pending', null) || {}).key || '');
    },
    share: (t, text) => (IOS ? ios('share', { title: t || '', text: text || '' }) : navigator.share ? navigator.share({ title: t, text }).catch(() => {}) : N.copy(text)),
    copy: (t) => { try { if (IOS) ios('copy', { text: t }); else navigator.clipboard.writeText(t); } catch { /* not allowed */ } toast('Copied'); },
    /** A generated file (Word, PowerPoint) as base64: the share sheet, or a download. */
    exportFile: async (name, base64, mime) => {
      if (IOS) { ios('share', { fileName: name, b64: base64, mime }); return; }
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: mime });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch { return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = name; a.click();
    },
    exportText: async (name, content, mime) => {
      if (IOS) { ios('share', { fileName: name, b64: await b64(new Blob([content])), mime: mime || 'text/plain' }); return; }
      const file = new File([content], name, { type: mime || 'text/plain' });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch { return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = name; a.click();
    },
    updateCheck: () => emit({ type: 'update', state: 'none' }),

    // ---- AI
    aiProvider: provider,
    aiSetProvider: (p) => ls.set('ai.provider', known(p)),
    aiHasKey: () => !!keyFor(provider()) || (auto() && !!(keyFor('groq') || keyFor('gemini'))),
    aiHasKeyFor: (p) => !!keyFor(known(p)),
    /** Settings → AI → Test: a one-word request to each AI with a key, with the exact error and time. */
    aiTest: async () => {
      const lines = [];
      for (const p of ['groq', 'gemini', 'claude']) {
        if (!keyFor(p)) { if (p !== 'claude') lines.push(`${LABEL[p]}: no key saved on this device`); continue; }
        const t0 = Date.now();
        try {
          const r = await RUN[p]({ system: 'Reply with one word.', task: 'Say OK.', max: 16 });
          lines.push(`${LABEL[p]}: works (${((Date.now() - t0) / 1000).toFixed(1)} s, ${r.model}) → "${String(r.text).slice(0, 40)}"`);
        } catch (e) {
          lines.push(`${LABEL[p]}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s → ${(e && e.message) || e}`);
        }
      }
      lines.push(`Selected: ${LABEL[provider()]} · together: ${auto() ? 'on' : 'off'} · ${IOS ? 'iPhone/iPad app' : 'web app'} ${(window.DSNative && window.DSNative.build) || ''}`);
      return lines.join('\n');
    },
    aiSetKey: (key, selected) => {
      const k = String(key || '').replace(/[\s​-‍⁠﻿"']/g, '');
      if (!k) { ls.del('ai.key.' + provider()); return; }
      const p = k.startsWith('sk-ant-') ? 'claude' : k.startsWith('gsk_') ? 'groq' : k.startsWith('AIza') ? 'gemini' : known(selected || provider());
      ls.set('ai.key.' + p, k);
      ls.set('ai.provider', p);
    },
    aiModel: () => modelFor(provider()),
    aiSetModel: (m) => { ls.set('ai.model.' + provider(), m); if (provider() === 'gemini') gem.model = null; },
    aiListModels: async () => { try { emit({ type: 'aiModels', models: await groqModels() }); } catch (e) { emit({ type: 'aiModels', error: e.message }); } },
    aiUsage: () => JSON.stringify(ls.get('ai.usage', {})),
    aiAuto: auto,
    aiSetAuto: (on) => ls.set('ai.auto', !!on),
    aiRun: (id, system, doc, task, max, schema) => aiRun(id, { system, doc, task, max, schema: schema || null }),
    aiRunStream: (id, system, doc, task, max) => aiRun(id, { system, doc, task, max, onText: (t) => emit({ type: 'aiPartial', id, text: t }) }),
    aiRunImage: (id, system, task, dataUrl, max) => aiRun(id, { system, task, max, image: dataUrl }, { imageOnly: true }),

    // ---- read aloud
    ttsStart: (title, itemsJson, start, rate, voice) => {
      let items = [];
      try { items = JSON.parse(itemsJson); } catch { /* none */ }
      tts.items = items.map((x) => (typeof x === 'string' ? { t: x } : x));
      tts.i = Math.max(0, Math.min(start || 0, tts.items.length - 1));
      tts.rate = rate || 1; tts.voice = voice || ''; tts.title = title || '';
      speakCurrent();
    },
    ttsToggle: () => { if (tts.playing) { tts.playing = false; tts.token++; synth && synth.cancel(); ttsEvt('paused'); } else speakCurrent(); },
    ttsPause: () => { tts.playing = false; tts.token++; synth && synth.cancel(); ttsEvt('paused'); },
    ttsSeek: (i) => { tts.i = Math.max(0, Math.min(i, tts.items.length - 1)); speakCurrent(); },
    ttsSkip: (d) => { tts.i = Math.max(0, Math.min(tts.items.length - 1, tts.i + d)); speakCurrent(); },
    ttsRate: (r) => { tts.rate = r; if (tts.playing) speakCurrent(); },
    ttsVoice: (v) => { tts.voice = v; if (tts.playing) speakCurrent(); },
    ttsStop: () => { tts.playing = false; tts.token++; synth && synth.cancel(); ttsEvt('stopped'); },
    ttsStatus: () => JSON.stringify({ playing: tts.playing, index: tts.i, total: tts.items.length }),
    ttsVoices: () => JSON.stringify({ ready: true, engines: [], neural: [],
      voices: voices().map((v) => ({ name: v.name, locale: v.lang, quality: v.localService ? 400 : 300, network: !v.localService })) }),
    ttsPreview: (v) => { if (!synth) return; synth.cancel(); const u = new SpeechSynthesisUtterance('This is how DermScholar sounds with this voice.'); const vv = findVoice(v); if (vv) u.voice = vv; synth.speak(u); },
    ttsEngine: () => {}, ttsWarm: () => {}, ttsSubtitle: () => {},
    ttsSleep: (min) => { tts.sleepAt = min > 0 ? Date.now() + min * 60000 : 0; },
    ttsStopAfter: (i) => { tts.stopAfter = i; },
    ttsSleepLeft: () => (tts.sleepAt ? Math.max(0, tts.sleepAt - Date.now()) : 0),
    voiceCatalog: () => '[]',
    listen: () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { emit({ type: 'speech', error: 'Voice input isn\'t available in this browser. Use the microphone on the keyboard instead.' }); return; }
      const r = new SR();
      r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
      let got = false;
      r.onresult = (e) => { got = true; emit({ type: 'speech', text: e.results[0][0].transcript }); };
      r.onerror = (e) => { if (!got) { got = true; emit({ type: 'speech', error: e.error === 'not-allowed' ? 'Allow the microphone for this site in Settings → Safari.' : '' }); } };
      r.onend = () => { if (!got) emit({ type: 'speech', error: '' }); };
      toast('Listening…');
      r.start();
    },
  };
  const moving = {};
  function b64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }
  /** Files from the iPhone app: PDFs saved in its browser, and files opened with DermScholar. */
  N.fromNative = async (evt) => {
    if (evt.type === 'nativeFile') {
      try {
        const res = await realFetch('/native/' + encodeURIComponent(evt.id));
        const blob = await res.blob();
        if (evt.key) N.setPendingPdf(evt.key, evt.title || '');
        await receiveFile(new File([blob], evt.name || 'Document', { type: evt.mime || blob.type }));
      } catch (e) { toast("Couldn't add that file: " + (e.message || e)); }
      ios('done', { id: evt.id });
      return;
    }
    if (evt.type === 'notice') { toast(evt.message); return; }
    if (evt.type === 'browserClosed') {
      // Closed without the PDF: drop the "getting the PDF" row (a saved PDF arrives just before).
      if (evt.key) setTimeout(() => { if (!pdfIndex()[evt.key]) emit({ type: 'fetchDone', key: evt.key }); }, 2500);
      return;
    }
    if (evt.type === 'credentialsSaved') {
      // Typed on a sign-in page in the app's browser: the password stays in the iPhone's Keychain.
      try { localStorage.setItem('ds.acc.' + evt.p, evt.user); } catch { /* blocked */ }
      toast((evt.p === 'utd' ? 'UpToDate' : 'Research4Life') + ' sign-in saved');
      return;
    }
    emit(evt);
  };
  if (IOS) {
    // New iPhone app versions come through AltStore (its Updates tab installs them over Wi-Fi);
    // the screens update on their own (ScreenUpdates.swift), so the notice only appears when the
    // app itself needs reinstalling (a newer native level), plus once to add the AltStore source.
    const SOURCE = 'https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/dermscholar-ios-latest/altstore.json';
    const me = window.DSNative || { version: '', build: '0', level: 1 };
    const bar = (html, acts) => {
      document.getElementById('ios-upd')?.remove();
      const el = document.createElement('div');
      el.id = 'ios-upd';
      el.className = 'upd-bar';
      el.innerHTML = html;
      document.body.appendChild(el);
      el.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => { el.remove(); acts[b.dataset.k](); }));
    };
    const btns = (a, b) => `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn xs" data-k="later">${b}</button><button class="btn xs primary" data-k="go">${a}</button></div>`;
    const openAltStore = (path = '') => ios('openApp', { url: 'altstore://' + path, store: 'https://altstore.io' });
    setTimeout(async () => {
      try {
        const j = await (await nfetch(SOURCE + '?t=' + Date.now())).json();
        const v = (j.apps && j.apps[0] && j.apps[0].versions && j.apps[0].versions[0]) || {};
        if ((j.dsNativeLevel || 0) > (me.level || 1) && ls.get('upd.later', '') !== String(v.buildVersion)) {
          bar(`<b>New iPhone app version ${v.version || ''}</b><div class="small">Open AltStore → Updates to install it. Your library stays.</div>${btns('Open AltStore', 'Later')}`,
            { go: () => openAltStore(), later: () => ls.set('upd.later', String(v.buildVersion)) });
        } else if (!ls.get('altstore.offered', false)) {
          bar('<b>Get updates through AltStore</b><div class="small">Add DermScholar to AltStore once: new versions then show in its Updates tab and install over Wi-Fi.</div>' + btns('Add to AltStore', 'Not now'),
            { go: () => { ls.set('altstore.offered', true); openAltStore('source?url=' + encodeURIComponent(SOURCE)); }, later: () => ls.set('altstore.offered', true) });
        }
      } catch { /* offline, or no release yet */ }
    }, 6000);

    // MyLOFT's website only works inside its app: hand the paper's link to the MyLOFT app through
    // the share sheet (its "Save to MyLOFT"), or open the app itself.
    const MYLOFT_STORE = 'itms-apps://apps.apple.com/search?term=MyLOFT';
    N.openMyLoftApp = () => ios('openApp', { urls: ['myloft://', 'https://app.myloft.xyz/'], store: MYLOFT_STORE });
    // UpToDate inside the app, as on Android: the app's hidden browser signs in and reads it.
    if ((window.DSNative && window.DSNative.level) >= 3) {
      N.utdSearch = (q) => ios('utdSearch', { q });
      N.utdTopic = (u) => ios('utdTopic', { url: u });
      N.utdShowPage = () => ios('utdShowPage');
    }
    // MyLOFT: iPhone apps can't add to another app's library directly; MyLOFT's own "save" is in
    // the share panel. The panel opens with the paper's link (also copied); MyLOFT saves it.
    N.myloftHint = 'Tap MyLOFT in the panel to save the paper in MyLOFT (not in the first row? swipe the row, or More → MyLOFT). Then open it in MyLOFT, download the PDF and Share → DermScholar: it files itself.';
    N.sendToMyLoft = (text) => {
      try { ios('copy', { text }); } catch { /* no clipboard */ }
      if (/^https?:/.test(text)) ios('share', { title: 'Save to MyLOFT', url: text, then: 'myloft' });
      else N.openMyLoftApp();
    };
    // The iPhone app keeps passwords in the Keychain and its browser signs in with them; the
    // screens keep only the user ID.
    N.setCredentials = (p, u, pass) => { try { localStorage.setItem('ds.acc.' + p, u); } catch { /* blocked */ } ios('setCredentials', { p, user: u, pass: pass || '' }); };
    N.forgetCredentials = (p) => { try { localStorage.removeItem('ds.acc.' + p); } catch { /* blocked */ } ios('forgetCredentials', { p }); };
  }
  window.WebNative = N;
  if (IOS) {
    if (document.readyState === 'complete') setTimeout(() => ios('ready'), 0);
    else window.addEventListener('load', () => setTimeout(() => ios('ready'), 300));
  }

  // iPhone / iPad screens reach under the status bar, camera notch and home bar (the Android app
  // sits below its status bar): keep the bars and buttons clear of them.
  {
    const st = document.createElement('style');
    const T = 'env(safe-area-inset-top,0px)', B = 'env(safe-area-inset-bottom,0px)';
    st.textContent = `body{padding-top:${T}}
body::before{content:"";position:fixed;top:0;left:0;right:0;height:${T};background:var(--bg);z-index:9}
.topbar{top:${T}}
.rd-progress{top:calc(61px + ${T})}
:root{--nav-h:calc(72px + ${B})}
nav.bottom{padding-bottom:${B}}
.drawer{padding-top:${T};padding-bottom:${B}}
.lb{padding-top:${T};padding-bottom:${B}}
.player{padding-top:calc(10px + ${T})}
.sheet{padding-bottom:calc(24px + ${B})}
.upd-bar{top:calc(12px + ${T})}
.ptr{top:calc(6px + ${T})}`;
    document.head.appendChild(st);
  }

  // UpToDate needs the app's own browser: the web version leaves it out (the iPhone app keeps it).
  if (!IOS) {
    const st = document.createElement('style');
    st.textContent = '.app-tile.utd,[data-act=src][data-v=utd],[data-act=utd-search],[data-act=ev-utd],[data-act=utd-open],#nav [data-tab=utd],.setting:has([data-set=showUTD]),.acc-card:has([data-p=utd]){display:none!important}';
    document.head.appendChild(st);
  }

  // Google sign-in comes back to this page with the tokens in the address: hand them to sync.js.
  const h = location.hash;
  if (/access_token=|error_description=/.test(h)) {
    history.replaceState(null, '', location.pathname + location.search);
    window.addEventListener('load', () => emit({ type: 'authRedirect', url: 'dermscholar://auth' + h }));
  }

  // Ask Safari to keep the library (PDFs, notes) instead of clearing it when space runs low.
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* not supported */ }
})();
