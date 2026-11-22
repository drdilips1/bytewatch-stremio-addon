// For Audibrisk's public build (used by rebrand.mjs, tested in brisk.test.js): empty the shared
// Android code's methods for Audiohub+-only sites, and take those sites' names out of it.

/** Where a method's body ends: braces counted outside strings, characters and comments. */
function bodyEnd(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    const two = code.slice(i, i + 2);
    if (two === '//') i = code.indexOf('\n', i);
    else if (two === '/*') i = code.indexOf('*/', i) + 1;
    else if (code.startsWith('"""', i)) i = code.indexOf('"""', i + 3) + 2;
    else if (c === '"' || c === "'") {
      for (i++; code[i] !== c; i++) if (code[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    if (i < 0) break;
  }
  throw new Error('Could not find the end of a method');
}
export function emptyMethods(code, names) {
  for (const name of names) {
    const at = code.indexOf(`public void ${name}(PluginCall call)`);
    if (at < 0) throw new Error(`${name} has moved — update brisk/rebrand.mjs`);
    const open = code.indexOf('{', at);
    const end = bodyEnd(code, open);
    code = code.slice(0, open + 1) + '\n        call.reject("Not part of Audibrisk");\n    ' + code.slice(end);
  }
  return code;
}
export function publicJava(code) {
  return code
    // Block comments that start a line (never "*/*" inside a string).
    .replace(/^(\s*)\/\*[\s\S]*?\*\//gm, (m, lead) => (/bookshare|mobilism|libby|annas|myanonamouse|\bMAM\b/i.test(m) ? `${lead}/* */` : m))
    // Only real comments: a whole line, or after code (never the // inside "https://…").
    .replace(/(^\s*|[;{}),]\s+)\/\/.*$/gm, (m, lead) => (/bookshare|mobilism|libby|annas|myanonamouse|\bMAM\b/i.test(m) ? `${lead}//` : m))
    .replace(/\bbookshareGet\b/g, 'siteBookGet')
    .replace(/mobilism\.org/g, 'site-a.invalid')
    .replace(/annas-archive/g, 'site-b.invalid')
    .replace(/Bookshare/g, 'the site');
}
