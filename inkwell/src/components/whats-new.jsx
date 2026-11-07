// "What's new": a short list of what changed, shown once after an update (and from
// Settings any time). Add the newest entry at the top of CHANGES with each build.
import { useEffect, useState } from 'preact/hooks';
import { persisted, useStore, library, progress } from '../lib/store.js';

export const CHANGES = [
  {
    id: '2026-11-07',
    title: 'Android Auto, and a better transcript',
    items: [
      ['🚗', 'Android Auto', 'In the car: Continue listening, Recently played, Downloaded and Now playing. Tap a book, say “Hey Google, play … on Audiohub”, or search — it plays from your place. With the app closed, downloaded books still play. (A phone-installed app: turn on Unknown sources in Android Auto’s developer settings.)'],
      ['📖', 'Transcript: the book’s own words', 'With the ebook attached, its words fill the gaps between matched lines and carry on past the last one — far fewer missing or misheard words. Heard lines start with a capital and end with a full stop. Tapping an ebook shows how far its download has got.'],
      ['📈', 'Top audiobooks and New audiobooks', 'Two new lists in Discover from Apple Books’ charts, each with See all.'],
      ['🎙️', 'Hide the Podcasts tab', 'Settings → Appearance → Podcasts tab.'],
      ['🎧', 'Mobilism works', 'Its audiobook topics are now recognised (the forum trail has a category in between), with Send to TorBox and Real-Debrid links on each result.'],
      ['🗣️', '“Hey Google, play … on Audiohub”', 'On the phone and in the car: plays the book of yours that matches, or opens the search with your words.'],
      ['📖', 'Text follows the audio', 'With the ebook attached, the transcript shows the book’s own paragraphs and lights the sentence being read, worked out from the audio’s time — it keeps up even when the ebook came late. Tap a sentence to play from there.'],
      ['⬇️', 'Ebook attach that works', 'Tapping a file now stops the background download and fetches yours fresh, with progress out of its size.'],
      ['🔁', 'Ink & Echo searches', 'Sources that forward the search to a new address are followed instead of failing.'],
      ['🌱', 'No more “seeds ?”', 'A result whose seed count isn’t known simply shows none.'],
    ],
  },
  {
    id: '2026-11-03',
    title: 'The right ebook, and a readable banner',
    items: [
      ['🎧', 'Mobilism Audiobooks (test)', 'Settings → Addons → Mobilism Audiobooks: Add, then Sign in once in the in-app browser. Book searches then include its Audiobooks forum — each topic checked to be in eBooks » Audiobooks — with Open topic and its download links. Your sign-in stays in the app.'],
      ['🔎', 'Play finds the book', 'Authors written with degrees (“Brené Brown PhD LMSW”) no longer make the real book look like another one.'],
      ['📖', 'The real book for the transcript', 'The ebook found for the transcript is the book itself — its title first — not a summary, study guide or “30 minute expert” companion. Among real matches, an EPUB, the smaller file first. Choose shows the list and attaches nothing until you tap one; the automatic search is lighter (no PDFs, one at a time).'],
      ['🌓', 'Banner without a cover', 'A cloud book with no cover gets a title tile on Home, and its text stays readable in light themes (it was white on a pale background).'],
      ['🧹', 'Bookracy gone', 'The Bookracy site is gone, so its search is removed — ebook searches no longer wait on it.'],
    ],
  },
  {
    id: '2026-11-02',
    title: 'Libby, the phone copy first, and your own covers',
    items: [
      ['📚', 'Libby', 'Settings → Libby: add your library cards (card number + PIN). Book pages and search show copies at your libraries — Borrow, Place hold, Listen in Libby — and Library has a Libby tab with your loans, holds ready to borrow and holds (Renew, Return, Cancel hold).'],
      ['📱', 'Plays the copy on your phone first', 'Resume a book (Continue, the mini player, Library) and it plays the copy in your phone folders when there is one — offline, no buffering, same place. Tapping a TorBox or Audiobookshelf copy on the book page still plays that copy.'],
      ['🖼️', 'Your own cover pictures', 'Press and hold a book → Find a better cover & details → Or choose your own picture from the phone. A cover you choose (yours or one you picked) now stays — it was swapped back for Audible’s — and shows in the player and on Home too.'],
      ['⚡', 'Server slow? TorBox at once', 'When Audiobookshelf is slow, a copy that’s ready in TorBox / Real-Debrid starts within seconds, at your place (by the parts’ file sizes when their lengths aren’t known yet).'],
      ['🅼', 'MyAnonamouse stays signed in', 'Settings → Tracker: paste your mam_id session once; the app keeps it fresh when your network changes, so no more “ASN mismatch” logouts.'],
      ['⭐', 'Ratings on more books', 'Audible’s stars show when Goodreads doesn’t have the book.'],
      ['🌓', 'Easier to read', 'Menus are readable in light themes, the reader’s voice list on dark pages, the read-aloud bar is slim again, switches in Settings are normal size and no stray “0” under cards.'],
      ['🎯', 'Real book first', 'In Audible search, unrated copycats of a book (“12 Rules for Life In English”) go below the real one.'],
      ['📖', 'Ebook for the transcript, faster', 'Only ebook sources are searched, and the first clear EPUB is attached straight away.'],
    ],
  },
  {
    id: '2026-10-31',
    title: 'Ivory & Gold, and fixes from your notes',
    items: [
      ['🅼', 'M in the background', 'MyAnonamouse: tap M and the app finds the book itself — freeleech or VIP first, then M4B / MP3 (or EPUB for ebooks) and the most seeders — downloads it (trying again if the first download fails) and sends it to qBittorrent. Nothing opens. Press and hold M to see the search instead. Settings → Tracker: turn it off, or let it spend a freeleech wedge when the copy isn’t free.'],
      ['🕘', 'Playback history', 'Player → More → History: every play, pause, skip, jump, chapter change and sleep-timer stop, with the time and where you were, grouped by listening session. Fell asleep or bumped skip? Tap the entry to go back.'],
      ['🔄', 'Audiobookshelf in step', 'A book starts from the newer place — your server’s (another app went further) or this phone’s — and progress goes through the server’s own session, so the percentage and listening time update there too.'],
      ['🛟', 'Server down? Still plays', 'When your Audiobookshelf isn’t answering, Play uses your copy on the phone, downloaded or in TorBox / Real-Debrid, from the same place.'],
      ['🎯', 'The right book', '“The Greatest Secret” is no longer offered for “The Secret”, nor other books of a series (Red Rising) — they wait under loose matches.'],
      ['📖', 'Text view ebook', 'While it looks for the ebook: Choose or Stop. It gives up after a minute, and the ebook sheet always closes.'],
      ['🧩', 'Add-on torrents play', 'Add-ons that offer a torrent instead of a link now play through TorBox / Real-Debrid.'],
      ['🧩', 'Sources are add-ons now', 'No more sources built into the app: AudiobookBay, Knaben and Ink & Echo are ordinary add-ons in Settings → Addons, under their own names — remove any that stop working. Bookracy (shut down) is gone; the others can be added back with one tap there.'],
      ['🌱', 'AudiobookBay seeds', 'Results no longer all show 0 seeds: when the site doesn’t say, it reads “seeds ?” and the real count is fetched from TorBox where it can be.'],
      ['⏪', 'Highlights start earlier', 'Tapping a highlight or bookmark plays from 30 seconds before it, so you hear the lead-in.'],
      ['📚', 'Kindle for torrent ebooks', 'Torrent ebook results have a Kindle button next to Read and Save: it fetches the EPUB (or PDF) and sends it to Kindle or another app.'],
      ['🔎', 'One tracker button', 'The FL / VIP and All buttons are now one letter button: tap searches with your filter, press and hold searches everything.'],
      ['🏠', 'No double sends', 'On a book from your Audiobookshelf, playing it through TorBox no longer sends it home to qBittorrent again; ♥ says “Added to your library” and Offline is now “Download · plays without internet”.'],
      ['⏱️', 'Listen for 10 / 30 / 60 minutes', 'Home → Listen for…: 10 minutes plays a few of your saved passages from different books, 30 your current book, 60 your current book and then your next one. It stops by itself on time — no streaks, no reminders. (Customise Home can hide it.)'],
      ['📑', 'Chapter summaries', 'Player → chapter list: chapters you’ve reached have a Summary — a few points and the key idea, from the book’s own text when its ebook is attached. Kept, so the next time it opens at once. No spoilers: later chapters don’t offer one.'],
      ['⏭️', 'Up next', 'Line up what to listen to next: press and hold a book → Add to Up next (or hold a bookmark to queue that passage). It shows on Home and in the player (More → Up next), and the next one starts when a book ends — each from its own place.'],
      ['📊', 'Reading stats', 'Library → Stats now has Listening and Reading: time spent reading ebooks today, this week and in all, your reading streak, when you read, your most-read books and the ebooks you finished. Counted while the reader is open and in use, or reading aloud.'],
      ['🖼️', 'Find a cover from more places', 'Press and hold a book → Find cover & details, or on the book page: it now searches Audible, Apple audiobooks, Apple Books, Goodreads, Google Books and Open Library at once. Missing covers are also looked up in Apple Books and Goodreads by themselves.'],
      ['🔁', 'Follows Absorb', 'Listened further in Absorb (or any Audiobookshelf app)? Audiohub carries on from there — when you open the book and when you press play after a break, even if you play it here from TorBox or a download. And your place here is written back to your server, so the other app follows too.'],
      ['🖼️', 'Square audiobook covers', 'Books with a tall print cover now show their square audiobook cover from Apple Books (or Audible) when there is one — on Home, in the player and everywhere else — instead of a cut-off one.'],
      ['▶️', 'New player', 'The cover in the middle, where it plays from on top, chapter and X-Ray as pills, an Ask · Explain · Find · X-Ray row, and Speed · Sleep · Text · Voice · Mark · More with labels. Challenge, Rabbit hole, Related, Recall and Remember are under More.'],
      ['💬', 'Ask AI, redone', 'Answers on a clean card in a book font, with where they came from (your ebook, what you’ve heard, or what the AI knows), Share / Copy / Listen / Save, and follow-up questions. Voice and spoiler settings sit under ⚙.'],
      ['🎧', 'Read along with the audio', 'Open the ebook while its audiobook plays and tap “Follow the audio”: the paragraph being read lights up and stays on screen (scroll yourself and it waits a few seconds). Works with any edition — it listens for the words.'],
      ['🧭', 'Text stays in step', 'The Text view no longer jumps to another page when the book repeats a phrase (“the law of attraction…”): lines keep to the book’s order and a far jump needs much stronger proof.'],
      ['🤍', 'Ivory & Gold', 'A new light look: warm ivory, ink text and an antique-gold accent (Settings → Appearance has the others).'],
      ['📜', 'Text, full screen', 'Tap Text in the player: the words fill the screen like a page, the line being read is lit, and a slim strip keeps play, skip, speed and where you are.'],
      ['🖼️', 'Whole covers', 'Tall covers are no longer cropped to squares: the whole cover shows on a soft blur of itself, and covers load sharper.'],
      ['✋', 'Press and hold a book', 'Hold any cover for Play, Download, library, tag, Mark as finished, Reset progress, Details and Remove from Continue listening.'],
      ['🏠', 'Tighter Home', 'Rows sit closer together, with how many books each source or shelf has next to its name.'],
      ['🎨', 'New icons and greeting', 'AI buttons use a chat bubble instead of the little stars, “Recommended” rows a compass, Podcasts a broadcast icon; the greeting is one line in one font (“Good evening, name”) with the date under it.'],
      ['📖', 'Ask AI reads your ebook', 'With the ebook attached (or the book open in the reader), Ask AI answers from the book’s own text — the passages that fit your question, never past where you are with No spoilers on. No ebook: it uses what you’ve heard so far (live transcript).'],
      ['🎙️', 'Voice: play means play', '“Play <book>” plays it even with another book loaded, titles with “where / when” in them work, and questions always go to Ask AI. A book you don’t have yet plays from your sources — instant in TorBox first, then the most seeds.'],
      ['🛠️', 'Issues & support', 'Settings → Issues & support: known issues on GitHub, suggest a feature, detailed logging for hard-to-catch problems, and the problem report.'],
      ['✨', 'Smaller fixes', 'Chapter pill shows the chapter’s own title (Chapter 6 · 8/10); listening options come before ebooks on the book page; ebook files that don’t open aren’t offered again; Kindle addresses can’t be wiped by sync; button labels stay inside.'],
    ],
  },
  {
    id: '2026-10-29',
    title: 'Names heard right',
    items: [
      ['📑', 'Chapters in one-file audiobooks', 'Books that come as a single file now show their chapters more often: read from inside M4B and MP3 files (both kinds of chapter marks), or else the book’s published chapter list, fitted to your copy (shown with ≈).'],
      ['🎯', 'Fewer wrong books', 'For a short title like “Civilization”, Your copies and Sources no longer show other books with that word in their name — the author has to match too (the rest wait under “loose matches”).'],
      ['📖', 'More ebooks for the Text view', 'Ebooks whose source doesn’t say the file type (Ink & Echo) can now be attached too — the app checks the file and uses it if it’s an EPUB or PDF. Or choose any ebook file on your phone (e.g. in Downloads).'],
      ['💾', 'Save any ebook', 'Every ebook result now has Save. MOBI and others go to your phone’s Downloads; a file of unknown type is checked first — if it’s really an EPUB or PDF, Read opens it in the app. MOBI / AZW3 results are tucked behind a button (the app can’t read them).'],
      ['🔎', 'Search for the right ebook', 'Text view → Change (or Get the ebook) now has a search box: type “harry potter chamber of secrets” when the audiobook is just called “Harry Potter”.'],
      ['🗣️', 'Snape, not snake', 'The Text view puts misheard character names right (“snake” → Snape, “hogwards” → Hogwarts), using X-Ray’s cast and the ebook when it’s attached — a real snake in the book stays a snake.'],
    ],
  },
  {
    id: '2026-10-28',
    title: 'Select by sliding, and fixes',
    items: [
      ['👆', 'Press, hold and slide', 'In ebooks, press on a word, hold a moment, then slide your finger — the selection follows it, word by word (the page scrolls at the edges). Lift, then Highlight.'],
      ['⏩', 'Reading speed', 'While a book is read aloud, tap the 1× button on the bar for faster or slower (up to 2×) — it changes at once.'],
      ['💬', 'Nicer quote sharing', 'Pick the look (Paper, Cover colours, Night) with a preview; text set like a book page. The message is just the book and a short “Open in Audiohub” link — and a long note goes in full as text, or share it all as text.'],
      ['📖', 'The ebook follows the audiobook', 'An ebook attached to an audiobook now works for every copy of it — another source, a download — so the Text view shows the book’s real words, not misheard ones.'],
    ],
  },
  {
    id: '2026-10-27',
    title: 'Share what you love',
    items: [
      ['💬', 'Share a quote', 'In Notes, tap Share on a highlight, transcript quote or bookmark: a quote card with a link goes to WhatsApp, Telegram, anywhere.'],
      ['🔗', 'Open shared quotes', 'Tap a shared link to read it — or open it in Audiohub to play from that exact moment (or the passage in the ebook).'],
      ['⬇️', 'Don’t have the book?', 'Get it first; when you play it, the app offers “Jump to the shared quote”.'],
      ['🖍️', 'Highlights stay put', 'Highlights and notes are now also saved in the app’s own files, so a full phone storage can’t lose them — and they’re in backups and sync. They show however you open the book (source, Downloads, another copy).'],
      ['✂️', 'Easier highlighting', 'Long-press a word, then tap Sentence, Paragraph or + Next to select exactly that — no fiddly dragging. The page no longer jumps while you select, and the buttons stay at the bottom.'],
      ['🌐', 'Translate into your language', 'Translate now works in Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Urdu, Spanish, French and more — and 🔊 reads the translation in a natural voice for that language.'],
      ['📖', 'Read a whole book in Hindi', 'In the reader, Text (T) → “Read this book in…”: pages are translated as you read (and kept), and Read aloud speaks them in a natural Hindi (or other) voice.'],
      ['📝', 'This book’s notes, right there', 'In the reader, tap ✎ at the top; in the player, More → Notes. Highlights, notes and bookmarks of that book — from its ebook and its audiobook — to jump to, edit or share.'],
    ],
  },
  {
    id: '2026-10-26',
    title: 'Tags, highlights and Send to Kindle',
    items: [
      ['🏷️', 'Your own tags', 'Add tags like Psychology or Science on any book page, then filter by them in Library → Audiobooks / Ebooks.'],
      ['✍️', 'Highlight what you hear', 'In the player’s Text view, long-press a line to highlight it. It shows up in Notes as a quote — tap it to play from that moment.'],
      ['📚', 'Send to Kindle, directly', 'Add your Kindles and a Gmail app password in Settings → Send to Kindle: Kindle buttons then e-mail the book straight to the Kindle. Several Kindles? You pick one, or all.'],
      ['👋', 'Greeting', 'Type “.” as your name in Settings to be greeted without one.'],
    ],
  },
  {
    id: '2026-10-25',
    title: 'A fresh look and better sources',
    items: [
      ['🎨', 'New look', 'A cleaner font, polished covers (books without one get a printed-jacket cover) and six new light themes: Linen, Cloud, Apricot, Sage, Lilac, Stone & Brass.'],
      ['🔎', 'Sources, tidied', 'Audiobooks first, then ebooks, three of each with “Show more”; readable titles and format badges. Ebook results always say Read, never Play.'],
      ['⚡', 'Fewer hangs', '“Getting the file list” now stops at once with the reason, and problem reports include what TorBox said.'],
    ],
  },
];

