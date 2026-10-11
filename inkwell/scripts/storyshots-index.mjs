// Builds dist/storyshots.json for the app: every summary on StoryShots' website and
// every episode of their free podcast, as { book, author } pairs. Run by the web
// workflow (GitHub's servers can reach their site; some phones can't), published
// next to the web app, and fetched by the app once a week.
import { writeFileSync, mkdirSync } from 'node:fs';

const SITE = 'https://www.getstoryshots.com';
const FEED = 'https://feeds.megaphone.fm/PARSIDA7641695618';
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' };

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\s ]+/g, ' ')
    .trim();

// Same rules as the app (src/sources/storyshots.js episodeBook).
function bookOf(title) {
  const t = decode(title);
  let m = /^(.*?) by (.+?)(?:\s*[-|:]\s*|\s+)(?:Book )?Summary\b/i.exec(t);
  if (m) return [m[1], m[2]];
  m = /^(.*?)\s*(?:-\s*)?(?:Book )?Summary\b[^|]*\|\s*(.+)$/i.exec(t);
  if (m) return [m[1], m[2]];
  m = /^(.*?)\s*(?:-\s*)?(?:Book )?Summary\b/i.exec(t);
  return m ? [m[1], ''] : null;
}

async function site() {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const r = await fetch(`${SITE}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,link`, { headers: UA });
    if (r.status === 400) break; // past the last page
    if (!r.ok) throw new Error(`site page ${page}: HTTP ${r.status}`);
    const posts = await r.json();
    if (!posts.length) break;
    for (const p of posts) {
      if (!/\/books\//.test(p.link || '')) continue;
      const b = bookOf(p.title?.rendered);
      if (b && b[0]) out.push([b[0], b[1], p.link, p.id]);
    }
    if (page >= Number(r.headers.get('x-wp-totalpages') || 0)) break;
  }
  return out;
}

async function podcast() {
  const xml = await (await fetch(FEED, { headers: UA })).text();
  const cover = (/<itunes:image[^>]*href="([^"]+)"/.exec(xml.split('<item>')[0]) || [])[1] || '';
  const eps = [];
  for (const it of xml.split('<item>').slice(1)) {
    const title = decode((/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1]);
    const url = (/<enclosure[^>]*url="([^"]+)"/.exec(it) || [])[1];
    const b = bookOf(title);
    if (!url || !b || !b[0]) continue;
    const d = decode((/<itunes:duration>([\s\S]*?)<\/itunes:duration>/.exec(it) || [])[1]);
    const secs = d.includes(':') ? d.split(':').reduce((s, x) => s * 60 + Number(x || 0), 0) : Number(d) || 0;
    const guid = decode((/<guid[^>]*>([\s\S]*?)<\/guid>/.exec(it) || [])[1]) || url;
    const img = (/<itunes:image[^>]*href="([^"]+)"/.exec(it) || [])[1] || '';
    eps.push([b[0], b[1], url.replace(/^http:/, 'https:'), secs, title, guid, img]);
  }
  return { cover, eps };
}

const [s, p] = await Promise.allSettled([site(), podcast()]);
if (s.status === 'rejected') console.warn('Website:', s.reason?.message);
if (p.status === 'rejected') console.warn('Podcast:', p.reason?.message);
const out = { t: Date.now(), cover: p.value?.cover || '', site: s.value || [], pod: p.value?.eps || [] };
if (!out.site.length && !out.pod.length) {
  console.warn('Nothing found; not writing the index');
  process.exit(0);
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/storyshots.json', JSON.stringify(out));
console.log(`StoryShots index: ${out.site.length} website summaries, ${out.pod.length} podcast episodes`);
console.log('e.g.', JSON.stringify(out.site.slice(0, 3)), JSON.stringify(out.pod.slice(0, 1)));
