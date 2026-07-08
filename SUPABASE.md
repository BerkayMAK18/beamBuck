# Supabase setup

This document is the complete backend spec for the app. If you follow it top-to-bottom on a fresh Supabase project, the frontend will "just work" once you point `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` at it.

The canonical source of truth is the SQL under `supabase/migrations/` — this file explains **what** each piece is and **why** it exists.

---

## 1. Enums & extensions

```sql
-- Postgres extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Bucket item status: 'planned' (backlog OR scheduled) vs 'done'
CREATE TYPE public.bucket_status AS ENUM ('planned', 'done');

-- App-level roles (only 'admin' is checked today)
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
```

> "Backlog" is **not** a database status — it's `status = 'planned' AND target_date IS NULL`. See CUSTOMIZING.md for how this is computed in the UI.

---

## 2. Tables

### `public.profiles`

One row per authenticated user, mirroring `auth.users`. Populated automatically by the `handle_new_user` trigger below.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Matches `auth.users.id`. Never a real FK — Supabase manages `auth.users`. |
| `email` | `text` NOT NULL | Copied from `auth.users` at signup. |
| `display_name` | `text` | Optional; defaults to the local part of the email. |
| `avatar_url` | `text` | Signed URL from the `avatars` bucket. |
| `created_at` / `updated_at` | `timestamptz` | Managed by `set_updated_at` trigger. |

### `public.allowed_emails`

Invite allowlist. `is_email_allowed()` returns true if the table is empty (first-signup bootstrap) OR if the caller's email is present.

| Column | Type | Notes |
|---|---|---|
| `email` | `text` PK | Case-insensitive check via `lower()` in `is_email_allowed`. |
| `added_at` | `timestamptz` | Defaults to `now()`. |

### `public.user_roles`

Roles are stored in a separate table (never on `profiles`) so `has_role()` can be a `SECURITY DEFINER` helper without recursive RLS. Existing users are seeded as `admin` in the last migration; add new admins by inserting rows here directly.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Default `gen_random_uuid()`. |
| `user_id` | `uuid` NOT NULL | FK → `auth.users(id) ON DELETE CASCADE`. |
| `role` | `public.app_role` | `'admin'` or `'user'`. |
| `created_at` | `timestamptz` | |
| — | UNIQUE (`user_id`, `role`) | |

### `public.bucket_items`

The core table. One row per bucket-list entry.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Default `gen_random_uuid()`. |
| `title` | `text` NOT NULL | |
| `notes` | `text` | Free-form. |
| `category` | `text` | Free string; the UI picks from a fixed list (see `CATEGORIES` in `src/components/bucket-item-dialog.tsx`). |
| `target_date` | `date` | Nullable. `NULL` ⇒ backlog. Non-null ⇒ shown on the Calendar. |
| `target_time` | `time` | Optional time-of-day; only meaningful when `target_date` is set. |
| `status` | `bucket_status` NOT NULL | Default `'planned'`. Set to `'done'` when checked off. |
| `completed_by` | `uuid` | FK → `profiles(id) ON DELETE SET NULL`. Set when marked done. |
| `completed_at` | `timestamptz` | Set when marked done. |
| `image_urls` | `text[]` NOT NULL | Signed URLs into the `bucket-photos` bucket. Default `'{}'`. |
| `links` | `text[]` NOT NULL | Reserved (currently unused by the UI). Default `'{}'`. |
| `created_by` | `uuid` NOT NULL | FK → `profiles(id) ON DELETE CASCADE`. Owner of the row. |
| `created_at` / `updated_at` | `timestamptz` | Managed by `set_updated_at`. |

### `public.calendar_events`

Mirror table kept in sync with `bucket_items` by triggers. The current Calendar UI reads directly from `bucket_items`, but the table still exists (and is written to) so external calendar exporters / iCal sync could be added later.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `bucket_item_id` | `uuid` | FK → `bucket_items(id) ON DELETE SET NULL`. |
| `title` | `text` NOT NULL | |
| `description` | `text` | Mirrors `bucket_items.notes`. |
| `start_at` | `timestamptz` NOT NULL | Built from `target_date` + `target_time`. |
| `end_at` | `timestamptz` | Unused today. |
| `all_day` | `boolean` NOT NULL | True when `target_time` is null. |
| `created_by` | `uuid` NOT NULL | FK → `profiles(id) ON DELETE CASCADE`. |
| `created_at` / `updated_at` | `timestamptz` | |

