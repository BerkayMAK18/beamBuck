import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { BucketItem } from "@/components/bucket-item-dialog";
import { CalendarHeart } from "lucide-react";
import { format, parseISO, isSameDay, isToday, isTomorrow, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

type Profile = { id: string; display_name: string | null; email: string; avatar_url: string | null };

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function whenLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  const diff = differenceInCalendarDays(date, startOfToday());
  if (diff > 0 && diff < 7) return format(date, "EEEE");
  return format(date, "EEE, MMM d");
}

function CalendarPage() {
  const [items, setItems] = useState<BucketItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data, error }, { data: profs }] = await Promise.all([
      supabase
        .from("bucket_items")
        .select("*")
        .eq("status", "planned")
        .not("target_date", "is", null)
        .order("target_date", { ascending: true })
        .order("target_time", { ascending: true, nullsFirst: true }),
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
      .channel("calendar_bucket_items")
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const grouped = useMemo(() => {
    const today = startOfToday();
    const upcoming = items.filter((i) => {
      if (!i.target_date) return false;
      const d = parseISO(i.target_date);
      return d >= today;
    });
    const groups: { date: Date; items: BucketItem[] }[] = [];
    upcoming.forEach((it) => {
      const d = parseISO(it.target_date!);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, d)) last.items.push(it);
      else groups.push({ date: d, items: [it] });
    });
    return groups;
  }, [items]);

  return (
    <>
      <section className="mb-6">
        <h1 className="text-4xl sm:text-5xl mb-1">Upcoming</h1>
        <p className="text-muted-foreground">Your closest planned bucket list items, mirrored from the list.</p>
      </section>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : grouped.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <CalendarHeart className="w-8 h-8 mx-auto mb-3 text-primary" />
          <h3 className="text-xl mb-1">Nothing planned yet</h3>
          <p className="text-muted-foreground text-sm">Add a date to a bucket list item and it will show up here.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ date, items: dayItems }) => (
            <Card key={date.toISOString()} className="glass-card p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-serif text-lg">{whenLabel(date)}</div>
                <div className="text-xs text-muted-foreground">{format(date, "MMM d, yyyy")}</div>
              </div>
              <ul className="divide-y divide-border/50">
                {dayItems.map((it) => {
                  const creator = profiles[it.created_by];
                  return (
                    <li key={it.id} className="py-3 flex items-start gap-3">
                      <div className="shrink-0 w-14 text-center">
                        <div className="text-sm font-medium">
                          {it.target_time ? it.target_time.slice(0, 5) : "All day"}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{it.title}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {it.category && <Badge variant="secondary" className="rounded-full text-[10px]">{it.category}</Badge>}
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
                        {it.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.notes}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}