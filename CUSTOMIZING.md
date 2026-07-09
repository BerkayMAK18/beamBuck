# Customizing the app

This guide covers the things you'll most likely want to change when self-hosting: the categories list, the visual branding, the Backlog/Planned/Done rules, and where uploads land in storage.

All changes are frontend-only unless called out otherwise. After editing, `bun run dev` picks up changes with HMR — no migration required.

---

## 1. Categories

The category dropdown in the "Add/Edit item" dialog is a plain hardcoded array. `category` in the DB is a nullable free-text column, so old items with removed categories keep working.

**File:** `src/components/bucket-item-dialog.tsx`

```ts
const CATEGORIES = ["Travel", "Food", "Adventure", "Learn", "Together", "Create"];
```

Add, remove, or rename entries as you like. Categories are stored on `bucket_items.category` verbatim.

If you want more structure (e.g. an icon per category, or a color badge), the display sites are:

- `src/routes/_authenticated/bucket.tsx` — the `<Badge variant="secondary">{item.category}</Badge>` rendering the category chip on each card.
- `src/routes/_authenticated/calendar.tsx` — same badge inside each day group.

> Renaming a category **doesn't rewrite existing rows**. If you rename "Travel" → "Trips", old items keep `category = "Travel"`. Either run a one-off `UPDATE public.bucket_items SET category = 'Trips' WHERE category = 'Travel';` from the SQL editor, or leave both.

---

## 2. Branding — app name, colors, fonts

### App name (visible everywhere)

The literal string `"Bucket List App"` appears in exactly two places in the UI:

- `src/components/app-shell.tsx` — the top-left brand link (`<Link to="/calendar">…</Link>`).
- `src/routes/auth.tsx` — the big serif headline on the sign-in page.

Also update the browser tab title / meta description / OG tags in `src/routes/__root.tsx` (inside `head: () => ({ meta: [...] })`).

### Colors (design system)

All colors are semantic CSS variables in `src/styles.css`. The palette comment at the top of the file names the concept ("Dreamy Pastel — cream / blush / sky / slate"). Change values, not usages.

Key tokens (`:root` block):

| Token | Role |
|---|---|
| `--background`, `--foreground` | Base page canvas + text |
| `--card`, `--card-foreground` | Card surfaces (used by `.glass-card` and shadcn `Card`) |
| `--primary`, `--primary-foreground` | Active nav pill, primary buttons, checked-done circle |
| `--secondary`, `--secondary-foreground` | Sky accents, avatar fallbacks |
| `--muted`, `--muted-foreground` | Muted backgrounds and secondary text |
| `--accent`, `--accent-foreground` | Hover states |
| `--destructive`, `--destructive-foreground` | Delete buttons + destructive alert dialog |
| `--border`, `--input`, `--ring` | Borders + focus rings |
| `--blush`, `--sky`, `--sunset` | Named palette colors used in gradients |

All values are `oklch(...)`. If you prefer HSL/hex, use any converter — the format is arbitrary as long as it's a valid CSS color.

There is a `.dark` scope below `:root` for dark-mode overrides; the app doesn't ship with a light/dark toggle, but the tokens are there if you add one.

> **Never hardcode colors like `text-white` or `bg-[#fff]` in components.** They bypass the token system and break any theme change. Always reach for `bg-primary`, `text-muted-foreground`, `border-border`, etc.

### Fonts

Two font families are imported globally via `@fontsource/*` in `src/routes/__root.tsx`:

```ts
import "@fontsource/fraunces/400.css";  // serif — headings
import "@fontsource/inter/400.css";     // sans — body
```

They're wired to Tailwind via the `--font-serif` and `--font-sans` tokens in `src/styles.css`. Swap the imports (any `@fontsource/<family>` package) and change the token values in one place:

```css
--font-serif: "Fraunces", ui-serif, Georgia, serif;
--font-sans:  "Inter",    ui-sans-serif, system-ui, sans-serif;
```

Any element with `font-serif` (like page headings and dialog titles) will follow.

### Favicon / OG image

Update `<link rel="icon" ...>` in `src/routes/__root.tsx`'s `head()`. Same place holds the `og:image` if you want a social preview.

---

## 3. Backlog / Planned / Done status logic

The database only has two statuses: **`planned`** and **`done`** (see `SUPABASE.md` — the `bucket_status` enum). "Backlog" is a **UI-only** distinction inside the "planned" bucket: it means "planned but with no date yet".

