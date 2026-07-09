# Developer Guide

This is the single deep-reference document for this codebase: the complete database schema as it exists *right now*, the deployment pipeline, every tool involved and why it's there, and a practical guide to adding your own features safely. `README.md` is the quick-start; this is everything behind it.

Companion docs, each with a narrower focus:
- **`SUPABASE.md`** — the canonical backend spec (kept in sync with migrations)
- **`CUSTOMIZING.md`** — "where do I change X" cheat sheet (categories, branding, storage paths)
- **`PORTABILITY.md`** — what's Supabase-specific vs. portable, if you ever want to leave Lovable Cloud
- **`CLAUDE.md`** (gitignored, local only) — working notes for AI coding assistants on this repo's non-obvious history

---

## 1. What this app is, architecturally

A single TanStack Start application, server-rendered, deployed as one Cloudflare Worker. There is no separate backend service — "the backend" is entirely Supabase (Postgres + Auth + Storage + Realtime), reached directly from browser JavaScript via `@supabase/supabase-js`. The Worker's own server-side code exists only for two things: rendering the initial HTML (SSR) and injecting security headers — it does **not** proxy or gate any data access. All real data access control lives in Postgres Row Level Security policies, because the browser talks to Supabase directly with a public anon key that anyone can read out of the JS bundle.

```
Browser ──HTTPS──▶ Cloudflare Worker (SSR shell + security headers)
   │                        │
   │                  serves static JS/CSS from the same Worker's
   │                  ASSETS binding
   │
   └──HTTPS/WSS (direct, from client JS)──▶ Supabase
                                              ├─ PostgREST (REST API, RLS-enforced)
                                              ├─ GoTrue (Auth)
                                              ├─ Storage API
                                              └─ Realtime (WebSocket, RLS-enforced)
```

This matters for how you build features: **there is no server-side request handler to add business logic to.** If you want to enforce a rule ("only the creator can delete X", "email must be on a list before Y"), it has to live in a Postgres RLS policy, a trigger, or a `SECURITY DEFINER` function — not in a TanStack Start server function, because the app doesn't route data operations through one. (There *is* scaffolding for server functions — see §3.6 — but nothing currently uses it.)

For a file-by-file walkthrough of every route, component, and lib file — what each one does, and the specific gotcha to know before editing it — see **§9. Codebase tour**.

---

## 2. Database schema (live, complete)

Source of truth: `supabase/migrations/*.sql`, applied in filename order. As of this doc there are 19 migrations. What follows is the *resulting* schema, not a chronological history — read `SUPABASE.md` if you want the "what changed when and why" narrative, or the migration files themselves for exact SQL.

### 2.1 Enums

```sql
CREATE TYPE public.bucket_status AS ENUM ('planned', 'done');
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
```

There is no `'backlog'` database value — see §2.2.

### 2.2 Tables

**`public.profiles`** — one row per authenticated user, auto-created by a trigger on signup.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Equals `auth.users.id`. |
| `email` | `text` not null | Copied from `auth.users` at signup time. |
| `display_name` | `text` | Defaults to the email's local part if not set. |
| `avatar_url` | `text` | A signed URL into the `avatars` storage bucket. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` maintained by trigger. |

**`public.allowed_emails`** — the invite allowlist.

| Column | Type | Notes |
|---|---|---|
| `email` | `text` PK | Compared case-insensitively via `lower()`. |
| `added_at` | `timestamptz` | Defaults to `now()`. |

**`public.user_roles`** — roles, deliberately **not** a column on `profiles` (see §4.2 for why).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Default `gen_random_uuid()`. |
| `user_id` | `uuid` not null | FK → `auth.users(id) ON DELETE CASCADE`. |
| `role` | `app_role` | `'admin'` or `'user'`. |
| `created_at` | `timestamptz` | |
| — | UNIQUE(`user_id`, `role`) | |

**`public.bucket_items`** — the core table, one row per bucket-list entry.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Default `gen_random_uuid()`. |
| `title` | `text` not null | |
| `notes` | `text` | Free-form. |
| `category` | `text` | Nullable free string — the UI picks from a hardcoded array in `src/components/bucket-item-dialog.tsx`, not a DB enum. |
| `target_date` | `date` | `NULL` ⇒ "backlog" (a UI-only concept — see below). |
| `target_time` | `time` | Optional; only meaningful with `target_date` set. |
| `status` | `bucket_status` not null | Default `'planned'`. |
| `completed_by` | `uuid` | FK → `profiles(id) ON DELETE SET NULL`. |
| `completed_at` | `timestamptz` | |
| `image_urls` | `text[]` not null | **Legacy, no longer written to** — superseded by `journal_photos` below. Signed URLs into `bucket-photos`, default `'{}'`. |
| `links` | `text[]` not null | Reserved, unused by the UI today. |
| `created_by` | `uuid` not null | FK → `profiles(id) ON DELETE CASCADE`. Row owner. |
| `created_at`, `updated_at` | `timestamptz` | |

> **"Backlog" is not a database value.** The `bucket_status` enum only has `'planned'` and `'done'`. Backlog = `status = 'planned' AND target_date IS NULL`, computed client-side in `src/routes/_authenticated/bucket.tsx`. If you add a feature that needs to filter/query backlog items from SQL (e.g., a new report), replicate that predicate — don't expect a `'backlog'` enum value to exist.

**`public.calendar_events`** — mirror table, kept in sync with `bucket_items` by triggers in both directions.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `bucket_item_id` | `uuid` | FK → `bucket_items(id) ON DELETE SET NULL`. |
| `title`, `description` | `text` | Mirror `bucket_items.title` / `.notes`. |
| `start_at` | `timestamptz` not null | Built from `target_date` (+ `target_time` if set). |
| `end_at` | `timestamptz` | Unused today. |
| `all_day` | `boolean` not null | True when `target_time` is null. |
| `created_by` | `uuid` not null | FK → `profiles(id) ON DELETE CASCADE`. |
| `created_at`, `updated_at` | `timestamptz` | |

The current Calendar UI (`src/routes/_authenticated/calendar.tsx`) actually queries **`bucket_items` directly**, not this table. `calendar_events` exists and is kept correctly in sync (see §2.4) for future use — e.g. an ICS export — but nothing reads it today. If you build a feature against it, know that it's currently write-only from the app's perspective.

**`public.journal_photos`** / **`public.journal_notes`** — added 2026-07-09, back the Journal tab (`src/routes/_authenticated/journal.tsx`). Unlike every other table above, these are **shared-write**: any signed-in user can insert/update/delete any row, not just their own — see §2.5. `journal_photos` one-time-backfilled every existing `bucket_items.image_urls` entry on creation.

| `journal_photos` column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `bucket_item_id` | `uuid` not null | FK → `bucket_items(id) ON DELETE CASCADE`. |
| `url` | `text` not null | Signed URL into `bucket-photos` (same bucket `image_urls` used). |
| `caption` | `text` | Nullable, editable. |
| `created_by` | `uuid` not null | FK → `profiles(id) ON DELETE CASCADE` — who uploaded it, not necessarily the item's owner. |
| `created_at` | `timestamptz` | |

| `journal_notes` column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `bucket_item_id` | `uuid` not null | FK → `bucket_items(id) ON DELETE CASCADE`. |
| `body` | `text` not null | |
| `created_by` | `uuid` not null | FK → `profiles(id) ON DELETE CASCADE`. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` added by a follow-up migration, maintained by `set_updated_at()` — the UI shows "· edited" when it differs from `created_at`. |