const seen = persisted('changesSeen', '');

/** The update box: shown once for the newest entry the app hasn't shown yet. */
export function WhatsNew() {
  const last = useStore(seen);
  const [forced, setForced] = useState(null);
  showWhatsNew = () => setForced(CHANGES[0].id);
  // A brand-new install has nothing to catch up on: remember this version quietly.
  // (Someone updating from before this box existed has books or progress: show the newest.)
  const newInstall = !last && !Object.keys(library.get()).length && !Object.keys(progress.get()).length;
  useEffect(() => {
    if (newInstall) seen.set(CHANGES[0].id);
  }, [newInstall]);
  if (newInstall && !forced) return null;
  const fresh = forced ? CHANGES.slice(0, 2) : last ? CHANGES.filter((c) => c.id > last) : CHANGES.slice(0, 1);
  if (!fresh.length) return null;
  const close = () => {
    seen.set(CHANGES[0].id);
    setForced(null);
  };
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet whats-new" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <small class="wn-kicker">What’s new</small>
        {fresh.map((c) => (
          <section>
            <h3>{c.title}</h3>
            <ul>
              {c.items.map(([icon, head, text]) => (
                <li>
                  <span class="wn-icon">{icon}</span>
                  <span>
                    <b>{head}</b>
                    <small>{text}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button class="btn primary wide" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Open the box again (Settings → What's new). */
export let showWhatsNew = () => {};
