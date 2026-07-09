# Bucket List App

A private, invite-only shared bucket list and calendar for two (or a few) people.
You add things you want to do together, give them a date/time, mark them done, and add photos and notes to a shared Journal entry when you actually get around to them.

Built on **TanStack Start** (React 19 + Vite) with **Supabase** for auth, database, storage and realtime. It's designed as a single, self-hostable app — everything user-facing lives in the frontend, and everything server-side is standard Postgres + Supabase (RLS + triggers + a storage bucket). No custom backend server to run.

---

## Features

- Email + password auth, gated by an allowlist you control from the Settings tab.
- **Bucket** tab — three states per item: **Backlog** (no date), **Planned** (has a date), **Done** (completed).
- **Calendar** tab — a mirrored, chronological view of everything **planned**, grouped by day.
- **Journal** tab — every **done** item as a card with shared photo uploads (with captions, a lightbox, and save-to-device download), a comment thread, and sortable by completion date.
- **Settings** tab — edit your display name, upload an avatar, manage the invite allowlist.
- Shared realtime updates (both users see each other's changes without refreshing).
- Per-item photos stored in Supabase Storage; user avatars in a separate bucket.
- Postgres triggers keep `bucket_items` and `calendar_events` in sync automatically.
- Row Level Security is enabled on every table.

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | [TanStack Start](https://tanstack.com/start) v1 (React 19, SSR-capable) |
| Router | [TanStack Router](https://tanstack.com/router) with file-based routes |
| Data client | [`@tanstack/react-query`](https://tanstack.com/query) (installed; app currently uses direct Supabase calls + realtime) |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 + shadcn/ui components (Radix primitives) |
| Icons | `lucide-react` |
| Fonts | `@fontsource/fraunces` (serif) + `@fontsource/inter` (sans) |
| Dates | `date-fns` |
| Forms | `react-hook-form` + `zod` |
| Toasts | `sonner` |
| Backend | Supabase (Postgres + Auth + Storage + Realtime) |

Package manager: `bun` (a `bunfig.toml` is included). `npm`/`pnpm` also work — commands below use `bun`, swap in `npm`/`pnpm` as you like.

---

## Folder structure

```
.
├── src/
│   ├── routes/                     # File-based routes (TanStack Router)
│   │   ├── __root.tsx              # Root layout: <html>, providers, error/404 boundaries
│   │   ├── index.tsx               # "/"  → redirects into the app
│   │   ├── auth.tsx                # "/auth" — sign in / sign up (public)
│   │   └── _authenticated/         # Protected subtree (pathless layout)
│   │       ├── route.tsx           # Auth gate: redirects to /auth if no session
│   │       ├── calendar.tsx        # "/calendar" — planned items grouped by day
│   │       ├── bucket.tsx          # "/bucket"   — full bucket list with filters
│   │       ├── journal.tsx        # "/journal"  — done items + shared photos/notes
│   │       └── settings.tsx        # "/settings" — profile + invite allowlist
│   ├── components/
│   │   ├── app-shell.tsx           # Top nav, mobile bottom nav, sign-out button
│   │   ├── bucket-item-dialog.tsx  # Create / edit dialog + BucketItem type + CATEGORIES
│   │   ├── event-dialog.tsx        # (unwired calendar-event dialog, not used by current UI)
│   │   ├── avatar-crop-dialog.tsx  # Circular crop/zoom UI for avatar uploads
│   │   └── ui/                     # shadcn/ui primitives (Button, Card, Dialog, …)
│   ├── lib/
│   │   ├── auth-context.tsx        # <AuthProvider> + useAuth() hook
│   │   ├── image.ts                # HEIC-aware decode, JPEG re-encode, save-to-device
│   │   ├── utils.ts                # cn() helper
│   │   └── (error reporting helpers used by TanStack error boundaries)
│   ├── integrations/supabase/      # Auto-generated Supabase client + TS types
│   │   ├── client.ts               # Browser Supabase client (do NOT edit by hand)
│   │   ├── client.server.ts        # Server-side admin client (service role)
│   │   ├── auth-middleware.ts      # requireSupabaseAuth server-fn middleware
│   │   ├── auth-attacher.ts        # Attaches bearer token to server fns
│   │   └── types.ts                # Generated DB types
│   ├── hooks/                      # use-mobile.tsx, etc.
│   ├── styles.css                  # Tailwind v4 entry + design tokens (see CUSTOMIZING.md)
│   ├── router.tsx                  # Router instance
│   ├── routeTree.gen.ts            # Auto-generated route tree (do NOT edit)
│   ├── start.ts                    # createStart() — registers server-fn middleware
│   └── server.ts                   # SSR entry with error wrapper
├── supabase/
│   ├── config.toml                 # Supabase project config (auto-managed)
│   └── migrations/                 # SQL migrations (apply in order to reproduce the schema)
├── vite.config.ts                  # Extends @lovable.dev/vite-tanstack-config
├── package.json
├── SUPABASE.md                     # How to recreate the backend from scratch
├── CUSTOMIZING.md                  # How to change categories, colors, name, storage paths
└── PORTABILITY.md                  # High-level "how to move off Supabase" notes
```

---

## Running it locally

### 1. Prerequisites

- **Node.js 20+** (or **Bun 1.x**).
- A **Supabase project** (either [supabase.com](https://supabase.com) hosted, self-hosted, or the local Supabase CLI). See `SUPABASE.md` for full setup.

### 2. Clone & install

```bash
git clone <your-fork-url> bucket-list-app
cd bucket-list-app
bun install    # or: npm install / pnpm install
```

### 3. Create your Supabase backend

Follow `SUPABASE.md`. In short:

1. Create a new Supabase project (or `supabase start` for local).
2. Apply every SQL file in `supabase/migrations/` **in filename order** to your project's database. The easiest way is:
   ```bash
   # requires the Supabase CLI, linked to your project
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   Alternatively, paste each migration into the SQL editor in the Supabase dashboard, oldest first.
3. Create two **private** storage buckets: `bucket-photos` and `avatars` (the migrations create storage policies for both; the buckets themselves are created in a migration but confirm they exist).
4. Under **Authentication → Providers**, enable **Email**. Turn on "Confirm email" only if you want that flow; the app also works with auto-confirm.
5. (Recommended) Turn on **Leaked Password Protection** under Authentication → Password.

### 4. Configure environment variables

Create a `.env` file in the project root:

```env
# Client-visible (must be prefixed with VITE_)
VITE_SUPABASE_URL="https://<your-project-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<your anon / publishable key>"
VITE_SUPABASE_PROJECT_ID="<your-project-ref>"

# Server-visible mirrors (used during SSR / server functions)
SUPABASE_URL="https://<your-project-ref>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<your anon / publishable key>"
SUPABASE_PROJECT_ID="<your-project-ref>"

# Only needed if you add server-side admin operations. Never expose to the client.
# SUPABASE_SERVICE_ROLE_KEY="<your service role key>"
```

> The **publishable / anon** key is safe to ship in a client bundle — Row Level Security is what actually protects your data. The **service role** key must stay server-only.

**Local dev shortcut, no hosted project needed:** if you have Docker running, `supabase start` (from the repo root) brings up a complete local Postgres/Auth/Storage stack and applies every migration automatically — no signup, no allowlist friction, fully disposable. It prints a block of local keys/URLs; put the local `URL`/`PUBLISHABLE_KEY` values into a `.env.local` file (same shape as `.env` above) instead of `.env` — Vite loads `.env.local` with higher priority, so `bun run dev` picks up the local backend automatically as long as that file exists, and you can delete it any time to fall back to `.env`. Local Studio (a GUI for browsing/editing tables) is at `http://127.0.0.1:54323`; local Mailpit (catches "sent" emails like signup confirmations, since the local stack doesn't really send mail) is at `http://127.0.0.1:54324`. Tear it down with `supabase stop`; `supabase db reset` wipes the local DB and reapplies every migration from scratch.

### 5. Run the dev server

```bash
bun run dev        # or: npm run dev
```

Open <http://localhost:5173> (Vite will print the exact URL/port).

### 6. First sign-up (bootstrapping the allowlist)

`allowed_emails` starts empty. The `is_email_allowed()` function returns **true when the table is empty**, so the very first person can sign up without an invite. After that first account exists, add every other allowed email from **Settings → Invites** before that person signs up. Only signed-in admins (see `SUPABASE.md`) can edit the allowlist.

### 7. Build for production

```bash
bun run build      # Vite/Nitro build; output goes to .output/ (Cloudflare-compatible by default)
bun run preview    # preview the built app locally
```

The build target defaults to Cloudflare Workers/Pages via Nitro. To deploy to Node instead, set `NITRO_PRESET=node-server` (or another [Nitro preset](https://nitro.build/deploy)) as an env var when building, or hard-pin one via `nitro: { preset: "..." }` in `vite.config.ts`.

### 8. Deploying to GitHub Pages — currently broken upstream, use Cloudflare Pages for now

GitHub Pages only serves static files (no server runtime). `.github/workflows/deploy-pages.yml` is set up to build with `NITRO_PRESET=github-pages` — Nitro's static-site preset — and deploy via `actions/deploy-pages`, but **this build currently fails** on this project's pinned versions (nitro 3 beta, vite 8 beta, `@tanstack/react-start` 1.168.27): the final "building nitro environment for production" step throws `rolldownOptions.input should not be an html file when building for SSR`, and the prerendered `index.html`/`404.html` come out as 0-byte files even on runs that don't crash. This reproduced with the default server-entry override, without it, and with TanStack Start's own `spa: { enabled: true }` mode — it's an upstream bug in this beta combination, not something fixable from this repo's config. The workflow is left in place (manual `workflow_dispatch` trigger only, so it doesn't fail silently on every push) for whenever a fixed Nitro/Vite/TanStack Start release ships — see the comment at the top of that file for exactly what was tried.

**Until then, use Cloudflare Pages/Workers instead** — it's already this project's default, tested build target, requires no extra config beyond what's in `vite.config.ts` today, and Cloudflare has a free tier that comfortably fits a 2-person app.

**Automatic:** `.github/workflows/deploy-cloudflare.yml` builds and deploys on every push to `main`. Requires `CLOUDFLARE_API_TOKEN` (and `VITE_SUPABASE_*`) set as GitHub Actions repo secrets — see the comment block at the top of that file for exactly which secrets and why. Server-only Supabase vars (`SUPABASE_SERVICE_ROLE_KEY` etc.) are unrelated to this workflow; they must already be set as Cloudflare Worker variables/secrets since the Worker reads them at runtime, not at build time.

**Manual:** for deploying from a local checkout without going through CI:

```bash
npx wrangler login   # one-time, opens a browser
scripts/deploy.sh    # builds, then deploys via wrangler
```

`scripts/deploy.sh` wraps the build + deploy rather than just running `npx nitro deploy --prebuilt` directly, because it also patches `preview_urls: false` into the generated `wrangler.json` (Cloudflare otherwise auto-enables an extra public "Preview URL" hostname per deployment) — that file is regenerated fresh on every build, so this can't just be committed once.

If/when you want to retry GitHub Pages: bump `nitro`, `vite`, and `@tanstack/react-start` in `package.json`, run `NITRO_PRESET=github-pages bun run build` locally, confirm `.output/public/index.html` is non-empty, then re-enable the `push` trigger in the workflow.

> **Before you make this public, read the "⚠️ Before you publish this app anywhere public" section in `SUPABASE.md`.** GitHub Pages has no access control of its own — a public Pages site is reachable by anyone with the URL, and the invite allowlist only actually blocks signups once you've wired up the Auth Hook described there.

---

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Production build |
| `bun run build:dev` | Development-mode production build (source maps, less minification) |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | ESLint |
| `bun run format` | Prettier over the whole repo |

---

## Where to look next

- **`DEVELOPER_GUIDE.md`** — the deep reference: complete live database schema, a file-by-file codebase tour (every route/component/lib file, what it does, and the gotcha to know before touching it), the auth/security model and its sharp edges, the deployment pipeline, every tool in the stack and why it's there, and a practical guide to adding your own features. Start here if you're building something new.
- **`SUPABASE.md`** — every table, column, storage bucket, RLS policy, function, and trigger, so you can recreate the backend on a fresh Supabase project.
- **`CUSTOMIZING.md`** — how to rename the app, change categories, tweak the design system, change how Backlog/Planned/Done are computed, and where uploads land in storage.
- **`PORTABILITY.md`** — notes on moving to a non-Supabase backend.
