// Stats → "Your year in books": the picture, made on the phone, with Share.
import { useEffect, useState } from 'preact/hooks';
import { yearStats, yearCard, shareYear } from '../lib/yearcard.js';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';

export function YearButton() {
  const [img, setImg] = useState(null);
  const [open, setOpen] = useState(false);
  const y = yearStats();
  useEffect(() => {
    if (!open || img) return;
    yearCard(y).then(setImg).catch((e) => toast(e.message || "Couldn't make the picture"));
  }, [open]);
  if (!y.hours && !y.finished) return null;
  return (
    <>
      <button class="year-btn" onClick={() => setOpen(true)}>
        <span>
          <small>Your {y.year} in books</small>
          <b>
            {y.hours} h · {y.finished} finished
          </b>
        </span>
        <Icon name="arrow" size={18} />
      </button>
      {open && (
        <div class="sheet-backdrop" onClick={() => setOpen(false)}>
          <div class="sheet year-sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            {img ? <img src={img} alt={`Your ${y.year} in books`} /> : <div class="year-wait"><span class="spinner" /></div>}
            <button class="btn primary" disabled={!img} onClick={() => shareYear(img).catch(() => {})}>
              Share
            </button>
          </div>
        </div>
      )}
    </>
  );
}
