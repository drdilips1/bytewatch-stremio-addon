// Ask AI about a book (or about your whole library): six modes with ready-made
// questions, a follow-up conversation kept per book, a quiz for "Remember", and
// "ask about what I'm hearing" using where you are in the book right now.
// Answers come from what the AI knows about the book plus its description —
// it doesn't have the audio or text itself, and is told to say so when unsure.
import { askAi, parseJson } from './ai.js';
import { persisted } from './store.js';
import { mainTitle } from './match.js';
import { tasteProfile } from './bookseller.js';
import { fmtTime } from './format.js';
import * as player from './player.js';

export const MODES = [
  {
    id: 'understand',
    icon: '🔍',
    label: 'Understand',
    asks: ['Explain the main concept simply', "Explain it like I'm 10", 'Give me a real-life example of the core idea', 'What are the difficult parts, explained?'],
  },
  {
    id: 'summarize',
    icon: '📝',
    label: 'Summarize',
    asks: ['A 30-second summary', 'A 5-minute summary', 'The whole book in 10 points', 'Summarize it chapter by chapter'],
  },
  {
    id: 'remember',
    icon: '🧠',
    label: 'Remember',
    asks: ['Quiz me (5 questions)', 'Make flashcards of the key concepts', 'Give me memorable analogies for the main ideas'],
  },
  {
    id: 'apply',
    icon: '🛠',
    label: 'Apply',
    asks: ['Turn this book into a 7-day plan for me', 'Give me a practical checklist', 'What should I actually do differently?'],
  },
  {
    id: 'challenge',
    icon: '⚖️',
    label: 'Challenge',
    asks: ['What are the weaknesses of this book?', 'What does research say about its main claims?', 'What are the strongest counterarguments?', 'Which claims are controversial?'],
  },
  {
    id: 'connect',
    icon: '🔗',
    label: 'Connect',
    asks: ["How does this connect to books I've read?", 'Which books say the opposite?', 'What should I read next after this?'],
  },
];

export const STARTERS = ['What is this book about?', 'What are the 5 most important ideas?', 'Is this book worth my time?', 'Give me a practical summary'];
export const LIBRARY_ASKS = [
  'What common themes run through my books?',
  'Which books in my library disagree with each other?',
  'What should I read next, based on my books?',
  'Sum up what my books say about living well',
];

// Conversations, per book (newest 30 books, last 30 messages each).
const threads = persisted('askThreads', {});
const keyOf = (book) => (book ? book.uid || mainTitle(book.title) : 'library');
export const threadFor = (book) => threads.get()[keyOf(book)]?.msgs || [];
function saveThread(book, msgs) {
  const k = keyOf(book);
  threads.set((all) => {
    const next = { ...all, [k]: { t: Date.now(), msgs: msgs.slice(-30) } };
    const keys = Object.keys(next);
    if (keys.length > 30) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 30).forEach((x) => delete next[x]);
    return next;
  });
}
export const clearThread = (book) => saveThread(book, []);

/** Where you are in this book, if it's the one playing: { chapter, time, label }. */
export function hearing(book) {
  const st = player.getState();
  if (!book || !st.book || st.book.uid !== book.uid) return null;
  const g = player.globalTime();
  const ch = player.chapters().find((c) => g >= c.start && g < (c.end || Infinity));
  return { chapter: ch?.title || '', time: g, label: `${ch?.title ? `${ch.title}, ` : ''}${fmtTime(g)}` };
}

function context(book, { description = '', genres = [] } = {}) {
  if (!book) {
    const taste = tasteProfile(60);
    return `You are a thoughtful reading companion who knows this reader's library well.
The reader's books (with how they felt, where known):
${taste.length ? taste.map((t) => '- ' + t).join('\n') : '- (no books yet)'}
Answer about these books using what you know of them. Name the books you draw on. If a book isn't one you know, say so.`;
  }
  const title = mainTitle(book.title);
  const desc = String(description || book.description || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  return `You are a knowledgeable, honest reading companion for the book "${title}"${book.author ? ` by ${book.author}` : ''}.
Use what you know about this book and the description below. You don't have the book's full text: if you're unsure about a specific detail, say so. Never invent quotes, page numbers, chapter titles or timestamps.
${desc ? `Description: """${desc}"""\n` : ''}${genres.length ? `Genres: ${genres.slice(0, 6).join(', ')}\n` : ''}`;
}

const STYLE = 'Reply in the language the reader used (English, Hindi or Hinglish). Answer in clear, warm, plain language. Use short paragraphs, and bullet points ("- ") or numbered lists where they help. Use **bold** for key terms. Keep it under about 250 words unless the question asks for more.';

/**
 * Ask a question. `msgs` is the conversation so far ({ role: 'user'|'ai', text }).
 * Returns the answer text and saves the thread.
 */
export async function ask(book, question, { msgs = [], description = '', genres = [], mode = '', where = null } = {}) {
  const history = msgs
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Reader' : 'You'}: ${m.quiz ? '(a quiz)' : m.text}`)
    .join('\n');
  const extra = [];
  if (mode === 'connect' && book) {
    const taste = tasteProfile(40);
    if (taste.length) extra.push(`Books this reader owns, has read or is reading:\n${taste.map((t) => '- ' + t).join('\n')}\nConnect to these specifically where it makes sense.`);
  }
  if (where) extra.push(`The reader is listening right now at ${where.label}. Answer about the part of the book around this point as best you know it; say if you can't be sure exactly what is said there.`);
  const prompt = `${context(book, { description, genres })}
${extra.join('\n\n')}
${history ? `Conversation so far:\n${history}\n` : ''}
Reader's question: ${question}

${STYLE}`;
  const text = (await askAi(prompt)).trim();
  saveThread(book, [...msgs, { role: 'user', text: question }, { role: 'ai', text }]);
  return text;
}

/** A multiple-choice quiz: [{ q, options: [4], answer: 0-3, why }]. */
export async function quiz(book, { msgs = [], description = '', genres = [] } = {}) {
  const prompt = `${context(book, { description, genres })}
Write a 5-question multiple-choice quiz that helps the reader remember the book's most important ideas (not trivia).
Reply with JSON only: {"questions": [{"q": "question", "options": ["A", "B", "C", "D"], "answer": 0, "why": "one-sentence explanation"}]}
"answer" is the index (0-3) of the correct option. Vary which position is correct.`;
  const data = parseJson(await askAi(prompt, { json: true }));
  const questions = (data?.questions || [])
    .filter((x) => x && x.q && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(Number(x.answer)))
    .map((x) => ({ q: String(x.q), options: x.options.slice(0, 4).map(String), answer: Math.min(Number(x.answer), x.options.length - 1), why: String(x.why || '') }))
    .slice(0, 6);
  if (!questions.length) throw new Error("The AI couldn't make a quiz right now — try again");
  saveThread(book, [...msgs, { role: 'user', text: 'Quiz me' }, { role: 'ai', text: '', quiz: questions }]);
  return questions;
}
