// Lesionaut Tools: dermatology scores and clinical calculators, scored as you tap.
// Standard published formulas; the clinician checks and corrects every input.
(() => {
  'use strict';
  const L = window.LX;
  const { $, $$, esc, icon, store, bar, actions, routes } = L;
  const view = () => $('#view');

  const AREA = ['0', '<10%', '10–29', '30–49', '50–69', '70–89', '90–100'];
  const REG4 = [['h', 'Head and neck'], ['u', 'Upper limbs'], ['t', 'Trunk'], ['l', 'Lower limbs']];
  const opt = (k, label, opts, hint) => ({ k, label, opts, hint });
  const num = (k, label, unit, max) => ({ k, label, num: true, unit, max });
  const v = (s, k) => +(s[k] || 0);
  const band = (x, bands) => (bands.find(([lim]) => x <= lim) || bands[bands.length - 1])[1];

  const TOOLS = {
    pasi: { name: 'PASI', full: 'Psoriasis Area and Severity Index', group: 'Psoriasis',
      sections: REG4.map(([r, n]) => ({ title: n, items: [opt(r + 'E', 'Erythema', [0, 1, 2, 3, 4]), opt(r + 'I', 'Induration', [0, 1, 2, 3, 4]), opt(r + 'S', 'Scaling', [0, 1, 2, 3, 4]), opt(r + 'A', 'Area involved', AREA.map((_, i) => i), AREA)] })),
      calc(s) { const W = { h: 0.1, u: 0.2, t: 0.3, l: 0.4 }; const x = REG4.reduce((a, [r]) => a + W[r] * (v(s, r + 'E') + v(s, r + 'I') + v(s, r + 'S')) * v(s, r + 'A'), 0); return [x.toFixed(1), `of 72 · ${band(x, [[5, 'mild'], [10, 'moderate'], [72, 'severe']])} (PASI >10 often taken as severe)`]; } },
    easi: { name: 'EASI', full: 'Eczema Area and Severity Index', group: 'Atopic dermatitis',
      sections: [{ title: 'Age', items: [opt('age', 'Patient age', [0, 1], ['8 years or older', 'Under 8'])] }, ...REG4.map(([r, n]) => ({ title: n, items: [opt(r + 'E', 'Erythema', [0, 1, 2, 3]), opt(r + 'O', 'Oedema / papulation', [0, 1, 2, 3]), opt(r + 'X', 'Excoriation', [0, 1, 2, 3]), opt(r + 'L', 'Lichenification', [0, 1, 2, 3]), opt(r + 'A', 'Area involved', AREA.map((_, i) => i), AREA)] }))],
      calc(s) { const W = v(s, 'age') ? { h: 0.2, u: 0.2, t: 0.3, l: 0.3 } : { h: 0.1, u: 0.2, t: 0.3, l: 0.4 }; const x = REG4.reduce((a, [r]) => a + W[r] * (v(s, r + 'E') + v(s, r + 'O') + v(s, r + 'X') + v(s, r + 'L')) * v(s, r + 'A'), 0); return [x.toFixed(1), `of 72 · ${band(x, [[0, 'clear'], [1, 'almost clear'], [7, 'mild'], [21, 'moderate'], [50, 'severe'], [72, 'very severe']])}`]; } },
    scorad: { name: 'SCORAD', full: 'SCORing Atopic Dermatitis', group: 'Atopic dermatitis',
      sections: [{ title: 'A · Extent', items: [num('A', 'Body surface involved (rule of nines)', '%', 100)] },
        { title: 'B · Intensity (representative area)', items: ['Erythema', 'Oedema / papulation', 'Oozing / crusts', 'Excoriation', 'Lichenification', 'Dryness (uninvolved skin)'].map((n, i) => opt('B' + i, n, [0, 1, 2, 3])) },
        { title: 'C · Symptoms (average of last 3 days)', items: [num('itch', 'Itch (0–10)', '', 10), num('sleep', 'Sleep loss (0–10)', '', 10)] }],
      calc(s) { const B = [0, 1, 2, 3, 4, 5].reduce((a, i) => a + v(s, 'B' + i), 0); const o = v(s, 'A') / 5 + 3.5 * B; const x = o + v(s, 'itch') + v(s, 'sleep'); return [x.toFixed(1), `of 103 · ${band(x, [[24.9, 'mild'], [50, 'moderate'], [103, 'severe']])} · objective SCORAD ${o.toFixed(1)}`]; } },
    salt: { name: 'SALT', full: 'Severity of Alopecia Tool', group: 'Hair',
      sections: [{ title: '% of each scalp area with hair loss', items: [num('v', 'Vertex (top) · 40% of scalp', '%', 100), num('p', 'Posterior · 24%', '%', 100), num('r', 'Right side · 18%', '%', 100), num('lft', 'Left side · 18%', '%', 100)] }],
      calc(s) { const x = 0.4 * v(s, 'v') + 0.24 * v(s, 'p') + 0.18 * v(s, 'r') + 0.18 * v(s, 'lft'); return [x.toFixed(0), `% scalp hair loss · ${band(x, [[0, 'no loss'], [20, 'S1 (≤20%)'], [49, 'S2'], [74, 'S3'], [99, 'S4'], [100, 'S5 (total)']])}`]; } },
    vasi: { name: 'VASI', full: 'Vitiligo Area Scoring Index', group: 'Pigmentary',
      sections: [['hd', 'Hands'], ['ue', 'Upper extremities'], ['tr', 'Trunk'], ['le', 'Lower extremities'], ['ft', 'Feet'], ['hn', 'Head and neck']].map(([r, n]) => ({ title: n, items: [num(r + 'U', 'Area in hand units (1 HU ≈ 1% BSA)', 'HU', 100), opt(r + 'D', 'Residual depigmentation', [0, 10, 25, 50, 75, 90, 100], ['0', '10%', '25%', '50%', '75%', '90%', '100%'])] })),
      calc(s) { const x = ['hd', 'ue', 'tr', 'le', 'ft', 'hn'].reduce((a, r) => a + v(s, r + 'U') * v(s, r + 'D') / 100, 0); return [x.toFixed(1), 'total VASI (0–100) · facial VASI is scored separately'];} },
    uas7: { name: 'UAS7', full: 'Urticaria Activity Score over 7 days', group: 'Urticaria',
      sections: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ title: 'Day ' + d, items: [opt('w' + d, 'Wheals', [0, 1, 2, 3], ['none', '<20', '20–50', '>50']), opt('i' + d, 'Itch', [0, 1, 2, 3], ['none', 'mild', 'moderate', 'intense'])] })),
      calc(s) { const x = [1, 2, 3, 4, 5, 6, 7].reduce((a, d) => a + v(s, 'w' + d) + v(s, 'i' + d), 0); return [x, `of 42 · ${band(x, [[0, 'urticaria-free'], [6, 'well controlled'], [15, 'mild'], [27, 'moderate'], [42, 'severe']])}`]; } },
    dlqi: { name: 'DLQI', full: 'Dermatology Life Quality Index (last week)', group: 'Quality of life',
      sections: [{ title: 'Over the last week, how much has the skin…', items: ['Itch, soreness, pain or stinging', 'Embarrassment or self-consciousness', 'Interfered with shopping, home or garden', 'Influenced the clothes worn', 'Affected social or leisure activities', 'Made sport difficult', 'Prevented work or study (or been a problem there)', 'Caused problems with partner, friends or relatives', 'Caused sexual difficulties', 'Treatment been a problem (mess, time)']
        .map((n, i) => opt('q' + i, n, [0, 1, 2, 3], ['not at all', 'a little', 'a lot', 'very much'])) }],
      calc(s) { const x = [...Array(10).keys()].reduce((a, i) => a + v(s, 'q' + i), 0); return [x, `of 30 · ${band(x, [[1, 'no effect'], [5, 'small effect'], [10, 'moderate effect'], [20, 'very large effect'], [30, 'extremely large effect']])} on life`]; }, note: 'Labels paraphrase the published DLQI (Finlay & Khan, 1994); use the official questionnaire for formal scoring.' },
    gags: { name: 'GAGS', full: 'Global Acne Grading System', group: 'Acne',
      sections: [{ title: 'Worst lesion in each area', items: [['fh', 'Forehead (×2)'], ['rc', 'Right cheek (×2)'], ['lc', 'Left cheek (×2)'], ['no', 'Nose (×1)'], ['ch', 'Chin (×1)'], ['cb', 'Chest and upper back (×3)']].map(([k, n]) => opt(k, n, [0, 1, 2, 3, 4], ['none', 'comedone', 'papule', 'pustule', 'nodule'])) }],
      calc(s) { const x = 2 * (v(s, 'fh') + v(s, 'rc') + v(s, 'lc')) + v(s, 'no') + v(s, 'ch') + 3 * v(s, 'cb'); return [x, `of 44 · ${band(x, [[0, 'none'], [18, 'mild'], [30, 'moderate'], [38, 'severe'], [44, 'very severe']])}`]; } },
    bsa: { name: 'BSA & BMI', full: 'Body surface area (Mosteller) and body-mass index', group: 'General',
      sections: [{ title: 'Patient', items: [num('h', 'Height', 'cm', 250), num('w', 'Weight', 'kg', 300)] }],
      calc(s) { const h = v(s, 'h'), w = v(s, 'w'); if (!h || !w) return ['–', 'enter height and weight']; const bsa = Math.sqrt(h * w / 3600), bmi = w / ((h / 100) ** 2); return [bsa.toFixed(2) + ' m²', `BMI ${bmi.toFixed(1)} kg/m² (${band(bmi, [[18.4, 'underweight'], [22.9, 'normal (Asian cut-offs)'], [24.9, 'overweight (Asian)'], [99, 'obese (Asian ≥25)']])})`]; } },
    egfr: { name: 'eGFR', full: 'CKD-EPI 2021 (creatinine, race-free)', group: 'General',
      sections: [{ title: 'Patient', items: [num('age', 'Age', 'years', 120), opt('sex', 'Sex', [0, 1], ['female', 'male']), num('cr', 'Serum creatinine', '', 3000), opt('unit', 'Unit', [0, 1], ['mg/dL', 'µmol/L'])] }],
      calc(s) { const age = v(s, 'age'); let cr = v(s, 'cr'); if (!age || !cr) return ['–', 'enter age and creatinine']; if (v(s, 'unit')) cr /= 88.4; const f = !v(s, 'sex'); const k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
        const e = 142 * Math.min(cr / k, 1) ** a * Math.max(cr / k, 1) ** -1.2 * 0.9938 ** age * (f ? 1.012 : 1); return [Math.round(e), `mL/min/1.73 m² · ${band(e, [[14, 'G5'], [29, 'G4'], [44, 'G3b'], [59, 'G3a'], [89, 'G2'], [999, 'G1']])}`]; } },
  };

  routes.tools = () => {
    const groups = {};
    Object.entries(TOOLS).forEach(([k, t]) => (groups[t.group] ||= []).push([k, t]));
    view().innerHTML = `${bar('Tools', { back: false })}
      ${Object.entries(groups).map(([g, ts]) => `<div class="sec"><div class="sec-h"><h3>${esc(g)}</h3></div><div class="card list">${ts.map(([k, t]) => `<button class="li" data-act="go" data-to="tool/${k}"><span class="ph">${icon('tools')}</span><span><b>${esc(t.name)}</b><small>${esc(t.full)}</small></span>${icon('chev')}</button>`).join('')}</div></div>`).join('')}
      <p class="disc">Standard published formulas. Check every input; scores support, not replace, clinical judgement.</p>`;
  };

  routes.tool = (k, params = {}) => {
    const t = TOOLS[k];
    if (!t) { L.go('tools', { replace: true }); return; }
    // Opened from History: the saved inputs come back.
    if (params.from) { const saved = store.get('histTool', null); if (saved?.tool === k) store.set('tool.' + k, saved.state); }
    const s = store.get('tool.' + k, {});
    view().innerHTML = `${bar(t.name, { right: `<button class="ib" data-act="tool-reset" data-k="${k}" aria-label="Reset">${icon('refresh')}</button>` })}
      <div class="calc-out"><b id="t-val"></b><span id="t-band"></span></div>
      <p class="muted small" style="margin-top:0">${esc(t.full)}</p>
      ${t.sections.map((sec) => `<div class="card region" style="margin-bottom:10px"><h4>${esc(sec.title)}</h4>${sec.items.map((it) => `<div class="sc"><span>${esc(it.label)}</span>${it.num
        ? `<input class="in" type="number" inputmode="decimal" min="0" ${it.max ? `max="${it.max}"` : ''} data-num="${it.k}" value="${s[it.k] ?? ''}" placeholder="${esc(it.unit || '')}">`
        : `<div class="opts">${it.opts.map((o, i) => `<button class="${+(s[it.k] ?? (it.opts[0])) === o && (s[it.k] !== undefined || i === 0) ? 'on' : ''}" data-opt="${it.k}" data-v="${o}">${esc(it.hint ? it.hint[i] : o)}</button>`).join('')}</div>`}</div>`).join('')}</div>`).join('')}
      ${t.note ? `<p class="disc">${esc(t.note)}</p>` : ''}
      <button class="btn full" data-act="tool-share" data-k="${k}">${icon('share')}Share result</button>`;
    // Each visit to a calculator is one History entry, saved a moment after the last tap.
    const hid = 'calc-' + k + '-' + Date.now().toString(36);
    let keepT = 0, touched = false;
    const update = () => {
      const [val, b] = t.calc(s); $('#t-val').textContent = val; $('#t-band').textContent = b; store.set('tool.' + k, s);
      if (!touched) return;
      clearTimeout(keepT);
      keepT = setTimeout(() => L.DB.hist.put({ id: hid, kind: 'score', title: `${t.name} ${val}`, sub: b, data: { tool: k, state: { ...s }, val: String(val), band: b } }).catch(() => {}), 1500);
    };
    $$('[data-opt]').forEach((b) => b.addEventListener('click', () => { touched = true; s[b.dataset.opt] = +b.dataset.v; $$(`[data-opt="${b.dataset.opt}"]`).forEach((x) => x.classList.toggle('on', x === b)); update(); }));
    $$('[data-num]').forEach((el) => el.addEventListener('input', () => { touched = true; s[el.dataset.num] = el.value === '' ? undefined : +el.value; update(); }));
    update();
  };
  actions['tool-reset'] = (b) => { store.set('tool.' + b.dataset.k, {}); routes.tool(b.dataset.k); };
  actions['tool-share'] = (b) => { const t = TOOLS[b.dataset.k]; L.share(t.name, `${t.full}: ${$('#t-val').textContent} (${$('#t-band').textContent}) — calculated in Lesionaut, ${new Date().toLocaleDateString()}`); };
  L.TOOLS = TOOLS;
})();