---

## 3. Storage buckets

Both buckets are **private** (no anonymous read). Signed URLs (365-day) are generated on upload and stored in the DB.

| Bucket | Purpose | Path convention |
|---|---|---|
| `bucket-photos` | Photos uploaded from the Gallery tab | `<user_id>/<timestamp>-<filename>` |
| `avatars` | Profile pictures from Settings | `<user_id>/avatar-<timestamp>.<ext>` |

The path convention matters — the RLS policies below extract the first folder segment and require it to equal `auth.uid()::text`.

---

## 4. Functions

All are defined in `SET search_path = public` for safety.

### `is_email_allowed(_email text) → boolean`
`SECURITY INVOKER`, `STABLE`. Returns true if `allowed_emails` is empty OR `_email` is on the list (case-insensitive). Used by the `profiles` insert policy and by the frontend as a pre-check before sign-up. `EXECUTE` granted to `authenticated` + `service_role`; revoked from `anon`.

### `has_role(_user_id uuid, _role app_role) → boolean`
`SECURITY DEFINER`, `STABLE`. Reads `user_roles` on behalf of the caller. Used inside `allowed_emails` policies so admin checks don't trigger recursive RLS. `EXECUTE` granted to `authenticated` + `service_role`.

### `handle_new_user()` — trigger
`SECURITY DEFINER`. Fires `AFTER INSERT ON auth.users`. Inserts a matching row into `profiles` with `display_name` from `raw_user_meta_data->>'display_name'` (falling back to the email prefix). `ON CONFLICT (id) DO NOTHING`.

### `set_updated_at()` — trigger
Plain `plpgsql`. Fires `BEFORE UPDATE` on every table with an `updated_at` column.

### `sync_bucket_to_calendar()` — trigger
`SECURITY DEFINER`. Fires `AFTER INSERT OR UPDATE ON bucket_items`. Uses `pg_trigger_depth()` to prevent recursion. Behaviour:
- If `target_date IS NULL` OR `status != 'planned'` → delete any linked `calendar_events` row.
- Otherwise, upsert a `calendar_events` row: `start_at = target_date [+ target_time]`, `all_day = target_time IS NULL`.

### `sync_bucket_delete_to_calendar()` — trigger
`SECURITY DEFINER`. Fires `BEFORE DELETE ON bucket_items`. Deletes the linked calendar event.

### `sync_calendar_to_bucket()` — trigger
`SECURITY DEFINER`. Fires `AFTER INSERT OR UPDATE ON calendar_events`. If an event is inserted without a `bucket_item_id`, it creates a matching `bucket_items` row and back-links it. Also mirrors edits back onto the bucket item.

### `sync_calendar_delete_to_bucket()` — trigger
`SECURITY DEFINER`. Fires `BEFORE DELETE ON calendar_events`. Deletes the linked bucket item (recursion-guarded).

> The four `sync_*` functions have `EXECUTE` revoked from `anon` and `authenticated` — they are trigger-only.

---

## 5. Triggers

You need these bindings (function bodies live above):

```sql
-- profiles: created automatically for every new auth user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at maintenance
CREATE TRIGGER set_profiles_updated_at        BEFORE UPDATE ON public.profiles        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_bucket_items_updated_at    BEFORE UPDATE ON public.bucket_items    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bucket_items ⇄ calendar_events sync
CREATE TRIGGER sync_bucket_to_calendar_ins_upd
  AFTER INSERT OR UPDATE ON public.bucket_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bucket_to_calendar();

CREATE TRIGGER sync_bucket_delete_to_calendar_del
  BEFORE DELETE ON public.bucket_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bucket_delete_to_calendar();

CREATE TRIGGER sync_calendar_to_bucket_ins_upd
  AFTER INSERT OR UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_to_bucket();

CREATE TRIGGER sync_calendar_delete_to_bucket_del
  BEFORE DELETE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_delete_to_bucket();
```

