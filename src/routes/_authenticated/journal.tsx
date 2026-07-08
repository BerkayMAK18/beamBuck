import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BucketItem } from "@/components/bucket-item-dialog";
import { decodeImageBlob, bitmapToJpegBlob } from "@/lib/image";
import {
  Upload, BookHeart, X, ChevronLeft, ChevronRight, Calendar as CalIcon, ArrowUpDown, ImageOff, Send, Pencil, Loader2, Info,
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/journal")({
  component: JournalPage,
});

type Profile = { id: string; display_name: string | null; email: string; avatar_url: string | null };
type Photo = { id: string; bucket_item_id: string; url: string; caption: string | null; created_by: string; created_at: string };
type Note = { id: string; bucket_item_id: string; body: string; created_by: string; created_at: string; updated_at: string };
type PhotoIssue = "repairing" | "failed";
type SortMode = "recent" | "oldest";

const fmtWhen = (item: BucketItem) => {
  if (!item.target_date) return null;
  const d = format(parseISO(item.target_date), "MMM d, yyyy");
  return item.target_time ? `${d} · ${item.target_time.slice(0, 5)}` : d;
};

const fmtNoteTime = (iso: string) => format(parseISO(iso), "MMM d, yyyy 'at' h:mm a");

function JournalPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<BucketItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("recent");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lightbox, setLightbox] = useState<{ itemId: string; index: number } | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [photoIssues, setPhotoIssues] = useState<Record<string, PhotoIssue>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const load = async () => {
    const [{ data, error }, { data: profs }, { data: photoRows }, { data: noteRows }] = await Promise.all([
      supabase.from("bucket_items").select("*").eq("status", "done").order("completed_at", { ascending: false }),
      supabase.from("profiles").select("id,display_name,email,avatar_url"),
      supabase.from("journal_photos").select("*").order("created_at", { ascending: true }),
      supabase.from("journal_notes").select("*").order("created_at", { ascending: true }),
    ]);
    if (error) { toast.error(error.message); return; }
    setItems((data ?? []) as BucketItem[]);
    const map: Record<string, Profile> = {};
    (profs ?? []).forEach((p) => { map[p.id] = p as Profile; });
    setProfiles(map);
    setPhotos((photoRows ?? []) as Photo[]);
    setNotes((noteRows ?? []) as Note[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("journal_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_photos" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "journal_notes" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const uploadPhotos = async (item: BucketItem, files: FileList) => {
    if (!user || files.length === 0) return;
    setUploadingId(item.id);
    let added = 0;
    for (const file of Array.from(files)) {
      try {
        const bitmap = await decodeImageBlob(file);
        const blob = await bitmapToJpegBlob(bitmap, 1920);
        const path = `${user.id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
        const { error: upErr } = await supabase.storage.from("bucket-photos").upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) { toast.error(upErr.message); continue; }
        const { data: signed, error: signErr } = await supabase.storage.from("bucket-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signErr || !signed) { toast.error(signErr?.message ?? "Could not create image URL"); continue; }
        const { error } = await supabase.from("journal_photos").insert({ bucket_item_id: item.id, url: signed.signedUrl, created_by: user.id });
        if (error) { toast.error(error.message); continue; }
        added++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not process that photo");
      }
    }
    if (added) { toast.success(added === 1 ? "Photo added" : `${added} photos added`); void load(); }
    setUploadingId(null);
  };

  const saveCaption = async (photo: Photo, caption: string) => {
    if (caption === (photo.caption ?? "")) return;
    const { error } = await supabase.from("journal_photos").update({ caption: caption || null }).eq("id", photo.id);
    if (error) { toast.error(error.message); return; }
    setPhotos((cur) => cur.map((p) => (p.id === photo.id ? { ...p, caption: caption || null } : p)));
  };

  const removePhoto = async (photo: Photo) => {
    const { error } = await supabase.from("journal_photos").delete().eq("id", photo.id);
    if (error) { toast.error(error.message); return; }
    setPhotos((cur) => cur.filter((p) => p.id !== photo.id));
  };

  // Some already-uploaded photos are raw HEIC and can't render in <img> on
  // most browsers. When one fails to load, re-fetch it, decode it (via the
  // same HEIC-capable path as new uploads), and re-save it as a JPEG so it's
  // fixed for good instead of failing the same way on every future visit.
  const repairPhoto = async (photo: Photo) => {
    if (!user || photoIssues[photo.id] === "repairing") return;
    setPhotoIssues((cur) => ({ ...cur, [photo.id]: "repairing" }));
    try {
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error("Could not load the original photo");
      const blob = await res.blob();
      const bitmap = await decodeImageBlob(blob);
      const jpeg = await bitmapToJpegBlob(bitmap, 1920);
      const path = `${user.id}/${Date.now()}-repaired.jpg`;
      const { error: upErr } = await supabase.storage.from("bucket-photos").upload(path, jpeg, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage.from("bucket-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed) throw signErr ?? new Error("Could not create image URL");
      const { error: updateErr } = await supabase.from("journal_photos").update({ url: signed.signedUrl }).eq("id", photo.id);
      if (updateErr) throw updateErr;
      setPhotos((cur) => cur.map((p) => (p.id === photo.id ? { ...p, url: signed.signedUrl } : p)));
      setPhotoIssues((cur) => { const next = { ...cur }; delete next[photo.id]; return next; });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fix this photo");
      setPhotoIssues((cur) => ({ ...cur, [photo.id]: "failed" }));
    }
  };

  const postNote = async (item: BucketItem) => {
    const body = (noteDrafts[item.id] ?? "").trim();
    if (!body || !user) return;
    const { error } = await supabase.from("journal_notes").insert({ bucket_item_id: item.id, body, created_by: user.id });
    if (error) { toast.error(error.message); return; }
    setNoteDrafts((cur) => ({ ...cur, [item.id]: "" }));
    void load();
  };

  const removeNote = async (note: Note) => {
    const { error } = await supabase.from("journal_notes").delete().eq("id", note.id);
    if (error) { toast.error(error.message); return; }
    setNotes((cur) => cur.filter((n) => n.id !== note.id));
  };

  const startEditNote = (note: Note) => { setEditingNoteId(note.id); setEditDraft(note.body); };
  const cancelEditNote = () => { setEditingNoteId(null); setEditDraft(""); };

  const saveEditNote = async (note: Note) => {
    const body = editDraft.trim();
    if (!body) return;
    const { error } = await supabase.from("journal_notes").update({ body }).eq("id", note.id);
    if (error) { toast.error(error.message); return; }
    cancelEditNote();
    void load();
  };

  const filteredItems = useMemo(() => {
    if (!dateFrom && !dateTo) return items;
    return items.filter((it) => {
      const day = it.completed_at?.slice(0, 10);
      if (!day) return false;
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [items, dateFrom, dateTo]);

  const sortedItems = useMemo(
    () => (sort === "recent" ? filteredItems : [...filteredItems].reverse()),
    [filteredItems, sort],
  );

  const photosByItem = useMemo(() => {
    const map: Record<string, Photo[]> = {};
    photos.forEach((p) => { (map[p.bucket_item_id] ??= []).push(p); });
    return map;
  }, [photos]);

  const notesByItem = useMemo(() => {
    const map: Record<string, Note[]> = {};
    notes.forEach((n) => { (map[n.bucket_item_id] ??= []).push(n); });
    return map;
  }, [notes]);

  const activeItem = lightbox ? items.find((i) => i.id === lightbox.itemId) ?? null : null;
  const activePhotos = activeItem ? photosByItem[activeItem.id] ?? [] : [];
  const activePhoto = activePhotos[Math.min(lightbox?.index ?? 0, activePhotos.length - 1)];

  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl sm:text-5xl mb-2">Journal</h1>
          <p className="text-muted-foreground">Memories, photos, and notes from every completed item.</p>
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger className="w-[180px] rounded-full">
            <ArrowUpDown className="w-4 h-4 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="oldest">Least recent</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="mb-6 flex items-center gap-2 flex-wrap text-sm">
        <span className="text-muted-foreground">From</span>
        <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="w-auto rounded-full" />
        <span className="text-muted-foreground">to</span>
        <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="w-auto rounded-full" />
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => { setDateFrom(""); setDateTo(""); }}>
            Clear
          </Button>
        )}
      </section>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : sortedItems.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <BookHeart className="w-8 h-8 mx-auto mb-3 text-primary" />
          {items.length === 0 ? (
            <>
              <h3 className="text-xl mb-1">Nothing to show yet</h3>
              <p className="text-muted-foreground text-sm">Complete an item on your bucket list to start a memory page here.</p>
            </>
          ) : (
            <>
              <h3 className="text-xl mb-1">No memories in that range</h3>
              <p className="text-muted-foreground text-sm">Try widening the date range.</p>
            </>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedItems.map((item) => {
            const creator = profiles[item.created_by];
            const when = fmtWhen(item);
            const itemPhotos = photosByItem[item.id] ?? [];
            const itemNotes = notesByItem[item.id] ?? [];
            return (
              <Card key={item.id} className="glass-card p-5 flex flex-col gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xl leading-snug">{item.title}</h3>
                    {item.notes && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            aria-label="Item description"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="text-sm whitespace-pre-wrap">{item.notes}</PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                    {item.category && <Badge variant="secondary" className="rounded-full text-[10px]">{item.category}</Badge>}
                    {when && (
                      <span className="inline-flex items-center gap-1">
                        <CalIcon className="w-3 h-3" /> {when}
                      </span>
                    )}
                    {creator && (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar className="w-4 h-4">
                          {creator.avatar_url && <AvatarImage src={creator.avatar_url} alt="" />}
                          <AvatarFallback className="text-[8px]">{(creator.display_name || creator.email).slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {creator.display_name || creator.email.split("@")[0]}
                      </span>
                    )}
                  </div>
                </div>

                {itemPhotos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {itemPhotos.map((photo, idx) => (
                      <PhotoTile
                        key={photo.id}
                        photo={photo}
                        issue={photoIssues[photo.id]}
                        onOpen={() => setLightbox({ itemId: item.id, index: idx })}
                        onCaptionBlur={(v) => void saveCaption(photo, v)}
                        onRemove={() => void removePhoto(photo)}
                        onFix={() => void repairPhoto(photo)}
                      />
                    ))}
                  </div>
                )}

                <label className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-full bg-muted hover:bg-muted/70 cursor-pointer w-fit">
                  <Upload className="w-4 h-4" />
                  {uploadingId === item.id ? "Uploading…" : "Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploadingId === item.id}
                    onChange={(e) => { if (e.target.files) void uploadPhotos(item, e.target.files); e.target.value = ""; }}
                  />
                </label>

                <div className="border-t border-border/50 pt-4 space-y-3">
                  {itemNotes.map((note) => {
                    const author = profiles[note.created_by];
                    const isOwn = note.created_by === user?.id;
                    const isEditing = editingNoteId === note.id;
                    const edited = note.updated_at !== note.created_at;
                    return (
                      <div key={note.id} className="flex items-start gap-2.5 group">
                        <Avatar className="w-6 h-6 shrink-0 mt-0.5">
                          {author?.avatar_url && <AvatarImage src={author.avatar_url} alt="" />}
                          <AvatarFallback className="text-[9px]">{(author?.display_name || author?.email || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">{author?.display_name || author?.email.split("@")[0] || "Someone"}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {fmtNoteTime(note.created_at)}{edited && " · edited"}
                            </span>
                          </div>
                          {isEditing ? (
                            <div className="flex items-center gap-2 mt-1">
                              <Input
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") void saveEditNote(note); if (e.key === "Escape") cancelEditNote(); }}
                                autoFocus
                                className="rounded-full h-8"
                              />
                              <Button size="sm" className="rounded-full shrink-0" onClick={() => void saveEditNote(note)}>Save</Button>
                              <Button size="sm" variant="outline" className="rounded-full shrink-0" onClick={cancelEditNote}>Cancel</Button>
                            </div>
                          ) : (
                            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{note.body}</p>
                          )}
                        </div>
                        {isOwn && !isEditing && (
                          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition shrink-0">
                            <button onClick={() => startEditNote(note)} className="text-muted-foreground hover:text-foreground p-0.5" aria-label="Edit note">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => void removeNote(note)} className="text-muted-foreground hover:text-destructive p-0.5" aria-label="Delete note">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      placeholder="Add a note…"
                      value={noteDrafts[item.id] ?? ""}
                      onChange={(e) => setNoteDrafts((cur) => ({ ...cur, [item.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void postNote(item); }}
                      className="rounded-full"
                    />
                    <Button size="icon" className="rounded-full shrink-0" onClick={() => void postNote(item)} aria-label="Post note">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!lightbox} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-0 bg-transparent border-0 shadow-none">
          {lightbox && activeItem && activePhoto && (
            <div className="relative">
              <img src={activePhoto.url} alt={activePhoto.caption ?? ""} className="w-full max-h-[80vh] object-contain rounded-lg" />
              {activePhotos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLightbox((l) => l && ({ ...l, index: (l.index - 1 + activePhotos.length) % activePhotos.length }))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur rounded-full p-2"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightbox((l) => l && ({ ...l, index: (l.index + 1) % activePhotos.length }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur rounded-full p-2"
                    aria-label="Next"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-4 rounded-b-lg">
                <div className="flex items-end justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{activeItem.title}</div>
                    {activePhoto.caption && <div className="text-xs text-muted-foreground mt-0.5">{activePhoto.caption}</div>}
                  </div>
                  {activePhotos.length > 1 && (
                    <div className="text-xs text-muted-foreground">
                      {Math.min(lightbox.index, activePhotos.length - 1) + 1} / {activePhotos.length}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PhotoTile({
  photo, issue, onOpen, onCaptionBlur, onRemove, onFix,
}: {
  photo: Photo;
  issue?: PhotoIssue;
  onOpen: () => void;
  onCaptionBlur: (value: string) => void;
  onRemove: () => void;
  onFix: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? "");

  return (
    <div className="flex flex-col gap-1">
      <div className="relative group aspect-square">
        {issue === "repairing" ? (
          <div className="flex flex-col items-center justify-center gap-1 w-full h-full rounded-lg bg-muted/60 border border-dashed border-border text-center px-2">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            <span className="text-[10px] text-muted-foreground">Fixing photo…</span>
          </div>
        ) : issue === "failed" ? (
          <button
            type="button"
            onClick={onFix}
            className="flex flex-col items-center justify-center gap-1 w-full h-full rounded-lg bg-muted/60 border border-dashed border-border text-center px-2"
          >
            <ImageOff className="w-5 h-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Can't preview this photo — tap to retry</span>
          </button>
        ) : (
          <button type="button" onClick={onOpen} className="block w-full h-full overflow-hidden rounded-lg">
            <img
              src={photo.url}
              alt={photo.caption ?? ""}
              loading="lazy"
              onError={onFix}
              className="w-full h-full object-cover hover:scale-105 transition"
            />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 bg-background/80 backdrop-blur rounded-full p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
          aria-label="Remove photo"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => onCaptionBlur(caption)}
        placeholder="Add a caption…"
        className="text-[11px] bg-transparent border-none px-1 py-0.5 placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring rounded"
      />
    </div>
  );
}
