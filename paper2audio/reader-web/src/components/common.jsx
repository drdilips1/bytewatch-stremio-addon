// Toasts, as in Audiohub (components/common.jsx).
import { useEffect, useState } from 'preact/hooks';

let toastSet;
export function Toaster() {
  const [msg, setMsg] = useState(null);
  toastSet = setMsg;
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div class="toast">{msg.text || msg}</div> : null;
}
export const toast = (text) => toastSet?.({ text, t: Date.now() });
