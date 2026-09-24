export const GENRES = [
  // match: tested against a book's genres/tags (Audible categories, Hardcover
  // tags, Audiobookshelf genres) to find it in the user's own libraries.
  { name: 'Mystery', match: /mystery|mysteries|detective|crime|thriller|suspense|noir|whodunit/i, ia: 'mystery OR detective', gb: 'detective', ol: 'mystery', hue: 265 },
  { name: 'Sci‑Fi', match: /science fiction|sci-?fi|space opera|cyberpunk|dystopia|time travel|aliens?/i, ia: 'science fiction', gb: 'science fiction', ol: 'science_fiction', hue: 195 },
  { name: 'Adventure', match: /adventure|action|exploration|survival/i, ia: 'adventure', gb: 'adventure', ol: 'adventure', hue: 28 },
  { name: 'Romance', match: /romance|romantic|love stor/i, ia: 'romance OR love', gb: 'love stories', ol: 'romance', hue: 340 },
  { name: 'Horror', match: /horror|ghost|supernatural|vampire|zombie|haunt/i, ia: 'horror OR ghost', gb: 'horror', ol: 'horror', hue: 0 },
  { name: 'Fantasy', match: /fantasy|magic|dragons?|fairy|myth|epic/i, ia: 'fantasy OR fairy', gb: 'fantasy', ol: 'fantasy', hue: 290 },
  { name: 'Philosophy', match: /philosoph|stoic|ethics|meaning of life/i, ia: 'philosophy', gb: 'philosophy', ol: 'philosophy', hue: 45 },
  { name: 'History', match: /history|historical|biograph|memoir|war/i, ia: 'history', gb: 'history', ol: 'history', hue: 20 },
  { name: 'Poetry', match: /poetry|poems?|verse/i, ia: 'poetry', gb: 'poetry', ol: 'poetry', hue: 310 },
  { name: 'Children', match: /children|kids|juvenile|young adult|teen|middle grade/i, ia: 'children', gb: 'children', ol: 'children', hue: 95 },
  { name: 'Humor', match: /humou?r|comed|funny|satire/i, ia: 'humor OR humour', gb: 'humor', ol: 'humor', hue: 55 },
  { name: 'Old‑Time Radio', match: /radio|drama|theat/i, ia: 'collection:oldtimeradio', gb: 'drama', ol: 'radio', hue: 170 },
];

export const GENRE_EXTRA = [
  { name: 'Self-help', match: /self-help|self help|personal development|productivity|psychology|motivation|success/i, ia: 'self help', gb: 'conduct of life', ol: 'self-help', hue: 160 },
  { name: 'Business', match: /business|finance|money|investing|economics|entrepreneur|management/i, ia: 'business', gb: 'economics', ol: 'business', hue: 200 },
];

GENRES.push(...GENRE_EXTRA);
