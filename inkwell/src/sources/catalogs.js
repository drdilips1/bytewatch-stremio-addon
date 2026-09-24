// Listing-only catalogues for Discover search: Audible (audiobooks) and Google
// Books (ebooks/print). Results are "discover" items — opening one looks for a
// playable or readable copy across the user's own sources.
import { getJson, qs } from '../lib/http.js';
import { stripHtml } from '../lib/format.js';

const AUDIBLE = 'https://api.audible.com/1.0/catalog/products';
const GROUPS = 'contributors,product_desc,product_attrs,media,series,rating,category_ladders';

function fromAudible(p) {
  const img = p.product_images || {};
  const s = p.series?.[0];
  return {
    uid: 'au:' + p.asin,
    source: 'au',
    kind: 'discover',
    title: p.title,
    author: (p.authors || []).map((a) => a.name).slice(0, 2).join(', '),
    narrator: (p.narrators || []).map((a) => a.name).slice(0, 2).join(', '),
    cover: img['500'] || img['1024'] || '',
    year: (p.release_date || '').slice(0, 4),
    duration: p.runtime_length_min ? p.runtime_length_min * 60 : 0,
    series: s ? `${s.title}${s.sequence ? ` #${s.sequence}` : ''}` : '',
    description: stripHtml(p.publisher_summary || p.merchandising_summary || ''),
    link: `https://www.audible.com/pd/${p.asin}`,
    genres: [...new Set((p.category_ladders || []).flatMap((l) => (l.ladder || []).map((x) => x.name)).filter(Boolean))],
  };
}

export const audible = {
  /** Audible bestsellers for a genre (listing only). */
  async genre(name) {
    const run = (sort) => getJson(`${AUDIBLE}?` + qs({ keywords: name, num_results: 40, products_sort_by: sort, response_groups: GROUPS, image_sizes: '500,1024' }));
    let d;
    try {
      d = await run('BestSellers');
    } catch {
      d = await run('Relevance');
    }
    return (d.products || []).filter((p) => p.title).map(fromAudible);
  },
  async search(term) {
    if (!term.trim()) return [];
    const d = await getJson(`${AUDIBLE}?` + qs({ keywords: term, num_results: 24, products_sort_by: 'Relevance', response_groups: GROUPS, image_sizes: '500,1024' }));
    return (d.products || []).filter((p) => p.title).map(fromAudible);
  },
  async details(book) {
    const d = await getJson(`${AUDIBLE}/${book.uid.slice(3)}?` + qs({ response_groups: GROUPS, image_sizes: '500,1024' }));
    return d.product ? { ...book, ...fromAudible(d.product) } : book;
  },
};

function fromGoogle(item) {
  const v = item.volumeInfo || {};
  const img = v.imageLinks || {};
  const cover = (img.extraLarge || img.large || img.medium || img.thumbnail || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/zoom=1/, 'zoom=2');
  return {
    uid: 'gbk:' + item.id,
    source: 'gbk',
    kind: 'discover',
    title: v.subtitle && v.title.length < 40 ? `${v.title}: ${v.subtitle}` : v.title,
    author: (v.authors || []).slice(0, 2).join(', '),
    cover,
    year: (v.publishedDate || '').slice(0, 4),
    description: stripHtml(v.description || ''),
    subjects: (v.categories || []).slice(0, 6),
    link: v.infoLink || `https://books.google.com/books?id=${item.id}`,
  };
}

export const googleBooks = {
  async search(term) {
    if (!term.trim()) return [];
    const d = await getJson('https://www.googleapis.com/books/v1/volumes?' + qs({ q: term, maxResults: 24, printType: 'books', orderBy: 'relevance' }));
    return (d.items || []).filter((i) => i.volumeInfo?.title).map(fromGoogle);
  },
  async details(book) {
    const d = await getJson(`https://www.googleapis.com/books/v1/volumes/${book.uid.slice(4)}`);
    return d?.volumeInfo ? { ...book, ...fromGoogle(d) } : book;
  },
};
