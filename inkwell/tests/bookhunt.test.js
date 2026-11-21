// Book Hunt worker: reading Anna's Archive's search page and Mobilism's pages (no network).
import { describe, it, expect } from 'vitest';
import { annasResults, mobTopics, mobTopic } from '../workers/bookhunt.js';

describe("Anna's Archive results", () => {
  it('one result per file, with title, author, format, size and cover', () => {
    const html = `<div><a href="/md5/0123456789abcdef0123456789abcdef" class="x"><img src="/covers/a.jpg"><h3 class="text-xl">Atomic Habits</h3><div class="italic">James Clear</div><div class="text-gray-500">English [en], .epub, lgli, 1.2MB, 2018</div></a></div>
    <!-- <a href="/md5/fedcba9876543210fedcba9876543210"><h3>Dune</h3><div class="italic">Frank Herbert</div><div class="text-gray-500">English [en], pdf, 45.0MB</div></a> -->`;
    const r = annasResults(html, 'https://annas-archive.org');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ md5: '0123456789abcdef0123456789abcdef', title: 'Atomic Habits', author: 'James Clear', format: 'EPUB', language: 'en', cover: 'https://annas-archive.org/covers/a.jpg' });
    expect(r[0].sizeBytes).toBe(Math.round(1.2 * 1048576));
    expect(r[1]).toMatchObject({ title: 'Dune', format: 'PDF' });
  });
});

describe('Mobilism pages', () => {
  it('topics on a search page', () => {
    const html = `<a href="./viewtopic.php?f=124&amp;t=555" class="topictitle">Andy Weir - Project Hail Mary (Audiobook) [MP3]</a><a href="./viewtopic.php?f=124&amp;t=555" class="topictitle">dup</a>`;
    expect(mobTopics(html)).toEqual([{ id: '555', title: 'Andy Weir - Project Hail Mary (Audiobook) [MP3]' }]);
  });
  it("a topic's file-host links", () => {
    const html = `<div class="content">Narrated by Ray Porter<br><a class="postlink" href="https://rapidgator.net/file/abc">part1</a> <a href="https://nitroflare.com/view/x" class="postlink">x</a> <a class="postlink" href="https://forum.mobilism.org/x">no</a></div><dl>`;
    const t = mobTopic(html);
    expect(t.downloads).toEqual([{ url: 'https://rapidgator.net/file/abc', host: 'rapidgator.net' }, { url: 'https://nitroflare.com/view/x', host: 'nitroflare.com' }]);
    expect(t.text).toContain('Narrated by Ray Porter');
  });
});
