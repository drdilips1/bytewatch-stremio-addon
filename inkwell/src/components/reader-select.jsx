import { useEffect, useState } from 'preact/hooks';
import { askAi, aiReady } from '../lib/ai.js';
import { toast } from './common.jsx';
import { spoilerRule } from '../lib/askbook.js';
import { Answer } from '../screens/Ask.jsx';

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const hasDevanagari = (s) => /[ऀ-ॿ]/.test(s);

/** What each AI button asks, given the selected words and their sentence/paragraph. */
const PROMPTS = {
  explain: ({ text, context, book }) =>
    `From the book "${book.title}"${book.author ? ` by ${book.author}` : ''}. Explain this passage in simple, plain language, under 120 words. If it depends on something earlier in the book, say so briefly.\n\nPassage: """${clip(text, 1500)}"""`,
  define: ({ text, context, book }) =>
    `Define "${clip(text, 80)}" as it is used here (from "${book.title}"): """${clip(context, 500)}"""\nGive the meaning in this context, the part of speech, and one simple example sentence. Under 70 words. Answer in the same language as the word.`,
  translate: ({ text }) =>
    `Translate into ${hasDevanagari(text) ? 'English' : 'Hindi'}, naturally (not word for word). Give only the translation.\n\n"""${clip(text, 1500)}"""`,
  ask: ({ text, book, question }) =>
    `From the book "${book.title}"${book.author ? ` by ${book.author}` : ''}, this passage: """${clip(text, 1500)}"""\n\nQuestion: ${question}\nAnswer clearly in under 150 words. Say when something isn't in the passage and comes from general knowledge.`,
};
const TITLES = { explain: 'Explain', define: 'Define', translate: 'Translate', ask: 'Ask about this' };

/**
 * The bar for selected words, fixed at the bottom (it doesn't move about or cover the
 * words): snap the selection to the sentence / paragraph or add the next sentence, then
 * Highlight or ask the AI.
 */
export function SelectionBar({ sel, onAction, onGrow }) {
  const single = !/\s/.test(sel.text.trim());
  const words = sel.text.trim().split(/\s+/).length;
  const keep = (e) => e.preventDefault(); // tapping the bar mustn't clear the selection
  return (
    <div class="sel-dock" onMouseDown={keep} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div class="sel-grow">
        <small>{words} word{words > 1 ? 's' : ''}</small>
        <button onMouseDown={keep} onClick={() => onGrow('sentence')}>Sentence</button>
        <button onMouseDown={keep} onClick={() => onGrow('paragraph')}>Paragraph</button>
        <button onMouseDown={keep} onClick={() => onGrow('more')}>+ Next</button>
      </div>
      <div class="sel-bar">
        <button class="hl-btn" onClick={() => onAction('highlight')}>
          Highlight
        </button>
        <button onClick={() => onAction('explain')}>Explain</button>
        <button onClick={() => onAction('define')}>{single ? 'Define' : 'Meaning'}</button>
        <button onClick={() => onAction('ask')}>Ask</button>
        <button onClick={() => onAction('translate')}>Translate</button>
      </div>
    </div>
  );
}

/** The AI answer for a selection (or a question box for Ask). */
export function AiSheet({ kind, text, context, book, onClose, onKeep }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (q = '') => {
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    setBusy(true);
    try {
      const rule = kind === 'translate' ? '' : spoilerRule(book);
      setAnswer((await askAi(PROMPTS[kind]({ text, context, book, question: q }) + (rule ? `\n\n${rule}` : ''))).trim());
    } catch (e) {
      setAnswer('');
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  // Explain / Define / Translate answer straight away.
  useEffect(() => {
    if (kind !== 'ask') run();
  }, []);
  return (
    <div class="reader-panel sel-sheet">
      <div class="sel-sheet-head">
        <h3>{TITLES[kind]}</h3>
        <button class="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <blockquote class="sel-quote">{clip(text, 300)}</blockquote>
      {kind === 'ask' && !answer && (
        <form
          class="sel-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) run(question.trim());
          }}
        >
          <input value={question} onInput={(e) => setQuestion(e.currentTarget.value)} placeholder="What would you like to know?" autofocus />
          <button class="btn primary" disabled={!question.trim() || busy}>
            Ask
          </button>
        </form>
      )}
      {busy ? (
        <p class="muted">
          <span class="spinner small" /> Thinking…
        </p>
      ) : answer ? (
        <>
          <div class="sel-answer">
            <Answer text={answer} />
          </div>
          <div class="btn-row">
            <button class="btn secondary" onClick={() => onKeep(answer)}>
              Highlight + keep this as a note
            </button>
            <button
              class="link-btn"
              onClick={() => navigator.clipboard?.writeText(answer).then(() => toast('Copied'), () => toast('Couldn’t copy'))}
            >
              Copy
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Tapping a highlight: its note (editable), Ask AI, remove. */
export function HighlightSheet({ h, onSave, onRemove, onAi, onClose }) {
  const [note, setNote] = useState(h.note || '');
  return (
    <div class="reader-panel sel-sheet">
      <div class="sel-sheet-head">
        <h3>Highlight</h3>
        <button class="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <blockquote class="sel-quote">{clip(h.text, 400)}</blockquote>
      <textarea class="hl-note" rows={3} placeholder="Add a note…" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      <div class="btn-row">
        <button class="btn primary" onClick={() => onSave(note.trim())}>
          Save
        </button>
        <button class="btn secondary" onClick={onAi}>
          Explain
        </button>
        <button class="link-btn danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
