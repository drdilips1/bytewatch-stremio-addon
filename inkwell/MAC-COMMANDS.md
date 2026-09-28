# Mac commands for Audiohub

Everyday Terminal commands for the home server (Audiobookshelf + Tailscale).

## Audiobookshelf

| What | Command |
|---|---|
| Start it (with web app access) | `cd ~/audiobookshelf-server && ALLOW_CORS=1 npm start` |
| Stop it (in its own window) | Press **Ctrl + C** |
| Stop it from anywhere ("address already in use") | `lsof -ti :3333 \| xargs kill` |
| Check nothing is left on port 3333 (prints nothing when free) | `lsof -ti :3333` |
| Force-stop if it won't go | `lsof -ti :3333 \| xargs kill -9` |

### One-word restart (set up once)

```
echo 'alias abs-restart="lsof -ti :3333 | xargs kill; sleep 2; cd ~/audiobookshelf-server && ALLOW_CORS=1 npm start"' >> ~/.zshrc && source ~/.zshrc
```

After that, type `abs-restart` to stop the old server and start a fresh one with web app access.

## Tailscale

| What | Command |
|---|---|
| Show devices and names | `/Applications/Tailscale.app/Contents/MacOS/Tailscale status` |
| Give Audiobookshelf an https address | `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3333` |
| See what's being served | `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status` |
| Turn the https address off | `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=443 off` |

Shortcut so you can type `tailscale` instead of the long path (set up once):

```
echo 'alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"' >> ~/.zshrc && source ~/.zshrc
```

## Addresses

| What | Address |
|---|---|
| Audiohub web app | https://drdilips1.github.io/bytewatch-stremio-addon/ |
| Audiobookshelf over https (Tailscale) | https://macbook.tailef5622.ts.net |
| Audiobookshelf via Tailscale IP | http://100.93.52.89:3333 |
| Audiobookshelf at home | http://192.168.31.98:3333 |
| Web relay (Cloudflare Worker) | https://audiohub-relay.drdilipgreat.workers.dev |
