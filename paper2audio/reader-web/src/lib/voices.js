// Audiohub's own downloaded voices aren't used here: the app reads with its voices.
export const builtinAvailable = false;
export const render = () => Promise.reject(new Error('Not available'));
export const playableUrl = (u) => u;
export const Voices = { clearCache: () => Promise.resolve() };
export const byId = () => null;
