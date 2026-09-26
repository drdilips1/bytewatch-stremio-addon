# Bookracy search proxy (Cloudflare Worker)

A small CORS-enabled proxy in front of the Bookracy books API. It normalizes results into a
torrent-style shape (`title`, `author`, `url`, `format`, `language`, `posted`, ...).

## Endpoint

```
GET /bookracy/search?q=<query>
```

Returns `{ "results": [...] }`. An empty query returns an empty list. When the upstream request fails,
the response is still `200` with `results: []` and an `error` message.

## Deploy

```bash
cd workers/bookracy-proxy
npx wrangler deploy
```

Local dev: `npx wrangler dev`, then open `http://localhost:8787/bookracy/search?q=dune`.
