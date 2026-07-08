import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { X, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { profile, user, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [invite, setInvite] = useState("");
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [members, setMembers] = useState<{ email: string; display_name: string | null }[]>([]);

  useEffect(() => { setDisplayName(profile?.display_name ?? ""); }, [profile]);

  const uploadAvatar = async (file: File) => {
    if (!user) return;
    setUploadingAvatar(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { setUploadingAvatar(false); toast.error(upErr.message); return; }
    const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 365);
    const url = signed?.signedUrl ?? null;
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    setUploadingAvatar(false);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    toast.success("Profile picture updated");
  };

  const removeAvatar = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    toast.success("Profile picture removed");
  };

  const loadAllowlist = async () => {
    // Try to read allowlist. Without a SELECT policy this returns empty — that's fine, we just show what we can.
    const { data: emails } = await supabase.from("allowed_emails").select("email").order("added_at");
    setAllowlist((emails ?? []).map((r) => r.email));
    const { data: profs } = await supabase.from("profiles").select("email,display_name");
    setMembers(profs ?? []);
  };

  useEffect(() => { void loadAllowlist(); }, []);

  const saveName = async () => {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", profile.id);
    if (error) { toast.error(error.message); return; }
    await refreshProfile();
    toast.success("Saved");
  };

  const addInvite = async () => {
    const email = invite.trim().toLowerCase();
    if (!email) return;
    const { error } = await supabase.from("allowed_emails").insert({ email });
    if (error) { toast.error(error.message); return; }
    setInvite("");
    toast.success(`${email} can now sign up`);
    void loadAllowlist();
  };

  const removeInvite = async (email: string) => {
    const { error } = await supabase.from("allowed_emails").delete().eq("email", email);
    if (error) { toast.error(error.message); return; }
    void loadAllowlist();
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-4xl mb-1">Settings</h1>
        <p className="text-muted-foreground">Your name and who can join your space.</p>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="font-serif">Your profile</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <Avatar className="w-20 h-20 border-2 border-primary/40">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
              <AvatarFallback className="bg-secondary text-secondary-foreground text-lg">
                {(profile?.display_name || profile?.email || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2">
              <label className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 cursor-pointer w-fit">
                <Upload className="w-4 h-4" />
                {uploadingAvatar ? "Uploading…" : profile?.avatar_url ? "Change photo" : "Upload photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
              </label>
              {profile?.avatar_url && (
                <button onClick={() => void removeAvatar()} className="text-xs text-muted-foreground hover:text-destructive w-fit">Remove</button>
              )}
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input value={profile?.email ?? ""} disabled className="mt-1" />
          </div>
          <div>
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" />
          </div>
          <Button onClick={() => void saveName()} className="rounded-full">Save</Button>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="font-serif">Invites</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Only emails on this list can create an account. Add an email here, then share the app link.
          </p>
          <div className="flex gap-2">
            <Input type="email" placeholder="name@example.com" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <Button onClick={() => void addInvite()} className="rounded-full">Add</Button>
          </div>
          {allowlist.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Allowed emails</div>
              <ul className="space-y-1">
                {allowlist.map((e) => (
                  <li key={e} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2 text-sm">
                    {e}
                    <button onClick={() => void removeInvite(e)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {members.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Signed in</div>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.email} className="flex items-center justify-between bg-secondary/40 rounded-lg px-3 py-2 text-sm">
                    <span>{m.display_name || m.email.split("@")[0]}</span>
                    <span className="text-xs text-muted-foreground">{m.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}