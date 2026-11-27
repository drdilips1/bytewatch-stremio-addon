"""Ask App Store Connect what happened to Narrato's uploaded builds (processing, valid or rejected, and why).

Uses the App Store Connect API key from the GitHub secrets; prints no secrets. Optional argument: minutes to
keep waiting while the newest build is still processing.
"""
import json, os, sys, time, urllib.error, urllib.request
import jwt  # PyJWT

BUNDLE = "com.narrato.reader"
API = "https://api.appstoreconnect.apple.com"


def token():
    kid, iss = os.environ["ASC_KEY_ID"].strip(), os.environ["ASC_ISSUER_ID"].strip()
    key = os.environ.get("ASC_KEY_P8", "").strip()
    if not key:
        import base64
        key = base64.b64decode(os.environ["ASC_KEY_P8_B64"]).decode()
    now = int(time.time())
    return jwt.encode({"iss": iss, "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})


def get(path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token()})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"http_error": e.code, "body": e.read().decode()[:2000]}


def report():
    apps = get(f"/v1/apps?filter[bundleId]={BUNDLE}")
    if not apps.get("data"):
        print("No App Store Connect app with bundle ID", BUNDLE, "for this API key's team:", json.dumps(apps)[:1500])
        return None
    app = apps["data"][0]
    print(f"App: {app['attributes'].get('name')}  id {app['id']}  bundle {app['attributes'].get('bundleId')}")

    builds = get(f"/v1/builds?filter[app]={app['id']}&sort=-uploadedDate&limit=15&include=preReleaseVersion,buildBetaDetail")
    versions = {i["id"]: i["attributes"].get("version") for i in builds.get("included", []) if i["type"] == "preReleaseVersions"}
    beta = {i["id"]: i["attributes"] for i in builds.get("included", []) if i["type"] == "buildBetaDetails"}
    newest = None
    print("\nBuilds Apple has (newest first):")
    for b in builds.get("data", []):
        a = b["attributes"]
        pv = (b["relationships"].get("preReleaseVersion", {}).get("data") or {}).get("id")
        bd = (b["relationships"].get("buildBetaDetail", {}).get("data") or {}).get("id")
        print(f"  {versions.get(pv, '?')} ({a.get('version')})  state {a.get('processingState')}  "
              f"uploaded {a.get('uploadedDate')}  expired {a.get('expired')}  "
              f"testflight {beta.get(bd, {}).get('internalBuildState')}")
        newest = newest or a.get("processingState")
    if not builds.get("data"):
        print("  none", json.dumps(builds)[:1500])

    # Upload records carry Apple's error messages for uploads that were rejected while processing.
    ups = get(f"/v1/apps/{app['id']}/buildUploads?limit=15")
    if "http_error" in ups:
        print("\nbuildUploads:", ups["http_error"], ups["body"][:500])
    else:
        print("\nUploads (newest first):")
        first = True
        for u in sorted(ups.get("data", []), key=lambda u: u["attributes"].get("uploadedDate") or "", reverse=True):
            a = u["attributes"]
            print(f"  {a.get('cfBundleShortVersionString')} ({a.get('cfBundleVersion')})  "
                  f"{json.dumps(a.get('state'))}")
            if first:
                first = False
                up = (a.get("state") or {}).get("state")
                if up in ("PROCESSING", "AWAITING_UPLOAD") or (up == "COMPLETE" and newest in (None, "PROCESSING")):
                    newest = "PROCESSING"
                elif up == "FAILED":
                    newest = "FAILED"
    return newest


def done(state):
    print(f"\nNewest upload: {state}")
    if state == "FAILED":
        sys.exit("Apple rejected the newest upload: see its errors above.")


wait = float(sys.argv[1]) if len(sys.argv) > 1 else 0
end = time.time() + wait * 60
while True:
    state = report()
    if state != "PROCESSING" or time.time() > end:
        done(state)
        break
    print("\nStill processing; asking again in 2 minutes.\n")
    time.sleep(120)
