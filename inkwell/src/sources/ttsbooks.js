// Ebooks narrated by an AI voice (see lib/tts.js). UIDs look like "tts:gb:1342".
import * as gb from './gutenberg.js';
import { paragraphs, buildAudiobook, ttsCfg, hasKey, availableEngines } from '../lib/tts.js';

export function pickEngine() {
  const want = ttsCfg.get().engine;
  return hasKey(want) ? want : availableEngines()[0] || null;
}

export async function narrate(book, engine = pickEngine()) {
  if (!engine) throw new Error('Add an OpenAI, Google Cloud or ElevenLabs key in Settings → Read-aloud voices');
  const base = book.uid.startsWith('tts:') ? { ...book, uid: book.uid.slice(4) } : book;
  const full = base.readUrl ? base : await gb.details(base);
  const doc = await gb.loadText(full);
  const paras = paragraphs(doc.html);
  if (!paras.length) throw new Error('No readable text found in this ebook');
  return buildAudiobook(full, paras, engine);
}

export const details = (book) => narrate(book);
export const search = async () => [];
