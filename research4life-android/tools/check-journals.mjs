// Checks that every curated journal query returns articles from Europe PMC.
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../app/src/main/assets/www/journals.js', import.meta.url), 'utf8'), ctx);
const journals = ctx.window.JOURNALS;
const query = (j) => (j.issn ? `(ISSN:"${j.issn}" OR JOURNAL:"${j.abbr}")` : `JOURNAL:"${j.abbr}"`);

let failed = 0;
for (const j of journals) {
  const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' +
    new URLSearchParams({ query: query(j), format: 'json', pageSize: '1', resultType: 'lite' });
  const res = await fetch(url).then((r) => r.json()).catch(() => null);
  const hits = res?.hitCount ?? -1;
  const got = res?.resultList?.result?.[0]?.journalTitle ?? '';
  if (hits <= 0) failed++;
  console.log(`${hits > 0 ? 'ok  ' : 'FAIL'} ${String(hits).padStart(7)}  ${j.abbr}  ${got && got !== j.abbr ? '(' + got + ')' : ''}`);
}
console.log(failed ? `${failed} journal queries returned nothing` : 'All journal queries return articles');
process.exit(failed ? 1 : 0);
