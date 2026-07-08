import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export type CalendarEvent = {
  id: string;
  bucket_item_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  created_by: string;
};

export function EventDialog({
  open, onOpenChange, event, seedDate, currentUserId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: CalendarEvent | null;
  seedDate: string | null;
  currentUserId: string | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      const d = new Date(event.start_at);
      setTitle(event.title);
      setDescription(event.description ?? "");
      setAllDay(event.all_day);
      setDate(d.toISOString().slice(0, 10));
      setTime(d.toTimeString().slice(0, 5));
    } else {
      setTitle("");
      setDescription("");
      setAllDay(true);
      setDate(seedDate ?? new Date().toISOString().slice(0, 10));
      setTime("09:00");
    }
  }, [open, event, seedDate]);

  const save = async () => {
    if (!currentUserId || !title.trim() || !date) return;
    setBusy(true);
    const start_at = new Date(`${date}T${allDay ? "09:00" : time}:00`).toISOString();
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      start_at,
      all_day: allDay,
    };
    const { error } = event
      ? await supabase.from("calendar_events").update(payload).eq("id", event.id)
      : await supabase.from("calendar_events").insert({ ...payload, created_by: currentUserId });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(event ? "Updated" : "Added to calendar");
    onSaved();
  };

  const remove = async () => {
    if (!event || !confirm("Remove this event?")) return;
    const { error } = await supabase.from("calendar_events").delete().eq("id", event.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{event ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={allDay} className="mt-1" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {event && (
              <Button variant="ghost" size="icon" onClick={() => void remove()} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !title.trim() || !date}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}