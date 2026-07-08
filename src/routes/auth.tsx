import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/calendar", replace: true });
  }, [session, loading, navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        // Pre-check allowlist so we can show a nice error.
        const { data: allowed, error: rpcErr } = await supabase.rpc("is_email_allowed", { _email: email });
        if (rpcErr) throw rpcErr;
        if (!allowed) {
          toast.error("This email isn't on the invite list yet. Ask the other person to add it from Settings.");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        // Supabase returns a normal-looking success response (no error) for an
        // email that's already registered too, to avoid leaking which emails
        // exist. An empty identities array is the tell that nothing actually
        // happened — no account was created and no password was changed.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          toast.error("An account with this email already exists. Try signing in, or use \"Forgot password?\" below.");
          return;
        }
        toast.success("Welcome in!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.error("Enter your email above first.");
      return;
    }
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("If that email has an account, a reset link is on its way.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-serif text-5xl text-foreground mb-2">Bucket List App</h1>
          <p className="text-muted-foreground">Prototype — a shared bucket list &amp; calendar.</p>
        </div>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex gap-2 mb-6 p-1 bg-muted rounded-full">
              <button
                onClick={() => setMode("signin")}
                className={`flex-1 py-2 text-sm rounded-full transition ${mode === "signin" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Sign in
              </button>
              <button
                onClick={() => setMode("signup")}
                className={`flex-1 py-2 text-sm rounded-full transition ${mode === "signup" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
              >
                Sign up
              </button>
            </div>
            <form onSubmit={handle} className="space-y-4">
              {mode === "signup" && (
                <div>
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" className="mt-1" />
                </div>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1"
                />
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    At least 10 characters, with uppercase, lowercase, and a number. Save it to your phone's password
                    manager — Face ID / fingerprint will fill it in from then on.
                  </p>
                )}
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => void handleForgotPassword()}
                    disabled={resetBusy}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1"
                  >
                    {resetBusy ? "Sending…" : "Forgot password?"}
                  </button>
                )}
              </div>
              <Button type="submit" disabled={busy} className="w-full rounded-full">
                {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground mt-4 text-center">
                Invite-only. The first sign-up creates the space; add more emails from Settings after.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}