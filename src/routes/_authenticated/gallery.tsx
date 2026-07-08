import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BucketItem } from "@/components/bucket-item-dialog";
import { Upload, Images as ImagesIcon, X, ChevronLeft, ChevronRight, Calendar as CalIcon, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/gallery")({
  component: GalleryPage,
});

type Profile = { id: string; display_name: string | null; email: string; avatar_url: string | null };

type SortMode = "recent" | "oldest";

const fmtWhen = (item: BucketItem) => {
  if (!item.target_date) return null;
  const d = format(parseISO(item.target_date), "MMM d, yyyy");
  return item.target_time ? `${d} · ${item.target_time.slice(0, 5)}` : d;
};

function GalleryPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<BucketItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("recent");
  const [lightbox, setLightbox] = useState<{ itemId: string; index: number } | null>(null);

  const load = async () => {
    const [{ data, error }, { data: profs }] = await Promise.all([
      supabase.from("bucket_items").select("*").eq("status", "done").order("completed_at", { ascending: false }),
      supabase.from("profiles").select("id,display_name,email,avatar_url"),
    ]);
    if (error) { toast.error(error.message); return; }
    setItems((data ?? []) as BucketItem[]);
    const map: Record<string, Profile> = {};
    (profs ?? []).forEach((p) => { map[p.id] = p as Profile; });
    setProfiles(map);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("gallery_bucket_items")
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const uploadPhotos = async (item: BucketItem, files: FileList) => {
    if (!user || files.length === 0) return;
    setUploadingId(item.id);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("bucket-photos").upload(path, file);
      if (upErr) { toast.error(upErr.message); continue; }
      const { data: signed } = await supabase.storage.from("bucket-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signed?.signedUrl) newUrls.push(signed.signedUrl);
    }
    if (newUrls.length) {
      const merged = [...(item.image_urls ?? []), ...newUrls];
      const { error } = await supabase.from("bucket_items").update({ image_urls: merged }).eq("id", item.id);
      if (error) toast.error(error.message);
      else {
        setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, image_urls: merged } : i)));
        toast.success(newUrls.length === 1 ? "Photo added" : `${newUrls.length} photos added`);
      }
    }
    setUploadingId(null);
  };

  const removePhoto = async (item: BucketItem, url: string) => {
    const next = (item.image_urls ?? []).filter((u) => u !== url);
    const { error } = await supabase.from("bucket_items").update({ image_urls: next }).eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, image_urls: next } : i)));
  };

  const sortedItems = useMemo(() => {
    if (sort === "recent") return items;
    return [...items].reverse();
  }, [items, sort]);

  const activeItem = lightbox ? items.find((i) => i.id === lightbox.itemId) ?? null : null;
  const activeUrls = activeItem?.image_urls ?? [];
  const activeCreator = activeItem ? profiles[activeItem.created_by] : null;

  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl sm:text-5xl mb-2">Gallery</h1>
          <p className="text-muted-foreground">Memories from every completed item.</p>
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

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <ImagesIcon className="w-8 h-8 mx-auto mb-3 text-primary" />
          <h3 className="text-xl mb-1">Nothing to show yet</h3>
          <p className="text-muted-foreground text-sm">Complete an item on your bucket list to fill this gallery.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedItems.map((item) => {
            const creator = profiles[item.created_by];
            const when = fmtWhen(item);
            return (
            <Card key={item.id} className="glass-card p-4 flex flex-col gap-3">
              <div>
                <h3 className="text-lg leading-snug">{item.title}</h3>
                {item.category && <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
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

              {item.image_urls && item.image_urls.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {item.image_urls.map((url, idx) => (
                    <div key={url} className="relative group aspect-square">
                      <button
                        type="button"
                        onClick={() => setLightbox({ itemId: item.id, index: idx })}
                        className="block w-full h-full overflow-hidden rounded-lg"
                      >
                        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover hover:scale-105 transition" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removePhoto(item, url)}
                        className="absolute top-1 right-1 bg-background/80 backdrop-blur rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                        aria-label="Remove photo"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="aspect-video rounded-lg bg-muted/50 border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                  No photos yet
                </div>
              )}

              <label className="mt-auto inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-full bg-muted hover:bg-muted/70 cursor-pointer">
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
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!lightbox} onOpenChange={(v) => !v && setLightbox(null)}>
        <DialogContent className="max-w-3xl p-0 bg-transparent border-0 shadow-none">
          {lightbox && activeItem && activeUrls.length > 0 && (
            <div className="relative">
              <img src={activeUrls[Math.min(lightbox.index, activeUrls.length - 1)]} alt="" className="w-full max-h-[80vh] object-contain rounded-lg" />
              {activeUrls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLightbox((l) => l && ({ ...l, index: (l.index - 1 + activeUrls.length) % activeUrls.length }))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur rounded-full p-2"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightbox((l) => l && ({ ...l, index: (l.index + 1) % activeUrls.length }))}
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
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {fmtWhen(activeItem) && (
                        <span className="inline-flex items-center gap-1">
                          <CalIcon className="w-3 h-3" /> {fmtWhen(activeItem)}
                        </span>
                      )}
                      {activeCreator && (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar className="w-4 h-4">
                            {activeCreator.avatar_url && <AvatarImage src={activeCreator.avatar_url} alt="" />}
                            <AvatarFallback className="text-[8px]">{(activeCreator.display_name || activeCreator.email).slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {activeCreator.display_name || activeCreator.email.split("@")[0]}
                        </span>
                      )}
                    </div>
                  </div>
                  {activeUrls.length > 1 && (
                    <div className="text-xs text-muted-foreground">
                      {Math.min(lightbox.index, activeUrls.length - 1) + 1} / {activeUrls.length}
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