### 2.3 Functions

All defined `SET search_path = public` (or explicit schema) as a security hygiene practice — never omit this if you add a `SECURITY DEFINER` function, or it's vulnerable to search-path hijacking.

| Function | Security | Purpose |
|---|---|---|
| `is_email_allowed(_email text) → boolean` | **`SECURITY DEFINER`** | True if `allowed_emails` is empty (first-run bootstrap) or `_email` is on the list. **Must stay `SECURITY DEFINER`** — it's called by `anon` (pre-signup, no session yet) and `allowed_emails` has no `anon` SELECT policy, so `SECURITY INVOKER` makes it silently always return `true` under RLS. This exact regression happened once already; see the git log for `is_email_allowed` if you're tempted to "simplify" it. |
| `hook_enforce_signup_allowlist(event jsonb) → jsonb` | `SECURITY DEFINER` | The actual enforcement of invite-only signup. Wired up as a Supabase **Auth Hook** (dashboard/`config.toml`-level, not just a Postgres function — see §4.1). Calls `is_email_allowed` internally. |
| `has_role(_user_id uuid, _role app_role) → boolean` | `SECURITY DEFINER` | Used inside RLS policies to check admin status without recursive-RLS issues. |
| `handle_new_user()` (trigger) | `SECURITY DEFINER` | `AFTER INSERT ON auth.users` → creates the matching `profiles` row. Runs **unconditionally**, regardless of the allowlist — see §4.1 for why that matters. |
| `set_updated_at()` (trigger) | plain `plpgsql` | Generic `updated_at = now()` on any table with that column. |
| `sync_bucket_to_calendar()` (trigger) | `SECURITY DEFINER` | `AFTER INSERT OR UPDATE ON bucket_items` → upserts/deletes the linked `calendar_events` row. Recursion-guarded via `pg_trigger_depth()`. |
| `sync_bucket_delete_to_calendar()` (trigger) | `SECURITY DEFINER` | `AFTER DELETE ON bucket_items` → deletes the linked event. |
| `sync_calendar_to_bucket()` (trigger) | `SECURITY DEFINER` | `AFTER INSERT OR UPDATE ON calendar_events` → creates/updates the linked bucket item (for inserts made directly against `calendar_events`, e.g. a future ICS importer). |
| `sync_calendar_delete_to_bucket()` (trigger) | `SECURITY DEFINER` | `AFTER DELETE ON calendar_events` → deletes the linked bucket item. |

All the `sync_*` functions and `handle_new_user`/`set_updated_at` have `EXECUTE` revoked from `anon`/`authenticated` — they're trigger-only, never callable via RPC.

### 2.4 Triggers

```
auth.users        AFTER INSERT              → handle_new_user()
profiles          BEFORE UPDATE             → set_updated_at()
bucket_items       BEFORE UPDATE             → set_updated_at()
bucket_items       AFTER INSERT OR UPDATE    → sync_bucket_to_calendar()
bucket_items       AFTER DELETE              → sync_bucket_delete_to_calendar()
calendar_events    BEFORE UPDATE             → set_updated_at()
calendar_events    AFTER INSERT OR UPDATE    → sync_calendar_to_bucket()
calendar_events    AFTER DELETE              → sync_calendar_delete_to_bucket()
journal_notes      BEFORE UPDATE             → set_updated_at()
```

### 2.5 Row Level Security (live policies, per table)

RLS is enabled on every table. Remember: `authenticated` in this app means **any signed-up user**, not "an admin" — this is a shared two-person workspace, so most tables are intentionally shared-read.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | any authenticated | `auth.uid() = id AND is_email_allowed(email)` | owner only | — (denied) |
| `allowed_emails` | any authenticated | **admin only** (`has_role(..., 'admin')`) | — (denied) | admin only |
| `bucket_items` | any authenticated | `auth.uid() = created_by` | **owner only** | owner only |
| `calendar_events` | any authenticated | `auth.uid() = created_by` | owner only | owner only |
| `user_roles` | `auth.uid() = user_id` (own rows only) | — (denied) | — (denied) | — (denied) |
| `journal_photos` | any authenticated | `auth.uid() = created_by` | **any authenticated** | **any authenticated** |
| `journal_notes` | any authenticated | `auth.uid() = created_by` | owner only | owner only |

**`journal_photos` is shared-write on UPDATE/DELETE, deliberately different from every table above.** A memory book only makes sense if both people can fix a caption or delete a bad photo, even one their partner uploaded — so this is `USING (true)`, not owner-only. `journal_notes` stays owner-only on UPDATE/DELETE since a note is attributed to a specific person by name; editing someone else's words wouldn't make sense the way removing a blurry photo does.

**Owner-only UPDATE on `bucket_items` means only the creator of an item can mark it done.** If you want either person to be able to check off anything, that's a deliberate policy change: `USING (true)` on the UPDATE policy. Not a bug — it's the current tradeoff between "shared workspace" and "don't let the other person accidentally edit your stuff."

