// Settings in about ten groups (27 Nov, from Kelp's tidy Settings): the main screen lists the
// groups, each with a one-line summary; a group opens a page with its sections — the same
// sections as before, nothing removed. Search still looks through every setting.
// Every Section title in Settings.jsx belongs to a group (tests/settingsgroups.test.js checks).

export const GROUPS = [
  { id: 'account', hue: '#5b7cfa', icon: 'user', title: 'Account & sync', sections: ['Account & sync', 'Web app'] },
  { id: 'books', hue: '#14b8a6', icon: 'library', title: 'Your books', band: 'Where your books are', sections: ['Your files on this phone', 'Audiobookshelf', 'Home server (qBittorrent)', 'Tracker', 'Libby (public libraries)'] },
  { id: 'cloud', hue: '#3b82f6', icon: 'cloud', title: 'Cloud & Usenet', band: 'Where your books are', sections: ['Default debrid', 'TorBox', 'Real-Debrid', '*debrid', 'Usenet (Easynews, indexers)'] },
  { id: 'finding', hue: '#8b5cf6', icon: 'search', title: 'Finding books', band: 'Where your books are', sections: ['Finding your books', 'Addons', 'Sources', 'Metadata providers'] },
  { id: 'playback', hue: '#ec4899', icon: 'headphones', title: 'Playback', band: 'The app', sections: ['Playback'] },
  { id: 'voices', hue: '#06b6d4', icon: 'mic', title: 'Voices & Text', band: 'The app', sections: ['Voices'] },
  { id: 'reading', hue: '#6366f1', icon: 'book', title: 'Reading & Kindle', band: 'The app', sections: ['Send to Kindle'] },
  { id: 'appearance', hue: '#d946ef', icon: 'palette', title: 'Appearance', band: 'The app', sections: ['Appearance'] },
  { id: 'taste', hue: '#a855f7', icon: 'ai', title: 'AI & your taste', band: 'The app', sections: ['AI (bookseller & story helper)', 'Your taste', "Books you've read", 'Hardcover', 'Goodreads'] },
  { id: 'storage', hue: '#64748b', icon: 'database', title: 'Storage & backup', band: 'The app', sections: ['Downloads', 'Storage', 'Data'] },
  { id: 'help', hue: '#0ea5e9', icon: 'info', title: 'Help & about', sections: ['Issues & support'] },
];

/** The group a section belongs to ('*debrid': AllDebrid, Premiumize, Debrid-Link — named by the service). */
export function groupOf(title, { debrid = false } = {}) {
  if (debrid) return 'cloud';
  return GROUPS.find((g) => g.sections.includes(title))?.id || 'help';
}

/** A group with one section opens straight into it (no extra tap to unfold). */
export const soloGroup = (id) => (GROUPS.find((g) => g.id === id)?.sections.length || 0) === 1;
