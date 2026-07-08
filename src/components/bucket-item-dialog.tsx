import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export type BucketItem = {
  id: string;
  title: string;
  notes: string | null;
  category: string | null;
  target_date: string | null;
  target_time: string | null;
  status: "planned" | "done";
  completed_by: string | null;
  completed_at: string | null;
  image_urls: string[];
  links: string[];
  created_by: string;
  created_at: string;
};

const CATEGORIES = ["Travel", "Food", "Adventure", "Learn", "Together", "Create"];

export function BucketItemDialog({
  open, onOpenChange, item, defaultTargetDate, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: BucketItem | null;
  defaultTargetDate?: string | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<string>("");
  const [targetDate, setTargetDate] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(item?.title ?? "");
      setNotes(item?.notes ?? "");
      setCategory(item?.category ?? "");
      setTargetDate(item?.target_date ?? defaultTargetDate ?? "");
      setTargetTime(item?.target_time ? item.target_time.slice(0, 5) : "");
    }
  }, [open, item, defaultTargetDate]);

  const save = async () => {
    if (!user || !title.trim()) return;
    setBusy(true);
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      category: category || null,
      target_date: targetDate || null,
      target_time: targetDate && targetTime ? targetTime : null,
    };
    const { error } = item
      ? await supabase.from("bucket_items").update(payload).eq("id", item.id)
      : await supabase.from("bucket_items").insert({ ...payload, created_by: user.id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(item ? "Updated" : "Added to your list");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{item ? "Edit item" : "New item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="See the northern lights" className="mt-1" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Details, why it matters, ideas…" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>Target date</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Time {targetDate ? "" : <span className="text-xs text-muted-foreground">(add a date first)</span>}</Label>
            <Input type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} disabled={!targetDate} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Leave empty for an all-day item.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !title.trim()}>{item ? "Save" : "Add item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}