**`user_roles` has no way to grant yourself admin through the app.** By design — there's no UI for it, and the RLS policies don't allow self-service role changes. Granting admin is a one-time `service_role`-authenticated operation (SQL editor, or the admin API) — see §4.2 for the exact gotcha this caused on a fresh project.

### 2.6 Storage

Two private buckets (`public: false`), created via the Storage API (not by a migration — migrations only create the *policies*, the buckets themselves have to be created separately: dashboard, or `POST /storage/v1/bucket` with the service-role/secret key).

| Bucket | Path convention | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|---|
| `bucket-photos` | `<user_id>/<timestamp>-<filename>` | any authenticated (shared Journal) | only within your own `<user_id>/` folder |
| `avatars` | `<user_id>/avatar-<timestamp>.<ext>` | any authenticated | only within your own `<user_id>/` folder |

The `<user_id>/` prefix isn't optional — the RLS policy on `storage.objects` extracts `(storage.foldername(name))[1]` and compares it to `auth.uid()::text`. Uploads outside your own folder are rejected. Signed URLs are generated with a 365-day expiry at upload time and stored permanently in the DB — they don't auto-refresh, so a URL 404s once its signature expires (see `CUSTOMIZING.md` §4 if you want to change this).

### 2.7 Grants

Supabase's PostgREST does **not** grant default table privileges — every table needs an explicit `GRANT`, or requests 401/403 even when RLS would otherwise allow them (a missing `GRANT` and an RLS denial fail differently: RLS returns 200 with zero rows for INSERT/UPDATE/DELETE it blocks, a missing `GRANT` returns a hard 403 `permission denied` — see the §8 bullet about migration `20260709120000` for a real instance of this being mixed up). Current grants: `authenticated` has `SELECT, INSERT, UPDATE, DELETE` on `profiles`, `allowed_emails`, `bucket_items`, `calendar_events`, `journal_photos`, `journal_notes`, and `SELECT` only on `user_roles`. `service_role` has `ALL` on everything. `anon` has no table grants at all — every table read requires a signed-in session (the *functions* `is_email_allowed` and the auth hook are the only things `anon`/the auth service can call).

---

## 3. Adding your own features

### 3.1 Adding a migration

```bash
# generate a filename matching the existing convention (timestamp_uuid.sql)
TS=$(date +%Y%m%d%H%M%S); UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
touch "supabase/migrations/${TS}_${UUID}.sql"

# write your SQL, then:
supabase link --project-ref <your-project-ref>   # if not already linked
supabase db push
```

`supabase db push` applies every unapplied migration in filename order. It's not transactional across files — if migration 3 of 5 fails, 1–2 are already applied. Test locally against `supabase start` (a local Docker Postgres) before pushing to the real project if the change is nontrivial.

**Rules that matter here, learned the hard way in this repo's own history:**
- Any `SECURITY DEFINER` function needs `SET search_path = public` (or an explicit schema) — omitting it is a real, documented Postgres privilege-escalation vector.
- Before deciding a function should be `SECURITY INVOKER` "since the caller already has the right grants," check *every* caller, not just the one you're thinking about. `is_email_allowed` broke exactly this way — it's called by both `authenticated` (via the `profiles` INSERT policy) and `anon` (the frontend's pre-signup RPC check), and only one of those roles has a matching RLS SELECT policy on the table it reads.
- New tables need an explicit `GRANT` to `authenticated`/`anon` as appropriate — RLS alone doesn't unlock PostgREST access.
- **On a fresh project, migrations that seed data based on "existing rows" (like the admin-role bootstrap in the `user_roles` migration) run before any real users exist, and silently do nothing.** If you ever recreate this project from scratch, insert your own admin row manually afterward — see `SUPABASE.md` §10, and the incident that prompted this note: nobody could add allowlist invites until this was caught.

### 3.2 Adding a new route/page

File-based routing via TanStack Router — see `src/routes/README.md` for the naming conventions (`$id`, `{-$optional}`, `$.tsx` splat, `_layout`). To add an authenticated page:

1. Create `src/routes/_authenticated/<name>.tsx`:
   ```tsx
   import { createFileRoute } from "@tanstack/react-router";

   export const Route = createFileRoute("/_authenticated/<name>")({
     component: MyPage,
   });

   function MyPage() {
     return <div>...</div>;
   }
   ```
2. Add it to the `NAV` array in `src/components/app-shell.tsx` if it needs a nav link.
3. `src/routeTree.gen.ts` regenerates automatically on the next dev-server run or build — **never hand-edit it.**

Anything under `_authenticated/` inherits the auth gate from `src/routes/_authenticated/route.tsx` (`beforeLoad` redirects to `/auth` if there's no session). Routes outside it (like `/auth`, `/reset-password`) are public — don't put anything sensitive there without its own guard.

### 3.3 Querying data

Everything goes through the single client import:

```ts
import { supabase } from "@/integrations/supabase/client";

const { data, error } = await supabase
  .from("bucket_items")
  .select("*")
  .eq("status", "planned")
  .order("target_date", { ascending: true });
```

There's no repository/service layer — routes call `supabase.from(...)` directly in `useEffect`/event handlers. If you add a new table, this is the pattern to follow; don't introduce a new abstraction layer for one table.

### 3.4 Realtime

```ts
const channel = supabase
  .channel("bucket_items_changes")
  .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
  .subscribe();
// cleanup:
supabase.removeChannel(channel);
```

If you add realtime to a new table, first enable it in the Supabase dashboard (Database → Replication → `supabase_realtime` publication) — the client-side `.channel()` call alone doesn't turn it on.

### 3.5 File uploads

Always prefix the storage path with `${user.id}/`:

```ts
const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
await supabase.storage.from("bucket-photos").upload(path, file);
const { data: signed } = await supabase.storage
  .from("bucket-photos")
  .createSignedUrl(path, 60 * 60 * 24 * 365);
```

Skipping the `<user_id>/` prefix means the upload is rejected by RLS, not silently misfiled — so this fails loudly, at least.

For actual photo uploads (as opposed to this minimal example), don't upload the raw `File` — decode it first with `decodeImageBlob` and re-encode with `bitmapToJpegBlob` (both in `src/lib/image.ts`, used by `journal.tsx`'s `uploadPhotos`). That's what makes HEIC photos from iPhones work at all (most browsers besides Safari can't decode HEIC natively) and keeps upload sizes down via downscaling.

