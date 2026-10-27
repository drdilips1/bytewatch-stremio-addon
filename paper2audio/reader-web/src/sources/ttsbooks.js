// "Listen as an audiobook": the app's own player does that (Listen).
export const canNarrate = () => false;
export const narrate = () => Promise.reject(new Error('Not available'));
