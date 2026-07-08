import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { BucketItemDialog, type BucketItem } from "@/components/bucket-item-dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Plus, Sparkles, Trash2, Pencil, Calendar as CalIcon } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/bucket")({
  component: BucketPage,
});

type Profile = { id: string; display_name: string | null; email: string; avatar_url: string | null };

function BucketPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<BucketItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filter, setFilter] = useState<"backlog" | "planned" | "done">("backlog");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BucketItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BucketItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: rows }, { data: profs }] = await Promise.all([
      supabase.from("bucket_items").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,display_name,email,avatar_url"),
    ]);
    setItems((rows ?? []) as BucketItem[]);
    const map: Record<string, Profile> = {};
    (profs ?? []).forEach((p) => { map[p.id] = p as Profile; });
    setProfiles(map);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("bucket_items_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filter === "done") return i.status === "done";
      if (filter === "planned") return i.status === "planned" && !!i.target_date;
      return i.status === "planned" && !i.target_date;
    });
  }, [items, filter]);

  const toggleDone = async (item: BucketItem) => {
    if (!user) return;
    const next = item.status === "done"
      ? { status: "planned" as const, completed_by: null, completed_at: null }
      : { status: "done" as const, completed_by: user.id, completed_at: new Date().toISOString() };
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, ...next } : i)));
    const { error } = await supabase.from("bucket_items").update(next).eq("id", item.id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    const { error } = await supabase.from("bucket_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
    toast.success("Removed");
    void load();
  };

  const stats = useMemo(() => ({
    total: items.length,
    done: items.filter((i) => i.status === "done").length,
    backlog: items.filter((i) => i.status === "planned" && !i.target_date).length,
    planned: items.filter((i) => i.status === "planned" && !!i.target_date).length,
  }), [items]);

  return (
    <>
      <section className="mb-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl sm:text-5xl mb-2">Bucket list</h1>
            <p className="text-muted-foreground">
              {stats.done} of {stats.total} completed
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="rounded-full gap-2">
            <Plus className="w-4 h-4" /> Add item
          </Button>
        </div>
        <div className="flex gap-2 mt-6">
          {(["backlog", "planned", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm capitalize transition ${
                filter === f ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70"
              }`}
            >
              {f} ({f === "done" ? stats.done : f === "planned" ? stats.planned : stats.backlog})
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-primary" />
          <h3 className="text-xl mb-1">No items yet</h3>
          <p className="text-muted-foreground text-sm">Add the first item to get started.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((item) => {
            const creator = profiles[item.created_by];
            return (
              <Card key={item.id} className="glass-card p-5 group">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => void toggleDone(item)}
                    className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition ${
                      item.status === "done"
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border hover:border-primary"
                    }`}
                    aria-label="Toggle done"
                  >
                    {item.status === "done" && <Check className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`text-lg leading-snug ${item.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {item.title}
                      </h3>
                      <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition flex gap-1">
                        <button onClick={() => { setEditing(item); setDialogOpen(true); }} className="p-1.5 hover:bg-muted rounded" aria-label="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setPendingDelete(item)} className="p-1.5 hover:bg-destructive/10 rounded text-destructive" aria-label="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {item.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{item.notes}</p>}
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      {item.category && <Badge variant="secondary" className="rounded-full">{item.category}</Badge>}
                      {item.target_date && (
                        <Badge variant="outline" className="rounded-full gap-1">
                          <CalIcon className="w-3 h-3" />
                          {format(parseISO(item.target_date), "MMM d, yyyy")}
                          {item.target_time && ` · ${item.target_time.slice(0, 5)}`}
                        </Badge>
                      )}
                      {creator && (
                        <Badge variant="outline" className="rounded-full gap-1.5 pl-1">
                          <Avatar className="w-4 h-4">
                            {creator.avatar_url && <AvatarImage src={creator.avatar_url} alt="" />}
                            <AvatarFallback className="text-[8px]">{(creator.display_name || creator.email).slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {creator.display_name || creator.email.split("@")[0]}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <BucketItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        onSaved={() => { setDialogOpen(false); void load(); }}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Remove this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  <span className="font-medium text-foreground">“{pendingDelete.title}”</span> will be permanently
                  removed from your bucket list and calendar. This can't be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRemove()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}