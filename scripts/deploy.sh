#!/usr/bin/env bash
# Build and deploy to Cloudflare Workers.
#
# Wraps `nitro deploy --prebuilt` because Cloudflare auto-enables a
# "Preview URL" (an extra public hostname per deployment) unless
# `preview_urls: false` is set in wrangler.json -- and that file is
# regenerated fresh on every build, so the flag can't just be committed
# once. This patches it in after each build, before deploying.
#
# It also clamps `compatibility_date`, which Nitro stamps from the local
# system clock: if this machine's clock is ever set ahead of real time
# (e.g. a sandboxed/dev environment), Cloudflare's API rejects the deploy
# with "Can't set compatibility date in the future". Cloudflare's own
# response Date header is used as ground truth instead of trusting the
# local clock.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

python3 -c "
import json
import urllib.request
from email.utils import parsedate_to_datetime
from datetime import timedelta

path = '.output/server/wrangler.json'
with open(path) as f:
    d = json.load(f)

with urllib.request.urlopen('https://api.cloudflare.com/client/v4/ips', timeout=10) as resp:
    server_now = parsedate_to_datetime(resp.headers['Date'])
safe_date = (server_now - timedelta(days=1)).strftime('%Y-%m-%d')

if d.get('compatibility_date', '9999-99-99') > safe_date:
    d['compatibility_date'] = safe_date
d['preview_urls'] = False

with open(path, 'w') as f:
    json.dump(d, f, indent=2)
"

npx wrangler --cwd .output/ deploy
