// The audio type of a file from its name, for iPhone's player: cloud links (TorBox, Real-Debrid)
// often have no extension and come labelled as a plain file. Apple's player works MP3 out by
// itself but won't open an MP4 / M4B it isn't told about — "plays on Android, not on iPhone".
// Only the MP4 family: MP3 and the rest already play, and are left exactly as they were.
const TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4a: 'audio/mp4' };
/** 'Book 01.mp4' → 'video/mp4'; '' when unknown (the player then guesses as before). */
export function mimeFor(name) {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(String(name || '').trim())?.[1]?.toLowerCase();
  return (ext && TYPES[ext]) || '';
}