All the logic lives in **`src/routes/_authenticated/bucket.tsx`**:

```ts
// The three filter tabs
const [filter, setFilter] = useState<"backlog" | "planned" | "done">("backlog");

// What each tab shows
const filtered = useMemo(() => items.filter((i) => {
  if (filter === "done")    return i.status === "done";
  if (filter === "planned") return i.status === "planned" && !!i.target_date;
  return                          i.status === "planned" && !i.target_date; // backlog
}), [items, filter]);

// Counts shown in the pill labels
const stats = useMemo(() => ({
  total:   items.length,
  done:    items.filter(i => i.status === "done").length,
  backlog: items.filter(i => i.status === "planned" && !i.target_date).length,
  planned: items.filter(i => i.status === "planned" &&  !!i.target_date).length,
}), [items]);
```

And the toggle-done action:

```ts
const next = item.status === "done"
  ? { status: "planned", completed_by: null, completed_at: null }
  : { status: "done",    completed_by: user.id, completed_at: new Date().toISOString() };
```

### Common tweaks

- **Add an "Overdue" filter** — a planned item whose `target_date` is in the past:
  ```ts
  if (filter === "overdue")
    return i.status === "planned" && i.target_date && parseISO(i.target_date) < new Date();
  ```
  Also add `"overdue"` to the `filter` union type and the pill list.

- **Change what appears on the Calendar** — the Calendar reads directly from `bucket_items` in `src/routes/_authenticated/calendar.tsx`:
  ```ts
  supabase.from("bucket_items")
    .select("*")
    .eq("status", "planned")
    .not("target_date", "is", null)
    .order("target_date", { ascending: true })
    .order("target_time", { ascending: true, nullsFirst: true });
  ```
  Change the `.eq(...)` / `.not(...)` filters to include done items, past dates, etc.

- **Change what appears in the Journal** — the Journal filters to `status = 'done'` in `src/routes/_authenticated/journal.tsx`. Swap the filter if you want a different curation rule.

- **Move to real Backlog as a DB status** — add a new value to the `bucket_status` enum via a migration, backfill (`UPDATE bucket_items SET status = 'backlog' WHERE status = 'planned' AND target_date IS NULL;`), then update `src/components/bucket-item-dialog.tsx`'s `BucketItem` type union and every `.eq("status", …)` call. This is a bigger change but removes the "backlog is a computed pseudo-state" gotcha.

---

## 4. Storage paths (Journal photos + avatars)

**Buckets are `bucket-photos` (Journal photos) and `avatars` (profile pictures).** Both are private; the app generates 365-day signed URLs on upload and persists those URLs into the DB.

### Journal photo uploads

**File:** `src/routes/_authenticated/journal.tsx` → `uploadPhotos`

