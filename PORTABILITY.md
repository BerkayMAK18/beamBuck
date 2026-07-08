# Portability guide

This app runs on **Lovable Cloud** (a managed Supabase project) but is designed so you can move it to a different backend/stack with a few well-scoped rewrites. This document lists exactly what depends on Lovable Cloud, where the coupling lives, and what you'd need to reproduce elsewhere.

## What Lovable Cloud provides today

| Concern | Provided by | Files that touch it |
|---|---|---|
| Postgres database | Supabase Postgres | Migrations in `supabase/migrations/` |
| Auth (email/password) | Supabase Auth | `src/lib/auth-context.tsx`, `src/routes/auth.tsx`, `src/routes/_authenticated/route.tsx` |
| Row-level security | Postgres RLS policies | Migrations |
| File storage | Supabase Storage bucket `bucket-photos` | `src/components/bucket-item-dialog.tsx` (upload + signed URLs) |
| Realtime updates | Supabase Realtime (Postgres CDC) | `src/routes/_authenticated/bucket.tsx`, `src/routes/_authenticated/calendar.tsx` |
| Client SDK | `@supabase/supabase-js` via `src/integrations/supabase/client.ts` (auto-generated) | Every route/component that reads or writes data |

All of these are open protocols or standard SQL — nothing is Supabase-proprietary at the data layer.

## Data model (portable SQL)

All tables live in the `public` schema. The full canonical schema:

```sql
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY,              -- matches the auth user id
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE bucket_status AS ENUM ('planned', 'done');

CREATE TABLE bucket_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  notes TEXT,
  category TEXT,
  target_date DATE,
  status bucket_status NOT NULL DEFAULT 'planned',
  completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  links TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_item_id UUID REFERENCES bucket_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Security rules (in plain English)

- `allowed_emails`: signed-in users can read, add, and remove entries. The list gates who can create a profile.
- `profiles`: any signed-in user can read all profiles (needed to show "done by …"). A user can only insert their own profile, and only if their email is on the allowlist. Only the owner can update their profile.
- `bucket_items` and `calendar_events`: any signed-in user can read/insert/update/delete every row. This is intentional — the whole app is a two-person shared workspace.
- `bucket-photos` storage bucket: any signed-in user can read/write/delete files.

If you move to a stack **without RLS**, enforce these rules in your API layer instead. If you don't need the "invite-only" gate at all (e.g. you're the only server that creates accounts), you can drop `allowed_emails` and the `is_email_allowed` RPC.

## Frontend coupling points (search-and-replace targets)

Every Supabase call goes through **one** import:

```ts
import { supabase } from "@/integrations/supabase/client";
```

To swap backends, replace that module with something that exposes the same surface. The app only uses:

- `supabase.auth.signUp`, `signInWithPassword`, `signOut`, `getSession`, `getUser`, `onAuthStateChange`
- `supabase.from(table).select/insert/update/delete/eq/order/maybeSingle`
- `supabase.rpc("is_email_allowed", { _email })`
- `supabase.storage.from("bucket-photos").upload / createSignedUrl`
- `supabase.channel(...).on("postgres_changes", …).subscribe()` for realtime, plus `supabase.removeChannel`

If the target stack doesn't have realtime, delete the `supabase.channel` blocks in `bucket.tsx` and `calendar.tsx`; the app still works, users just need to refresh to see the other person's edits.

## Suggested migration paths

1. **Self-hosted Supabase** — near-zero code changes. Just point `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` at your instance and run the migrations.
2. **Different Postgres + custom API (Node/Bun/Hono/Express)** — run the SQL above, build a small REST/tRPC layer, then re-implement `src/integrations/supabase/client.ts` as a thin adapter that speaks your API. Keep the same method names to minimize edits.
3. **Firebase / Convex / PocketBase / etc.** — port the schema (arrays become subcollections in Firestore), reimplement the client adapter, and delete `_email_allowed` + realtime channels if the platform has native equivalents.

## Files unique to this stack (safe to delete when moving)

- `src/integrations/supabase/` (entire folder — auto-generated by Lovable Cloud)
- `supabase/` (migrations + generated config)
- `src/lib/auth-context.tsx` — rewrite against your auth SDK
- Anywhere `.from("…")`, `.rpc("…")`, `.storage`, `.channel(` appears

## What's already portable

- All UI, styling (`src/styles.css` design system), routing (TanStack Router), and business logic
- The database schema (standard SQL, no Supabase extensions required beyond `pgcrypto` for `gen_random_uuid()`)
- Component structure and TypeScript types (`BucketItem`, `CalendarEvent`) are hand-written, not generated

Good luck out there. 💫