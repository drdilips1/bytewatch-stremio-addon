// Hardcover — show your shelves (Want to Read / Currently Reading / Read) and
// update a book's status from Inkwell. Token: hardcover.app → Settings → API.
import { sendJson } from '../lib/http.js';
import { hardcover } from '../lib/store.js';

const API = 'https://api.hardcover.app/v1/graphql';
export const STATUS = { want: 1, reading: 2, read: 3 };
export const connected = () => !!hardcover.get().token;

const token = () => hardcover.get().token.trim().replace(/^Bearer\s+/i, '');

async function gql(query, variables = {}, tok = token()) {
  let r;
  try {
    r = await sendJson(API, 'POST', { query, variables }, { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Hardcover rejected the token — copy a fresh one from hardcover.app/account/api');
    throw e;
  }
  if (r?.errors?.length) throw new Error(r.errors[0].message || 'Hardcover request failed');
  if (!r?.data) throw new Error('Hardcover returned no data');
  return r.data;
}
const me = (d) => (Array.isArray(d.me) ? d.me[0] : d.me) || {};

export async function connect(tok) {
  const t = tok.trim().replace(/^Bearer\s+/i, '');
  const d = await gql('query { me { id username } }', {}, t);
  const u = me(d);
  if (!u.id) throw new Error('Hardcover did not accept that token');
  hardcover.set({ token: t, username: u.username || 'Hardcover', userId: u.id });
  return u.username;
}
export const disconnect = () => hardcover.set({ token: '', username: '' });

function toBook(b) {
  return {
    uid: 'hc:' + b.id,
    source: 'hc',
    kind: 'discover',
    title: b.title,
    author: (b.contributions || []).map((c) => c.author?.name).filter(Boolean).slice(0, 2).join(', ') || (b.author_names || []).slice(0, 2).join(', '),
    cover: b.image?.url || '',
    year: b.release_year || '',
    description: b.description || '',
  };
}

// Richest field set first; if the server rejects a field (schema changes,
// permission limits) fall back to simpler selections.
const FIELD_SETS = [
  'id title description release_year image { url } contributions(limit: 2) { author { name } }',
  'id title release_year cached_image cached_contributors',
  'id title release_year',
];

async function withFallback(build, variables) {
  let lastErr;
  for (const fields of FIELD_SETS) {
    try {
      return await gql(build(fields), variables);
    } catch (e) {
      lastErr = e;
      if (/auth|token|jwt|expired|unauthor|401|403/i.test(e.message)) break;
    }
  }
  throw lastErr;
}

function normalize(b) {
  const img = b.image?.url || b.cached_image?.url || (typeof b.cached_image === 'string' ? b.cached_image : '');
  const cc = Array.isArray(b.cached_contributors) ? b.cached_contributors.map((c) => c.author?.name || c.name).filter(Boolean) : [];
  return toBook({ ...b, image: img ? { url: img } : null, author_names: cc });
}

export async function shelf(status) {
  if (!connected()) return [];
  const d = await withFallback(
    (f) => `query Shelf($s: Int!) { me { user_books(where: { status_id: { _eq: $s } }, limit: 60) { book { ${f} } } } }`,
    { s: status }
  );
  return (me(d).user_books || []).map((ub) => ub.book && normalize(ub.book)).filter((b) => b?.title);
}

export async function details(book) {
  const d = await withFallback((f) => `query B($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) { ${f} } }`, { id: +book.uid.slice(3) });
  return d.books?.[0] ? { ...book, ...normalize(d.books[0]), cover: book.cover || normalize(d.books[0]).cover, link: `https://hardcover.app/books/${book.uid.slice(3)}` } : book;
}

/** Counts per shelf, used by Settings to show the connection works. */
export async function counts() {
  const out = {};
  for (const [k, v] of Object.entries(STATUS)) out[k] = (await shelf(v)).length;
  return out;
}

async function findBookId(book) {
  if (book.uid.startsWith('hc:')) return +book.uid.slice(3);
  const d = await gql('query S($q: String!) { search(query: $q, query_type: "Book", per_page: 1, page: 1) { results } }', {
    q: `${book.title} ${(book.author || '').split(',')[0]}`.trim(),
  });
  const hit = d.search?.results?.hits?.[0]?.document;
  if (!hit?.id) throw new Error('Could not find this book on Hardcover');
  return +hit.id;
}

export async function getStatus(book) {
  if (!connected()) return null;
  const id = await findBookId(book);
  const d = await gql('query U($id: Int!) { me { user_books(where: { book_id: { _eq: $id } }) { id status_id } } }', { id });
  const ub = me(d).user_books?.[0];
  return { bookId: id, userBookId: ub?.id, status: ub?.status_id || 0 };
}

export async function setStatus(book, status) {
  const cur = await getStatus(book);
  if (cur.userBookId) {
    await gql('mutation M($id: Int!, $s: Int!) { update_user_book(id: $id, object: { status_id: $s }) { id error } }', { id: cur.userBookId, s: status });
  } else {
    const d = await gql('mutation M($b: Int!, $s: Int!) { insert_user_book(object: { book_id: $b, status_id: $s }) { id error } }', { b: cur.bookId, s: status });
    if (d.insert_user_book?.error) throw new Error(d.insert_user_book.error);
  }
  return status;
}
