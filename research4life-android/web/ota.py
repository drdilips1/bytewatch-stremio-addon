"""Writes ota.json into a built web folder: every file with its SHA-256, the commit time and
the iPhone app's native level the screens need. The iPhone app downloads newer screens with it
(ios/DermScholar/ScreenUpdates.swift)."""
import hashlib, json, os, sys

site, built, min_native = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = {}
for root, dirs, names in os.walk(site):
    dirs[:] = [d for d in dirs if not d.startswith('.')]
    for n in names:
        if n.startswith('.') or n == 'ota.json':
            continue
        p = os.path.join(root, n)
        with open(p, 'rb') as f:
            files[os.path.relpath(p, site).replace(os.sep, '/')] = hashlib.sha256(f.read()).hexdigest()
ident = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
with open(os.path.join(site, 'ota.json'), 'w') as f:
    json.dump({'id': ident, 'built': built, 'minNative': min_native, 'files': files}, f, separators=(',', ':'), sort_keys=True)
print(f'ota.json: {len(files)} files, id {ident}, minNative {min_native}')
