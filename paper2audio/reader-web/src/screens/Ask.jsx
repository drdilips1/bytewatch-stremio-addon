// The answer's formatting, as in Audiohub (screens/Ask.jsx).

/** Light formatting for answers: paragraphs, bullet/numbered lists, **bold**, ### headings. */
export function Answer({ text }) {
  const inline = (s) =>
    String(s)
      .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)
      .map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? <b>{p.slice(2, -2)}</b> : /^(\*[^*]+\*|_[^_]+_)$/.test(p) ? <i>{p.slice(1, -1)}</i> : p));
  const blocks = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) blocks.push((list = { list: true, ordered: /\d/.test(bullet[1]), items: [] }));
      list.items.push(bullet[2]);
      continue;
    }
    list = null;
    if (!line) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(h ? { h: h[1] } : { p: line });
  }
  return (
    <div class="ask-answer">
      {blocks.map((b) =>
        b.list ? (
          b.ordered ? (
            <ol>{b.items.map((i) => <li>{inline(i)}</li>)}</ol>
          ) : (
            <ul>{b.items.map((i) => <li>{inline(i)}</li>)}</ul>
          )
        ) : b.h ? (
          <h4>{inline(b.h)}</h4>
        ) : (
          <p>{inline(b.p)}</p>
        )
      )}
    </div>
  );
}
