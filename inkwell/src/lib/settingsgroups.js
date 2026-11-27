// Settings in about ten groups (27 Nov, from Kelp's tidy Settings): the main screen lists the
// groups, each with a one-line summary; a group opens a page with its sections — the same
// sections as before, nothing removed. Search still looks through every setting.
// Every Section title in Settings.jsx belongs to a group (tests/settingsgroups.test.js checks).

export const GROUPS = [
  { id: 'account', icon: 'user', title: 'Account & sync', sections: ['Account & sync', 'Web app'] },
  { id: 'books', icon: 'library', title: 'Your books', band: 'Where your books are', sections: ['Your files on this phone', 'Audiobookshelf', 'Home server (qBittorrent)', 'Tracker', 'Libby (public libraries)'] },
  { id: 'cloud', icon: 'cloud', title: 'Cloud & Usenet', band: 'Where your books are', sections: ['Default debrid', 'TorBox', 'Real-Debrid', '*debrid', 'Usenet (Easynews, indexers)'] },
  { id: 'finding', icon: 'search', title: 'Finding books', band: 'Where your books are', sections: ['Finding your books', 'Addons', 'Sources', 'Metadata providers'] },
  { id: 'playback', icon: 'headphones', title: 'Playback', band: 'The app', sections: ['Playback'] },
  { id: 'voices', icon: 'mic', title: 'Voices & Text', band: 'The app', sections: ['Voices'] },
  { id: 'reading', icon: 'book', title: 'Reading & Kindle', band: 'The app', sections: ['Send to Kindle'] },
  { id: 'appearance', icon: 'palette', title: 'Appearance', band: 'The app', sections: ['Appearance'] },
  { id: 'taste', icon: 'ai', title: 'AI & your taste', band: 'The app', sections: ['AI (bookseller & story helper)', 'Your taste', "Books you've read", 'Hardcover', 'Goodreads'] },
  { id: 'storage', icon: 'database', title: 'Storage & backup', band: 'The app', sections: ['Downloads', 'Storage', 'Data'] },
  { id: 'help', icon: 'info', title: 'Help & about', sections: ['Issues & support'] },
];

/** The group a section belongs to ('*debrid': AllDebrid, Premiumize, Debrid-Link — named by the service). */
export function groupOf(title, { debrid = false } = {}) {
  if (debrid) return 'cloud';
  return GROUPS.find((g) => g.sections.includes(title))?.id || 'help';
}

/** A group with one section opens straight into it (no extra tap to unfold). */
export const soloGroup = (id) => (GROUPS.find((g) => g.id === id)?.sections.length || 0) === 1;