### 3.6 If you need real server-side logic

The scaffolding exists but is unused: `src/start.ts` registers `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`) as available middleware for TanStack Start server functions, and `src/integrations/supabase/client.server.ts` exports a `supabaseAdmin` client (service-role, bypasses RLS) for exactly this purpose. Nothing in the app currently defines a server function that uses either. If you need one (e.g., an operation too privileged to do from the browser even with RLS), that's the intended path — but note `client.server.ts` currently expects an env var named `SUPABASE_SERVICE_ROLE_KEY`, while this project's actual Supabase project issues the newer-style key as `SUPABASE_SECRET_KEY` (see §6). You'd need to reconcile that naming before it would work.

---

## 4. Auth & security model

### 4.1 Why "invite-only" needs the Auth Hook, not just app code

The naive design — check an allowlist in the frontend before calling `signUp()` — doesn't actually stop anyone, because `handle_new_user()` creates a `profiles` row for **any** `auth.users` insert unconditionally, and nothing stops a request straight to Supabase's public signup REST endpoint (using the anon key, which is necessarily public — it's in the JS bundle).

The real gate is `hook_enforce_signup_allowlist()`, wired up as a Supabase **"Before User Created" Auth Hook**:

```toml
# supabase/config.toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/hook_enforce_signup_allowlist"
```

This runs server-side, inside Supabase Auth itself, before the user row is even created — it's the only thing an attacker calling the raw API can't bypass. Applied via `supabase config push` (see §4.4 for the sharp edge in that command).

### 4.2 Roles: why a separate table, and the fresh-project gotcha

Roles live in `user_roles`, not a column on `profiles`, specifically so `has_role()` can be `SECURITY DEFINER` without the RLS-recursion problems you get checking a role column via a policy on the same table it's read from.

**The gotcha:** the migration that introduces `user_roles` also seeds every *existing* profile as admin — but on a brand-new project, migrations run before anyone has signed up, so this inserts zero rows. Nobody ends up admin, and the "add invites" feature (which requires `has_role(..., 'admin')`) silently fails for everyone. `SUPABASE.md` §10 documents the fix (a one-off `INSERT` after the first signup); this repo's own deployment hit exactly this issue and had to fix it live via the admin API. If you ever spin up another fresh project from these migrations, don't skip that step.

### 4.3 Password policy

```toml
[auth]
minimum_password_length = 10
password_requirements = "lower_upper_letters_digits"
```

Bumped from Supabase's fresh-project defaults (6 chars, no character-class requirement). Leaked-password checking (HaveIBeenPwned integration) is a **Supabase Pro-plan feature** — not available on the Free tier this project runs on, and not worth upgrading for on a private 2-person app. This password policy is the practical substitute.

### 4.4 The `supabase config push` sharp edge — read this before touching auth config

`supabase config push` diffs your **entire** local `config.toml` against Supabase's built-in CLI scaffold defaults, not just the section you edited, and pushes every difference. Leave a field unset and it gets pushed as whatever the CLI's generic default is — which can silently overwrite live settings you never intended to touch. This happened once already: enabling the auth hook via a mostly-empty `config.toml` also reset `site_url` to `localhost`, disabled email confirmations, and disabled MFA, all in the same push, discovered only by checking the live public settings endpoint afterward.

**The fix in place:** every field this project has ever needed to touch is explicitly pinned in `supabase/config.toml`, with a comment explaining that the pinned value is "whatever was already live," not necessarily "correct." If you add a new `config.toml` section, either pin every field in it explicitly, or verify the diff output line-by-line before confirming the push — never push a partial section and assume the rest is left alone.

### 4.5 Security headers & CSP

Cloudflare's `_headers` file convention (which Nitro's `cloudflare` preset still generates into `.output/public/_headers`) turns out to be **inert** for this deployment shape — it only applies to classic Cloudflare Pages asset serving, not a Worker with an Assets binding (confirmed by checking live response headers before/after; this file is generated but never read at request time here). Headers are instead injected in application code, in `src/server.ts`, on every response the Worker returns:

```
Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy
```

The CSP's `script-src`/`style-src` need `'unsafe-inline'`: TanStack Start's hydration payload and scroll-restoration script are inlined without a nonce, and Radix/Floating UI position popovers via inline `style` attributes. This still meaningfully restricts `connect-src`/`img-src`/`frame-ancestors`/`form-action` to trusted origins, but doesn't fully neutralize a hypothetical future XSS bug the way a nonce-based CSP would. Fixing that properly would mean wiring nonce generation through TanStack Start's SSR pipeline — a real undertaking, not attempted here.

---

## 5. CI/CD & deployment pipeline

### 5.1 Automated deploy: `.github/workflows/deploy-cloudflare.yml`

Every push to `main` (excluding pure `*.md`/`supabase/**` changes) builds and deploys to Cloudflare Workers automatically via GitHub Actions. It mirrors `scripts/deploy.sh` (build → patch `preview_urls: false` into the generated `wrangler.json` → `wrangler deploy`), minus the local-clock compatibility-date clamp, which only matters on sandboxed dev machines — GitHub-hosted runners are NTP-synced.

It authenticates with a Cloudflare **API token** (`CLOUDFLARE_API_TOKEN` repo secret, plus `CLOUDFLARE_ACCOUNT_ID` if that token can see more than one account) instead of the interactive `wrangler login` the manual path uses. The `VITE_*` public/anon Supabase values are also repo secrets, injected as build-time env so Vite bakes them into the client bundle.

