// Sharing a quote: the app's own quote card. (Shared-quote links are Audiohub's.)
import { App } from '../shims/capacitor.js';
export const pendingFor = () => null;
export const clearPending = () => {};
export const findQuoteBlock = () => -1;
export const shareQuote = ({ quote, title, author }) => App.shareQuote({ text: quote, title, author }).then(() => 'shared');