---

## 6. GRANTs

Supabase's Data API (PostgREST) does **not** grant default privileges on `public`. Every table needs an explicit grant or requests will 401 even with RLS allowing them.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_emails   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bucket_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events  TO authenticated;
GRANT SELECT                          ON public.user_roles      TO authenticated;

GRANT ALL ON public.profiles, public.allowed_emails, public.bucket_items,
            public.calendar_events, public.user_roles TO service_role;
```

No `anon` grants — every read requires a signed-in user.

---

## 7. Row Level Security

Enable RLS on every public table:

```sql
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_emails   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles       ENABLE ROW LEVEL SECURITY;
```

### `profiles`

| Action | Policy |
|---|---|
| SELECT | Any signed-in user can read all profiles (needed to show "added by …" on cards). |
| INSERT | `auth.uid() = id AND public.is_email_allowed(email)`. |
| UPDATE | `auth.uid() = id` (owner only). |
| DELETE | *No policy → denied.* |

### `allowed_emails`

| Action | Policy |
|---|---|
| SELECT | Any signed-in user. |
| INSERT | `public.has_role(auth.uid(), 'admin')`. |
| DELETE | `public.has_role(auth.uid(), 'admin')`. |
| UPDATE | *No policy → denied.* |

### `bucket_items` (shared-workspace reads, owner-only writes)

| Action | Policy |
|---|---|
| SELECT | Any signed-in user. |
| INSERT | `auth.uid() = created_by`. |
| UPDATE | `auth.uid() = created_by`. |
| DELETE | `auth.uid() = created_by`. |

> UPDATE is owner-only. That means **only the creator can mark their own item as done**. If you want either partner to mark anything done, loosen the UPDATE policy to `USING (true)` — but you'll lose the security-scanner clean bill of health.

### `calendar_events`

Same shape as `bucket_items` — shared reads, owner-only INSERT / UPDATE / DELETE.

### `user_roles`

| Action | Policy |
|---|---|
| SELECT | `auth.uid() = user_id` (users see only their own roles). |
| all others | *No policy → denied.* Grant roles by inserting from a service-role context (SQL editor). |

---

## 8. Storage RLS

Storage policies live on `storage.objects`. Both buckets are private; SELECT is scoped by bucket, writes are scoped by folder = `auth.uid()`.

### `bucket-photos`

| Action | Policy |
|---|---|
| SELECT | `bucket_id = 'bucket-photos'` (any signed-in user reads any photo — Gallery is shared). |
| INSERT | `bucket_id = 'bucket-photos' AND (storage.foldername(name))[1] = auth.uid()::text`. |
| UPDATE | same. |
| DELETE | same. |

### `avatars`

| Action | Policy |
|---|---|
| SELECT | `bucket_id = 'avatars'` (any signed-in user reads any avatar). |
| INSERT / UPDATE / DELETE | `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text`. |

---

## 9. Auth configuration

Under Supabase **Authentication**:

- **Providers → Email**: enabled. "Confirm email" is optional; the app works either way (during dev, auto-confirm is convenient).
- **Policies → Leaked Password Protection (HIBP)**: **on** (recommended).
- **URL Configuration → Site URL**: your app's URL (`http://localhost:5173` in dev). The frontend passes `emailRedirectTo: window.location.origin` at sign-up, so add every hostname you use to the allowed redirect list.
- **No** social providers required. If you want Google/Apple/etc., add them here — the app doesn't currently render provider buttons.

---

## 10. Reproducing from scratch

Cleanest path: `supabase link --project-ref <ref>` then `supabase db push` — every SQL file in `supabase/migrations/` runs in filename order, giving you the exact schema above.

If you can't use the CLI, paste each migration into the SQL editor one at a time, oldest first. The last migration seeds every existing profile as an `admin`; on a fresh project it does nothing (no profiles exist yet) so you'll need to insert your own admin row after your first sign-up:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM public.profiles;
```

Run that once from the SQL editor after the first person signs up, and they can start adding invites from Settings.
