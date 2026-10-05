import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Ban, Gauge, LayoutDashboard, ListTree, LogOut, Mail, Moon, Radio, ShieldCheck, Sun, Users } from "lucide-react";
import { checkSession, createClient, signIn, signOut as endSession, type AdminSessionState } from "./api";
import { ConfirmDialog, Toasts, type ConfirmRequest, type Toast } from "./ui";
import { OverviewView } from "./views/Overview";
import { UsersView, type ActionHelpers } from "./views/Users";
import { ModerationView } from "./views/Moderation";
import { BansView } from "./views/Bans";
import { LiveView } from "./views/Live";
import { EventsView } from "./views/Events";
import { SystemView } from "./views/System";
import { currentTheme, toggleTheme } from "../ui/theme";

type ViewId = "overview" | "users" | "moderation" | "bans" | "live" | "events" | "system";

const NAV: readonly { id: ViewId; label: string; icon: typeof Users; description: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, description: "Activity and health at a glance" },
  { id: "users", label: "Users", icon: Users, description: "Accounts, stats and account actions" },
  { id: "moderation", label: "Leaderboards", icon: ShieldCheck, description: "Review and remove daily results and best times" },
  { id: "bans", label: "Bans", icon: Ban, description: "Banned accounts and IP addresses" },
  { id: "live", label: "Live", icon: Radio, description: "Open multiplayer rooms and who's online" },
  { id: "events", label: "Event log", icon: ListTree, description: "Sign-ins, submissions, admin actions and warnings" },
  { id: "system", label: "System", icon: Gauge, description: "Server, database and configuration" },
];

interface Route {
  readonly view: ViewId;
  readonly param: string | null;
}

// Hash routes (#/users/<id>) so a reload keeps your place and links can be shared with teammates.
function parseHash(hash: string): Route {
  const [view, param] = hash.replace(/^#\/?/, "").split("/");
  const known = NAV.some((item) => item.id === view);
  return { view: known ? (view as ViewId) : "overview", param: known && param ? decodeURIComponent(param) : null };
}

function useRoute(): [Route, (view: ViewId, param?: string | null) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((view: ViewId, param: string | null = null) => {
    window.location.hash = `/${view}${param ? `/${encodeURIComponent(param)}` : ""}`;
  }, []);
  return [route, navigate];
}

function SignIn({ state, notice, onSignedIn, onSignOut }: { state: AdminSessionState | null; notice: string | null; onSignedIn: () => void; onSignOut: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    if (result.ok) onSignedIn();
    else setError(result.error);
  }

  if (state === null) {
    return <main className="adm-signin"><div className="adm-signin-card"><p className="adm-muted">Checking your session…</p></div></main>;
  }

  if (state.kind === "not-admin") {
    return (
      <main className="adm-signin">
        <div className="adm-signin-card">
          <div className="adm-brand"><span>locato</span><i>.</i> <em>admin</em></div>
          <h1>No admin access</h1>
          <p className="adm-muted">You're signed in, but this account isn't an admin. Ask an admin to grant access from Users, or sign in with another account.</p>
          {error && <p className="adm-signin-error" role="alert">{error}</p>}
          <button type="button" className="adm-btn is-primary is-block" onClick={onSignOut}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <main className="adm-signin">
      <form className="adm-signin-card" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="adm-brand"><span>locato</span><i>.</i> <em>admin</em></div>
        <h1>Sign in to the console</h1>
        <p className="adm-muted">Use your Locato account. It needs admin access.</p>
        <label className="adm-field">
          <span>Email</span>
          <div className="adm-input-icon">
            <Mail size={15} aria-hidden />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" spellCheck={false} />
          </div>
        </label>
        <label className="adm-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {(error ?? (state.kind === "error" ? state.error : null)) && <p className="adm-signin-error" role="alert">{error ?? (state.kind === "error" ? state.error : null)}</p>}
        <button type="submit" className="adm-btn is-primary is-block" disabled={busy || !email.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="adm-muted">Use GitHub or Google? <a href="/">Sign in on Locato</a>, then come back to <code>/admin</code>.</p>
      </form>
    </main>
  );
}

export function AdminApp() {
  const [session, setSession] = useState<AdminSessionState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, navigate] = useRoute();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState(currentTheme());
  const toastId = useRef(0);

  const refreshSession = useCallback(() => {
    void checkSession().then(setSession);
  }, []);
  useEffect(refreshSession, [refreshSession]);

  const signOut = useCallback(async () => {
    await endSession();
    setNotice(null);
    setSession({ kind: "signed-out" });
  }, []);

  const signedInAs = session?.kind === "admin" ? session.user : null;
  const client = useMemo(() => (signedInAs ? createClient((status) => {
    setNotice(status === 401 ? "Your session ended. Sign in again." : null);
    setSession({ kind: status === 401 ? "signed-out" : "not-admin" });
  }) : null), [signedInAs?.id]);

  const helpers: ActionHelpers = useMemo(() => ({
    confirm: setConfirmRequest,
    notify: (message, tone = "good") => {
      const id = ++toastId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000);
    },
  }), []);

  const openUser = useCallback((id: string) => navigate("users", id), [navigate]);

  if (!client || !signedInAs) {
    return <SignIn state={session} notice={notice} onSignedIn={() => { setNotice(null); refreshSession(); }} onSignOut={() => void signOut()} />;
  }

  const active = NAV.find((item) => item.id === route.view) ?? NAV[0]!;

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-brand"><span>locato</span><i>.</i> <em>admin</em></div>
        <nav aria-label="Admin sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <a key={item.id} href={`#/${item.id}`} className="adm-nav-link" aria-current={item.id === route.view ? "page" : undefined}>
                <Icon size={17} aria-hidden /> <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="adm-sidebar-foot">
          <button type="button" className="adm-nav-link" onClick={() => setThemeState(toggleTheme(window.localStorage))}>
            {theme === "dark" ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />} <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
          <a className="adm-nav-link" href="/" target="_blank" rel="noreferrer"><Activity size={17} aria-hidden /> <span>Open Locato</span></a>
          <button type="button" className="adm-nav-link" onClick={() => void signOut()} title={signedInAs.email}><LogOut size={17} aria-hidden /> <span>Sign out {signedInAs.displayName}</span></button>
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-page-head">
          <h1>{active.label}</h1>
          <p>{active.description}</p>
        </header>
        {route.view === "overview" && <OverviewView client={client} onOpenUser={openUser} />}
        {route.view === "users" && <UsersView client={client} currentAdminId={signedInAs.id} selectedId={route.param} onSelect={(id) => navigate("users", id)} helpers={helpers} />}
        {route.view === "moderation" && <ModerationView client={client} onOpenUser={openUser} helpers={helpers} />}
        {route.view === "bans" && <BansView client={client} onOpenUser={openUser} helpers={helpers} />}
        {route.view === "live" && <LiveView client={client} onOpenUser={openUser} helpers={helpers} />}
        {route.view === "events" && <EventsView client={client} onOpenUser={openUser} />}
        {route.view === "system" && <SystemView client={client} />}
      </main>

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      <Toasts toasts={toasts} />
    </div>
  );
}