Server-only vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are **not** part of this workflow — see §6's table: they're read from `process.env` at *runtime* by the deployed Worker (Cloudflare's own env bindings), not inlined at build time, so they live as Cloudflare Worker variables/secrets (dashboard, or `wrangler secret put <NAME>`) and are untouched by every redeploy.

### 5.2 Manual deploy: `scripts/deploy.sh`

Still useful for deploying from a local checkout without waiting on CI/pushing to `main` (e.g. testing a build from a branch):

```bash
scripts/deploy.sh
```

which does exactly this:

```bash
npm run build                                    # vite build; nitro's default preset is cloudflare-module
python3 -c '... patch .output/server/wrangler.json: preview_urls = false; clamp compatibility_date ...'
npx wrangler --cwd .output/ deploy               # actually publishes to Cloudflare
```

**Why the Python patch step exists:** Cloudflare auto-enables an extra public "Preview URL" hostname per deployment unless `preview_urls: false` is set in `wrangler.json` — but that file is entirely regenerated by Nitro on every build (it's derived from `vite.config.ts` + the Nitro preset, not a source file you own), so the flag can't just be committed once. The script re-applies it after every build, before deploying. It also clamps `compatibility_date` against Cloudflare's own server clock, in case the local machine's clock has drifted ahead of real time (Cloudflare rejects a `compatibility_date` in the future).

**Prerequisites to run this yourself:** `npx wrangler login` once (opens a browser, authenticates against your Cloudflare account).

### 5.3 GitHub Pages: present but broken upstream

`.github/workflows/deploy-pages.yml` builds with `NITRO_PRESET=github-pages` (Nitro's static/prerendering preset family) and would deploy via `actions/deploy-pages` — **but this build currently fails** on this project's pinned toolchain (`nitro` 3 beta, `vite` 8 beta, `@tanstack/react-start` 1.168.x). The failure: the final "building nitro environment for production" step throws `rolldownOptions.input should not be an html file when building for SSR`, and even on runs that don't crash, the prerendered `index.html`/`404.html` come out as 0-byte files. This reproduced identically with the default server-entry override, without it, and with TanStack Start's own `spa: { enabled: true }` mode — it's an upstream bug in how this beta combination handles static prerendering, not something fixable from this repo's config. The workflow's trigger is `workflow_dispatch`-only (not `push`) so it can't fail silently on every commit. Full details and everything already tried are in the comment block at the top of that file — read it before re-attempting, so you don't repeat the same dead ends.

If you want to retry: bump `nitro`, `vite`, and `@tanstack/react-start` in `package.json`, run `NITRO_PRESET=github-pages bun run build` locally, and check whether `.output/public/index.html` actually has content before re-enabling the `push` trigger.

### 5.4 Build targets, summarized

| Target | Command | Status |
|---|---|---|
| Cloudflare Workers (default) | `bun run build` (no env override) | ✅ Working, currently deployed |
| GitHub Pages | `NITRO_PRESET=github-pages bun run build` | ❌ Broken upstream (§5.3) |
| Node server | `NITRO_PRESET=node-server bun run build` | Untested in this repo, but a real Nitro preset |
| Local preview | `bun run build && bun run preview` | Works, serves the Cloudflare-shaped build locally |

---

## 6. Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser client (`client.ts`) | Public, safe to expose — baked into the JS bundle at build time. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser client | The anon/publishable key. Also public by design — RLS is the real boundary, not this key's secrecy. |
| `VITE_SUPABASE_PROJECT_ID` | Not currently read by any code path, kept for consistency/documentation | |
| `SUPABASE_URL` | Server-side fallback in `client.ts`, and used directly in shell scripts/CI | Same value as the `VITE_` version, unprefixed for non-Vite contexts. |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side fallback | Same as above. |
| `SUPABASE_SECRET_KEY` | **Not read by any app code today.** | This project's Supabase instance issues the newer-style API keys (`sb_publishable_...` / `sb_secret_...`) rather than legacy JWT anon/service-role keys. `client.server.ts` still expects the old name `SUPABASE_SERVICE_ROLE_KEY` — see §3.6 if you want to actually wire up `supabaseAdmin`. Never `VITE_`-prefix this; it's a full admin credential that bypasses RLS. |
| `SUPABASE_JWKS_URL` | Not currently read by any app code | Present because the new-style Supabase key system issues it; kept for future JWT-verification needs. |

All of the above live in a local, gitignored `.env` (template: `.env.example`) for local dev, and as Cloudflare Worker environment variables / GitHub Actions secrets for deployed environments (only the `VITE_`/public ones need to exist anywhere outside your own machine — nothing server-side currently needs `SUPABASE_SECRET_KEY` at runtime).

---

## 7. Tooling reference — what's running and why

| Tool | Version pinned | Role |
|---|---|---|
| **TanStack Start** | `@tanstack/react-start` ^1.168.26 | The meta-framework: file-based routing + SSR + build orchestration. Everything else here plugs into it. |
| **TanStack Router** | `@tanstack/react-router` ^1.170.16 | Client-side routing underneath Start; also generates `routeTree.gen.ts`. |
| **TanStack Query** | `@tanstack/react-query` ^5.101.1 | Installed and wired into the router context, but the app currently uses direct `supabase.from()` calls + realtime subscriptions rather than Query for data fetching. |
| **Vite** | ^8.0.16 | Bundler/dev-server. Pre-1.0/beta-adjacent major version — this is where the GitHub Pages breakage (§5.3) originates. |
| **Nitro** | 3.0.260603-beta | Universal server build tool underneath TanStack Start — turns the SSR app into a deployable artifact per target (`cloudflare-module`, `github-pages`, `node-server`, etc.). Explicitly pre-RC upstream; the wrapper package (`@lovable.dev/vite-tanstack-config`) narrows its config surface on purpose to reduce breakage risk from schema churn. |
| **`@lovable.dev/vite-tanstack-config`** | 2.7.1 | Lovable's own Vite config wrapper: bundles TanStack Start + React + Tailwind + path aliases + Nitro + sandbox-detection plugins into one `defineConfig()` call. Read the comment block at the top of `vite.config.ts` before adding any Vite plugin by hand — most of what you'd add is already in here, and duplicating it breaks the build. |
| **Tailwind CSS** | ^4.2.1 | Styling. All design tokens are CSS custom properties in `src/styles.css`, not Tailwind config — see `CUSTOMIZING.md`. |
| **shadcn/ui + Radix UI** | various, see `package.json` | Component primitives under `src/components/ui/` — copied into the repo (not an npm dependency you upgrade), safe to edit directly. |
| **`@supabase/supabase-js`** | ^2.110.0 | The only way the app talks to the backend. |
| **Supabase CLI** | 2.109.1 (installed via `brew install supabase/tap/supabase`) | Migrations (`db push`), project linking, and — critically — declarative Auth config via `config.toml` + `config push` (see §4.4). |
| **Wrangler** | 4.108.0 (fetched via `npx`, not a project dependency) | Cloudflare's deploy CLI; what `scripts/deploy.sh` and `nitro deploy` actually shell out to. |
| **React** | ^19.2.0 | UI library. |
| **`react-hook-form` + `zod`** | ^7.71.2 / ^3.24.2 | Form state + validation — used in some dialogs, not universally. |
| **`date-fns`** | ^4.4.0 | Date math for the Calendar view. |
| **`sonner`** | ^2.0.7 | Toast notifications (the `toast.success`/`toast.error` calls throughout). |
| **Playwright** | not a project dependency — installed ad hoc into a scratch directory during development for manual E2E verification against the live deployed URL. Not part of any automated test suite; this repo has **no automated test suite** at all. |

### Package manager

`bun` is the intended package manager (`bunfig.toml` present, `bun.lock` committed), but `npm`/`pnpm` work too — this guide's examples mix both because `bun` wasn't available in every environment this project was worked on in; either works identically for this project's needs.

---

## 8. Known limitations & gotchas (read before you're surprised by one)

- **No automated test suite.** Verification throughout this project's development has been manual: `npm audit` for dependencies, direct REST/Admin API calls against the live Supabase project, and ad hoc Playwright scripts driven against the deployed URL. If you want CI-gated correctness, you're starting from zero.
- **Supabase's built-in email service is slow, low-limit, and sometimes silently fails.** 2 emails/hour per recipient, can take 5–10 minutes, occasionally never arrives. This affects signup confirmation and password-reset emails. For anything beyond a 2-person hobby app, set up custom SMTP (Authentication → Settings → SMTP Settings in the dashboard) — this project has not done so.
- **MFA (TOTP) is disabled** (`auth.mfa.totp.enroll_enabled = false`) specifically because there's no frontend UI for it — it was briefly enabled with no way to use it, which is just unreviewed attack surface for no benefit. Building real MFA support means both flipping this back on *and* adding enrollment/verification UI.
- **Leaked-password protection (HaveIBeenPwned integration) requires Supabase Pro.** Not enabled; the stronger password policy (§4.3) is the substitute.
- **CAPTCHA is not enabled** on signup/signin — `[auth.captcha]` exists in the config schema but turning it on requires both a third-party provider account (hCaptcha/Turnstile) *and* frontend widget code that doesn't exist yet. Enabling the server-side setting without the frontend change would lock everyone out (every auth request would be rejected for a missing captcha token) — don't do one without the other.
- **`calendar_events` is fully maintained but unread** by the current UI (§2.2) — a trap if you assume "the calendar events table" is what powers the Calendar page.
- **The favicon is a placeholder** (`public/favicon.svg`, an emoji) — the original `favicon.ico` is still in the repo, unreferenced.
- **`bucket.tsx`'s "mark done" checkbox can silently no-op.** `bucket_items` UPDATE is owner-only RLS (`auth.uid() = created_by`, §2.5) — but `toggleDone` (`src/routes/_authenticated/bucket.tsx`) optimistically flips the checkbox in local state *before* the Supabase call resolves, and Supabase's `.update()` under RLS returns **success with zero rows affected**, not an error, when the policy blocks the write. So toggling an item you didn't create looks like it worked in your own tab — until the next realtime refresh (or reload) reverts it, with no error message explaining why. Same applies to editing/deleting someone else's item via `BucketItemDialog`. If you loosen this to `USING (true)` so either partner can mark anything done, this whole failure mode disappears.
- **Two pieces of server-function scaffolding are wired up but have zero callers.** `src/integrations/supabase/auth-middleware.ts` (`requireSupabaseAuth`) and `src/integrations/supabase/client.server.ts` (`supabaseAdmin`) exist and are individually correct, but no server function in the app actually uses either one — don't assume they're "the pattern already in use somewhere, go copy it." §3.6 has the intended usage.
- **`src/components/event-dialog.tsx` (`EventDialog`) is dead code.** It's a fully-built create/edit/delete form for `calendar_events`, but nothing imports it — `calendar.tsx` has no click-to-add-event UI wired up at all. If a feature request is "let people add events directly from the Calendar tab," this component is 90% of the work, but it needs to actually be mounted and hooked to a trigger (e.g. clicking a day).
- **Newly-invited users never become admin, so invite management quietly breaks for them.** The migration that introduces `user_roles` seeds every profile that exists *at migration time* as `admin` (§2.2/§4.2) — a one-time backfill, not an ongoing rule. Nothing in the app ever grants `admin` to a user created afterward. In practice this means: the two original users can manage the `allowed_emails` list forever, but a third person invited later sees the same "Add/remove invite" UI in Settings, gets no error until they click, and then gets an RLS-denial toast — because `has_role(auth.uid(), 'admin')` is false for them. There's no self-service path to fix this; it's a manual `INSERT INTO user_roles` from a service-role context.
- **Avatar uploads never delete the previous blob.** `removeAvatar`/re-upload in `src/routes/_authenticated/settings.tsx` only ever nulls or overwrites `profiles.avatar_url`; every upload writes a new timestamped path in the `avatars` bucket rather than replacing the old one, so old avatar images accumulate in Storage indefinitely. Harmless at 2-person scale, worth knowing if you're ever auditing Storage usage/cost.
- **A migration's RLS policy doesn't work without a matching `GRANT`, and Postgres's error for that is easy to misread as an RLS problem.** Migration `20260709120000` added `UPDATE` RLS policies on `journal_photos`/`journal_notes` to fix the caption/note editors, but forgot the table-level `GRANT UPDATE ON ... TO authenticated` — so both edits kept failing with `permission denied for table ... (42501)`, a *different* error than an RLS denial (which returns 200 with zero rows changed, not a 403). Fixed in `20260709130000_grant_journal_update.sql`. The lesson: RLS policies only ever narrow what an already-granted privilege allows — if the privilege itself isn't granted, the policy is unreachable, and Postgres will tell you exactly which `GRANT` is missing if you read the error's `hint` field.

---

## 9. Codebase tour

Section §2 covers the database; this covers every route, component, and lib file — what it does, and specifically what to know before you edit it. Skipped: `src/components/ui/*` (unmodified shadcn primitives), `src/routeTree.gen.ts` (auto-generated, never hand-edited), `src/integrations/supabase/types.ts` (auto-generated DB types).

**Cross-cutting patterns, worth knowing before the file-by-file list:**
- **Realtime is copy-pasted per page, not shared.** `bucket.tsx` and `calendar.tsx` (and `journal.tsx`) each independently open their own `supabase.channel(name).on("postgres_changes", {event: "*", schema: "public", table: "..."}, () => void load())`, and each just does a full refetch on *any* change to the table — no incremental/optimistic merging, no shared hook. Copy this exact pattern if a new page needs live sync; there's no abstraction to import instead.
- **Most business rules live in Postgres, not React.** `handle_new_user` (profile-on-signup), `sync_bucket_to_calendar`/`sync_calendar_to_bucket` (bidirectional mirroring, recursion-guarded via `pg_trigger_depth()`), and the delete-cascade triggers all run without any application code involved. If you're trying to find "where does X get set" and it's not in the route file, check `supabase/migrations/` next — see §2.4.
- **`AuthProvider`'s listener-then-hydrate ordering is load-bearing.** `src/lib/auth-context.tsx` registers `supabase.auth.onAuthStateChange` *before* calling `getSession()` (documented inline, and worth repeating here because it's the one place in this codebase where reordering two lines "for clarity" reintroduces a real race condition per Supabase's own docs) — an auth event fired in the gap between `getSession()` resolving and the listener attaching would otherwise be missed.

### `src/routes/` — pages

- **`index.tsx`** — `/`. Redirect-only stub: `beforeLoad` calls `supabase.auth.getSession()` (a local/cached check, no network round-trip) and sends you to `/calendar` or `/auth`. `ssr: false`, so there's a brief blank flash before it resolves client-side.
- **`auth.tsx`** — `/`. Combined sign-in/sign-up + "forgot password" trigger. Two things to know: (1) Supabase deliberately returns a *success-shaped* response for "email already registered" to avoid leaking which emails exist — the actual tell is `data.user.identities.length === 0`, not `error`; a well-meaning simplification to "just check `error`" breaks the duplicate-account message. (2) The `is_email_allowed` RPC call before sign-up is a **UI nicety only** — real enforcement is the `hook_enforce_signup_allowlist` Auth Hook (§4.1); removing the RPC call changes nothing about actual security.
- **`reset-password.tsx`** — landing page for the emailed reset link. Doesn't gate on `!session` the way you'd expect (no redirect to `/auth`) — it renders an inline "link expired" state instead, because arriving here *is* the auth flow (Supabase's client silently exchanges the link's token for a session on load). Not under `_authenticated/`, so it has no `beforeLoad` gate of its own.
- **`__root.tsx`** — app shell: `<html>`/`<head>`, global CSS/font imports, `QueryClientProvider` + `AuthProvider`, and the route-level `ErrorComponent` (404/error boundary). Two separate render slots matter here: `shellComponent` (raw HTML document, used for SSR) vs. `component` (renders inside that shell, where providers live) — a new global provider goes in the latter, not the former. `Toaster` is mounted once here (not per-page), which is why `toast.success(...)` works from any route with zero setup.
- **`_authenticated/route.tsx`** — the actual auth gate for every tab. `beforeLoad` calls `supabase.auth.getUser()` — unlike `index.tsx`'s local-only `getSession()`, this makes a real network call to validate the JWT server-side, and redirects to `/auth` if it fails. Wraps children in `<AppShell>`. Any new page dropped into `_authenticated/` inherits this gate automatically — no per-page auth code needed, but forgetting to put a page under this folder means no gate at all.
- **`_authenticated/bucket.tsx`** — bucket-list CRUD. Loads `bucket_items` + `profiles` together, filters/derives "backlog vs. planned vs. done" entirely client-side from the same `items` array (see §3, "Backlog" isn't a DB value). **The one gotcha that matters most in this file:** see the `toggleDone` RLS bullet in §8 — marking someone else's item done looks like it works, then silently reverts. Deleting an item here cascades to `journal_photos`/`journal_notes` and the linked `calendar_events` row via DB triggers — the confirmation dialog text only mentions the calendar, not the journal photos/notes that also disappear.
- **`_authenticated/calendar.tsx`** — read-only agenda view. Queries `bucket_items` directly (`status = 'planned' AND target_date IS NOT NULL`), **not** `calendar_events` — despite the DB keeping that table in perfect sync via triggers, this page never reads it (§2.2). The day-grouping logic (`grouped`) assumes the query's own `.order()` already sorted items and only checks adjacency against the *last* group pushed; if you ever fetch this list unsorted, same-day items stop merging into one header instead of erroring.
- **`_authenticated/journal.tsx`** — the Journal tab: completed items as cards, with photo uploads (`journal_photos`) and a comment thread (`journal_notes`). Both tables are shared-write (any signed-in user can add/edit/delete any entry — see §2.2/§2.7), unlike `bucket_items`'s owner-only model, because a shared memory book only makes sense if both people can contribute to any entry. Photo upload goes through `decodeImageBlob`/`bitmapToJpegBlob` (`src/lib/image.ts`) for HEIC support and downsizing before hitting Storage. The "save to device" download button uses `downloadImage` from the same file — deliberately *not* the Web Share API, see that file's entry below for why.
- **`_authenticated/settings.tsx`** — profile (display name, avatar) + invite-allowlist management. Avatar upload doesn't happen directly on file-select — picking a file opens `AvatarCropDialog`, and the actual Storage upload only happens from that dialog's "Save photo" callback. Invite add/remove buttons render for every signed-in user regardless of role, but the underlying RLS is admin-only — see the "newly-invited users never become admin" bullet in §8 before assuming this UI works for everyone who can see it.

### `src/components/` — dialogs & shell

- **`app-shell.tsx`** — the persistent header/nav + mobile bottom tab bar wrapping every authenticated page. Sign-out (`handleSignOut`) explicitly navigates to `/auth` after `signOut()` — signing out alone doesn't redirect, so a second sign-out button elsewhere would need to repeat that `navigate` call.
- **`bucket-item-dialog.tsx`** — create/edit form for a `bucket_items` row; also the source of the exported `BucketItem` type that `calendar.tsx` and `journal.tsx` import (type-only) to agree on shape. Writes go straight from the browser to Supabase (`.insert`/`.update`) — RLS is the only authorization layer, there's no server function in between.
- **`event-dialog.tsx`** — create/edit/delete form for a `calendar_events` row. **Currently unused — see the dead-code bullet in §8** before assuming it's wired into the Calendar page.
- **`avatar-crop-dialog.tsx`** — circular pan/zoom/crop UI for avatar uploads, exporting a fixed 512px JPEG. Renders to `<canvas>` (not CSS transforms on an `<img>`) specifically for correct EXIF orientation and to avoid touch/pointer bugs on Android. If you change the preview box size (`BOX`) or export size (`OUTPUT`) independently, check `handleSave`'s rescale math — it maps the interactive preview transform onto the export canvas using their ratio.

### `src/lib/` — utilities

- **`auth-context.tsx`** — `AuthProvider`/`useAuth()`, the single source of truth for "who's logged in" client-side. See the listener-ordering note above; also defers the profile fetch inside the `onAuthStateChange` callback via `setTimeout(..., 0)` specifically to avoid deadlocking Supabase's internal auth lock (calling another Supabase method synchronously inside that callback is documented by Supabase as unsafe).
- **`image.ts`** — `decodeImageBlob` (HEIC-aware decoding, dynamically imports a ~3MB WASM fallback only when the browser's native decoder fails), `bitmapToJpegBlob` (downscale + re-encode), and `downloadImage` (saves a photo to the device). `downloadImage` deliberately does **not** use `navigator.share` — that opens the OS share sheet (send-to-apps/contacts), which reads as "share this" rather than "download this" and was explicitly rejected after user feedback; it fetches the bytes and clicks a blob-URL `<a download>` instead. iOS Safari still saves to the Files app rather than Camera Roll this way — there's no code-only fix for that on iOS, only the user's own long-press → "Save to Photos" gesture on the rendered `<img>`.
- **`error-capture.ts`** — a tiny global (not per-request) listener that records the last uncaught error/rejection server-side, with a 5-second TTL, so `server.ts` can recover the *real* error after h3 (Nitro's HTTP layer) has already collapsed a thrown error into an opaque generic 500 JSON body. Must be imported for its side effects before any request handling starts (`server.ts` line 1) — it has no exported "capture" function, only `consumeLastCapturedError()`.
- **`error-page.ts`** — `renderErrorPage()`: a hand-written, dependency-free HTML string (inline `<style>`, inline `onclick` reload button, no external JS) for the generic error page — deliberately not a React component, since it has to render correctly even when the reason you're seeing it is that the JS bundle itself failed.
- **`lovable-error-reporting.ts`** — `reportLovableError()`, a no-op-safe optional-chaining bridge to `window.__lovableEvents?.captureException`, a hook injected by the Lovable hosting platform that won't exist at all outside it (e.g. on GitHub Pages/Cloudflare directly) — safe to call unconditionally from anywhere client-side.
- **`utils.ts`** — just the standard shadcn `cn()` class-merge helper (`clsx` + `tailwind-merge`). Used by nearly every file under `components/ui/`; treat it as load-bearing infrastructure, not app code.

### `src/hooks/use-mobile.tsx`

`useIsMobile()`, a `matchMedia`-based 768px breakpoint hook. Only consumer today is the shadcn `Sidebar` primitive — every actual page in this app does responsive layout with plain Tailwind breakpoints (`sm:flex`/`sm:hidden`) instead, so that's the pattern to follow for new UI, not this hook.

### `src/integrations/supabase/` — generated clients

Everything here is Lovable-Cloud-generated (`client.ts`, `client.server.ts`, `types.ts` carry a "do not edit directly" header) except `auth-middleware.ts`/`auth-attacher.ts`, which are hand-written.

- **`client.ts`** — the browser client, exported as `supabase`. Not a plain instance — it's a `Proxy` that constructs the real client lazily on first property access, so a missing env var throws only when `supabase` is actually used, not at module-import time (which matters given how many different build contexts — client, SSR — this module gets pulled into).
- **`client.server.ts`** — `supabaseAdmin`, a service-role client that bypasses RLS entirely. **Currently unused anywhere in the app** (§8). If you do wire it up: it must only ever be imported with a dynamic `await import(...)` *inside* a server handler — a top-level `import` in a route file or `*.functions.ts` file risks the service-role key ending up in a bundle that ships to the browser, since those file types are client-bundled by default.
- **`auth-middleware.ts`** — `requireSupabaseAuth`, a per-request server-function middleware that validates the caller's JWT and builds a Supabase client scoped to that specific user (so RLS sees the real `auth.uid()`, not anon/service-role). **Also currently unused** (§8) — it's the intended attachment point for a future authenticated server function, not something already active.
- **`auth-attacher.ts`** — the client-side counterpart: attaches the current session's access token as an `Authorization: Bearer` header on every outgoing server-function call. Registered globally in `src/start.ts`; if that registration is ever removed, every server-function call silently stops sending its auth header, and the failure only surfaces later, inside whatever middleware expects that header — not at the call site.

### Top-level `src/` files

- **`router.tsx`** — `getRouter()`, called once per client boot and once per SSR request; creates a fresh `QueryClient` each time (not a shared singleton). `defaultPreloadStaleTime: 0` hands all "is this data fresh" logic to React Query instead of TanStack Router's own preload cache.
- **`start.ts`** — global TanStack Start config: registers `attachSupabaseAuth` for every server-function call, and an `errorMiddleware` that rethrows anything with a `statusCode` (redirects, structured HTTP errors — let these pass through untouched) and converts everything else into `renderErrorPage()`'s generic 500. A plain `throw new Error(...)` where you meant `throw redirect(...)` gets swallowed into the generic error page here instead of actually redirecting.
- **`server.ts`** — the real Cloudflare Workers entry point (`vite.config.ts` points `tanstackStart.server.entry` here instead of the framework default). Applies `SECURITY_HEADERS`/CSP to every response, and works around an h3 bug where an in-handler throw gets flattened into an opaque `{"unhandled":true}` JSON 500 that bypasses normal error rendering — `normalizeCatastrophicSsrResponse()` detects that specific shape and swaps in the real error via `error-capture.ts`. **Note the CSP's `connect-src`/`img-src` hardcode this project's specific Supabase project URL** (not read from an env var) — pointing the app at a different Supabase project means updating this file too, or Storage images/API calls/realtime will be silently blocked by the browser, not by Supabase.
