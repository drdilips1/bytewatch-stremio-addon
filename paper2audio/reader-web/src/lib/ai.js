// The AI of Paper to Audio (its key and provider). Narrato has none.
import { App, appHas } from '../shims/capacitor.js';
export const aiReady = () => appHas('P2AAi');
export async function askAi(prompt) {
  const r = await App.askAi({ prompt });
  return r.text || '';
}
export function parseJson(text) {
  const m = /[[{][\s\S]*[\]}]/.exec(String(text || ''));
  return m ? JSON.parse(m[0]) : null;
}
