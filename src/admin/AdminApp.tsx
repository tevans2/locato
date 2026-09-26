import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Gauge, KeyRound, LayoutDashboard, ListTree, LogOut, Moon, Radio, ShieldCheck, Sun, Users } from "lucide-react";
import { checkToken, createClient, loadToken, saveToken } from "./api";
import { ConfirmDialog, Toasts, type ConfirmRequest, type Toast } from "./ui";
import { OverviewView } from "./views/Overview";
import { UsersView, type ActionHelpers } from "./views/Users";
import { ModerationView } from "./views/Moderation";
import { LiveView } from "./views/Live";
import { EventsView } from "./views/Events";
import { SystemView } from "./views/System";
import { currentTheme, toggleTheme } from "../ui/theme";

type ViewId = "overview" | "users" | "moderation" | "live" | "events" | "system";

const NAV: readonly { id: ViewId; label: string; icon: typeof Users; description: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, description: "Activity and health at a glance" },
  { id: "users", label: "Users", icon: Users, description: "Accounts, stats and account actions" },
  { id: "moderation", label: "Leaderboards", icon: ShieldCheck, description: "Review and remove daily results and best times" },
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

function SignIn({ onSignedIn, notice }: { onSignedIn: (token: string) => void; notice: string | null }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!token.trim()) return;
    setBusy(true);
    const result = await checkToken(token.trim());
    setBusy(false);
    if (result.ok) onSignedIn(token.trim());
    else setError(result.error);
  }

  return (
    <main className="adm-signin">
      <form className="adm-signin-card" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="adm-brand"><span>locato</span><i>.</i> <em>admin</em></div>
        <h1>Sign in to the console</h1>
        <p className="adm-muted">Use the server's <code>ADMIN_TOKEN</code>. It's kept only for this browser tab.</p>
        <label className="adm-field">
          <span>Admin token</span>
          <div className="adm-input-icon">
            <KeyRound size={15} aria-hidden />
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus autoComplete="current-password" spellCheck={false} />
          </div>
        </label>
        {error && <p className="adm-signin-error" role="alert">{error}</p>}
        <button type="submit" className="adm-btn is-primary is-block" disabled={busy || !token.trim()}>{busy ? "Checking…" : "Sign in"}</button>
      </form>
    </main>
  );
}

export function AdminApp() {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [notice, setNotice] = useState<string | null>(null);
  const [route, navigate] = useRoute();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState(currentTheme());
  const toastId = useRef(0);

  const signOut = useCallback((message: string | null = null) => {
    saveToken(null);
    setToken(null);
    setNotice(message);
  }, []);

  const client = useMemo(() => (token ? createClient(token, () => signOut("Your admin token was rejected — it may have been rotated. Sign in again.")) : null), [token, signOut]);

  const helpers: ActionHelpers = useMemo(() => ({
    confirm: setConfirmRequest,
    notify: (message, tone = "good") => {
      const id = ++toastId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000);
    },
  }), []);

  const openUser = useCallback((id: string) => navigate("users", id), [navigate]);

  if (!client) {
    return <SignIn notice={notice} onSignedIn={(next) => { saveToken(next); setNotice(null); setToken(next); }} />;
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
          <button type="button" className="adm-nav-link" onClick={() => signOut()}><LogOut size={17} aria-hidden /> <span>Sign out</span></button>
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-page-head">
          <h1>{active.label}</h1>
          <p>{active.description}</p>
        </header>
        {route.view === "overview" && <OverviewView client={client} onOpenUser={openUser} />}
        {route.view === "users" && <UsersView client={client} selectedId={route.param} onSelect={(id) => navigate("users", id)} helpers={helpers} />}
        {route.view === "moderation" && <ModerationView client={client} onOpenUser={openUser} helpers={helpers} />}
        {route.view === "live" && <LiveView client={client} onOpenUser={openUser} helpers={helpers} />}
        {route.view === "events" && <EventsView client={client} onOpenUser={openUser} />}
        {route.view === "system" && <SystemView client={client} />}
      </main>

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      <Toasts toasts={toasts} />
    </div>
  );
}
