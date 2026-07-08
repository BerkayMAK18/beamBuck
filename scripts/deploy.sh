#!/usr/bin/env bash
# Build and deploy to Cloudflare Workers.
#
# Wraps `nitro deploy --prebuilt` because Cloudflare auto-enables a
# "Preview URL" (an extra public hostname per deployment) unless
# `preview_urls: false` is set in wrangler.json -- and that file is
# regenerated fresh on every build, so the flag can't just be committed
# once. This patches it in after each build, before deploying.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

python3 -c "
import json
path = '.output/server/wrangler.json'
with open(path) as f:
    d = json.load(f)
d['preview_urls'] = False
with open(path, 'w') as f:
    json.dump(d, f, indent=2)
"

npx wrangler --cwd .output/ deploy
