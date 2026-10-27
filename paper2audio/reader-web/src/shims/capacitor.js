// Audiohub's reader talks to Android through Capacitor plugins. Here the same calls go to
// Paper to Audio / Narrato (window.P2AReader, a WebView bridge), which answer them with
// their own player, voices, files and AI. Every call is async: the app answers through
// window.__p2aDone(id, json) and sends plugin events through window.__p2aEvent.
const bridge = typeof window !== 'undefined' ? window.P2AReader : null;
const waiting = new Map();
const listeners = new Map(); // "plugin:event" -> Set(callback)
let nextId = 1;

if (typeof window !== 'undefined') {
  window.__p2aDone = (id, json) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    const r = JSON.parse(json || '{}');
    if (r && r.__error) w.reject(new Error(r.__error));
    else w.resolve(r);
  };
  window.__p2aEvent = (plugin, event, json) => {
    const data = JSON.parse(json || '{}');
    (listeners.get(plugin + ':' + event) || []).forEach((f) => f(data));
  };
}

const available = new Set(bridge ? JSON.parse(bridge.plugins()) : []);

export const Capacitor = {
  isNativePlatform: () => !!bridge,
  isPluginAvailable: (name) => available.has(name),
  getPlatform: () => (bridge ? 'android' : 'web'),
};

export function registerPlugin(name) {
  return new Proxy(
    {},
    {
      get(_, method) {
        if (method === 'then') return undefined; // not a promise itself
        if (method === 'addListener')
          return (event, cb) => {
            const key = name + ':' + event;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(cb);
            return Promise.resolve({ remove: () => listeners.get(key)?.delete(cb) });
          };
        return (args = {}) =>
          new Promise((resolve, reject) => {
            if (!bridge || !available.has(name)) return reject(new Error('Not available'));
            const id = nextId++;
            waiting.set(id, { resolve, reject });
            bridge.call(id, name, String(method), JSON.stringify(args ?? {}));
          });
      },
    }
  );
}

/** The app's own calls (book, voice, close…), as a plugin. */
export const App = registerPlugin('P2AReader');
export const appHas = (name) => available.has(name);