```ts
const bitmap = await decodeImageBlob(file);           // HEIC-aware decode, src/lib/image.ts
const blob = await bitmapToJpegBlob(bitmap, 1920);     // downscale + re-encode as JPEG
const path = `${user.id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
await supabase.storage.from("bucket-photos").upload(path, blob, { contentType: "image/jpeg" });
const { data: signed } = await supabase.storage
  .from("bucket-photos")
  .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year
await supabase.from("journal_photos").insert({ bucket_item_id: item.id, url: signed.signedUrl, created_by: user.id });
```

Every upload is normalized to JPEG regardless of source format — this is what lets HEIC photos from iPhones upload at all, since most browsers other than Safari can't decode HEIC natively. The URL is stored in the `journal_photos` table, not on `bucket_items` directly — see `SUPABASE.md` §2 (`journal_photos`). The older `bucket_items.image_urls` column is legacy/unused; don't write to it.

The `<user_id>/…` prefix is **not optional** — the storage RLS policy (see `SUPABASE.md` § 8) requires it, otherwise the upload is rejected.

### Avatar uploads

**File:** `src/routes/_authenticated/settings.tsx`

```ts
const path = `${user.id}/avatar-${Date.now()}.${ext}`;
await supabase.storage.from("avatars").upload(path, file, { upsert: true });
const { data: signed } = await supabase.storage
  .from("avatars")
  .createSignedUrl(path, 60 * 60 * 24 * 365);
```

Same `<user_id>/…` prefix rule.

### Common tweaks

- **Different bucket names** — change every `supabase.storage.from("bucket-photos")` / `.from("avatars")` reference (there are only two files each), then update the storage RLS policies to reference the new `bucket_id`.
- **Public URLs instead of signed URLs** — flip the bucket to Public in the Supabase dashboard and replace `createSignedUrl(...)` with `getPublicUrl(path).data.publicUrl`. You lose expiry, and anyone with the URL can view.
- **Longer / shorter signed URL lifetime** — change the second arg to `createSignedUrl` (in seconds). Note: once the URL is stored in `journal_photos.url` (or `profiles.avatar_url`), it doesn't refresh; when the signature expires, images 404. If you need long-term URLs, either use `getPublicUrl` or add a re-sign step on read.
- **Nested folders** (e.g. `<user_id>/<item_id>/<filename>`) — safe as long as the first path segment is still `auth.uid()`. Update the code, but leave the storage policy alone.
- **Server-side thumbnails / resizing** — this app doesn't do any. Supabase Image Transformations (`.getPublicUrl(path, { transform: { width: 400 } })`) works with private buckets via signed URLs too if you want that.

---

## 5. Navigation & routes

The main navigation is a plain array in **`src/components/app-shell.tsx`**:

```ts
const NAV = [
  { to: "/calendar", label: "Calendar", icon: CalendarHeart },
  { to: "/bucket",   label: "Bucket",   icon: ListChecks },
  { to: "/journal",  label: "Journal",  icon: BookHeart },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;
```

To add a page:

1. Create `src/routes/_authenticated/<name>.tsx` (see any existing one — it's `createFileRoute("/_authenticated/<name>")`).
2. Add an entry to `NAV`.
3. TanStack Router regenerates `src/routeTree.gen.ts` automatically — don't edit it by hand.

To rename `/bucket` → `/list`: rename the route file *and* update every `<Link to="/bucket">`, the `NAV` entry, and the `useLocation().pathname.startsWith("/bucket")` check in `app-shell.tsx`.

---

## 6. Realtime channels

Both `bucket.tsx`, `calendar.tsx`, and `journal.tsx` subscribe to `postgres_changes` on `bucket_items`:

```ts
supabase.channel("bucket_items_changes")
  .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
  .subscribe();
```

`journal.tsx` additionally subscribes to `journal_photos` and `journal_notes` on the same channel — see the file for the exact `.on(...)` chain if you're adding realtime for a new table.

If you don't want realtime (e.g. to reduce Supabase bandwidth), delete the `.channel(...).subscribe()` blocks — the app still works, you just need to refresh manually to see the other user's changes. If you add new tables and want realtime on them, first enable it on the table in the Supabase dashboard (Database → Replication → `supabase_realtime` publication).

---

## 7. Where things are wired up (cheat sheet)

| I want to change… | Look at… |
|---|---|
| Category list | `src/components/bucket-item-dialog.tsx` → `CATEGORIES` |
| Colors / theme | `src/styles.css` (`:root` + `.dark`) |
| Fonts | `src/routes/__root.tsx` (imports) + `src/styles.css` (`--font-*` tokens) |
| App name | `src/components/app-shell.tsx` + `src/routes/auth.tsx` + `src/routes/__root.tsx` head |
| Nav items | `src/components/app-shell.tsx` → `NAV` |
| Backlog / Planned / Done logic | `src/routes/_authenticated/bucket.tsx` (`filtered`, `stats`, `toggleDone`) |
| What appears on Calendar | `src/routes/_authenticated/calendar.tsx` (Supabase query filters) |
| What appears in Journal | `src/routes/_authenticated/journal.tsx` (Supabase query filters) |
| Photo upload path | `src/routes/_authenticated/journal.tsx` → `uploadPhotos` |
| Avatar upload path | `src/routes/_authenticated/settings.tsx` → `uploadAvatar` |
| Signed URL expiry | search for `createSignedUrl(` — always the second arg |
| Auth flow | `src/routes/auth.tsx` + `src/lib/auth-context.tsx` |
| Auth gate for protected pages | `src/routes/_authenticated/route.tsx` |

That's the whole customization surface. Anything else is either shadcn/ui primitives under `src/components/ui/` (safe to edit) or auto-generated (`src/routeTree.gen.ts`, `src/integrations/supabase/*` — regenerated by Supabase CLI or the Lovable tooling, so hand-edits get overwritten).
