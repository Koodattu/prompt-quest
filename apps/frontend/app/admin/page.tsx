"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, Check, KeyRound, Lock, Moon, Plus, RefreshCw, Settings, Sun } from "lucide-react";
import { apiJson } from "../lib/api";
import { Theme } from "../lib/i18n";

type Stats = {
  totals: { sessions: number; recentSessions: number; responses: number; attempts: number };
  averages: Record<string, string | null>;
  levelStats: { levelId: string; nameFi: string; nameEn: string; attempts: number; successes: number; completions: number }[];
};

type PasswordGroup = { id: string; label: string; isAdmin: boolean; isActive: boolean; createdAt: string };
type Level = {
  id: string;
  nameFi: string;
  nameEn: string;
  difficulty: number;
  hiddenPassword: string;
  systemPrompt: string;
  model: string;
  hintFi?: string;
  hintEn?: string;
  isActive: boolean;
};
type ResponseRow = {
  id: string;
  groupId: string;
  groupLabel: string;
  presentationScore: number;
  imageAppScore: number;
  codeAppScore: number;
  aiFeelingScore: number;
  freeText?: string;
  createdAt: string;
};
type AttemptRow = {
  id: string;
  groupLabel: string;
  levelNameFi: string;
  userPrompt: string;
  aiResponse: string;
  wasSuccessful: boolean;
  createdAt: string;
};

const tokenKey = "promptquest.adminToken";
const themeKey = "promptquest.theme";

const questionLabels = [
  ["presentationScore", "Esitys"],
  ["imageAppScore", "Kuvat"],
  ["codeAppScore", "Koodi"],
  ["aiFeelingScore", "AI-fiilis"]
] as const;

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [passwords, setPasswords] = useState<PasswordGroup[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [aiProvider, setAiProvider] = useState("google");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [newGroup, setNewGroup] = useState({ label: "", password: "" });
  const [theme, setTheme] = useState<Theme>("dark");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem(themeKey);
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    const saved = localStorage.getItem(tokenKey);
    if (saved) {
      setToken(saved);
      void loadAll(saved).catch(() => {
        localStorage.removeItem(tokenKey);
        setToken("");
      });
    }
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  const participantGroups = useMemo(() => passwords.filter((group) => !group.isAdmin), [passwords]);
  const filteredResponses = useMemo(
    () => responses.filter((response) => selectedGroup === "all" || response.groupId === selectedGroup),
    [responses, selectedGroup]
  );
  const localAverages = useMemo(() => {
    return questionLabels.map(([key, label]) => {
      const total = filteredResponses.reduce((sum, row) => sum + row[key], 0);
      return {
        label,
        value: filteredResponses.length ? total / filteredResponses.length : null
      };
    });
  }, [filteredResponses]);
  const feedbackTexts = filteredResponses.filter((response) => response.freeText?.trim());
  const successfulAttempts = attempts.filter((attempt) => attempt.wasSuccessful);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiJson<{ token: string }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      localStorage.setItem(tokenKey, data.token);
      setToken(data.token);
      await loadAll(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kirjautuminen epäonnistui");
    } finally {
      setBusy(false);
    }
  }

  async function loadAll(activeToken = token) {
    const [statsData, passwordData, levelData, responseData, attemptData, settingsData] = await Promise.all([
      apiJson<Stats>("/api/admin/stats", {}, activeToken),
      apiJson<{ passwords: PasswordGroup[] }>("/api/admin/passwords", {}, activeToken),
      apiJson<{ levels: Level[] }>("/api/admin/levels", {}, activeToken),
      apiJson<{ responses: ResponseRow[] }>("/api/admin/responses", {}, activeToken),
      apiJson<{ attempts: AttemptRow[] }>("/api/admin/attempts", {}, activeToken),
      apiJson<{ settings: { ai_provider?: string } }>("/api/admin/settings", {}, activeToken)
    ]);
    setStats(statsData);
    setPasswords(passwordData.passwords);
    setLevels(levelData.levels);
    setResponses(responseData.responses);
    setAttempts(attemptData.attempts);
    setAiProvider(settingsData.settings.ai_provider ?? "google");
  }

  async function refresh() {
    setError("");
    try {
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tietojen lataus epäonnistui");
    }
  }

  async function saveProvider(nextProvider: string) {
    setAiProvider(nextProvider);
    await apiJson("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ aiProvider: nextProvider }) }, token);
  }

  async function createPassword(event: FormEvent) {
    event.preventDefault();
    if (!newGroup.label.trim() || !newGroup.password.trim()) return;
    await apiJson(
      "/api/admin/passwords",
      { method: "POST", body: JSON.stringify({ ...newGroup, isAdmin: false }) },
      token
    );
    setNewGroup({ label: "", password: "" });
    await loadAll();
  }

  async function togglePassword(group: PasswordGroup) {
    await apiJson(
      `/api/admin/passwords/${group.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !group.isActive }) },
      token
    );
    await loadAll();
  }

  async function updateLevel(level: Level, patch: Partial<Level>) {
    await apiJson(`/api/admin/levels/${level.id}`, { method: "PATCH", body: JSON.stringify(patch) }, token);
    await loadAll();
  }

  function switchTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  if (!token) {
    return (
      <main className="shell admin-shell">
        <header className="topbar">
          <div className="brand">PromptQuest</div>
          <button className="icon-only" onClick={switchTheme} type="button" title="Vaihda teemaa">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <section className="panel intro compact-intro">
          <div>
            <h1>Hallinta</h1>
            <p>Kirjaudu admin-salasanalla.</p>
          </div>
          {error ? <div className="alert error">{error}</div> : null}
          <form className="login-form" onSubmit={login}>
            <label>
              <span>Admin-salasana</span>
              <input autoFocus value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            <button disabled={busy} type="submit">
              <Lock size={18} />
              Kirjaudu
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell admin-shell">
      <header className="topbar">
        <div className="brand">PromptQuest Admin</div>
        <nav className="top-actions">
          <a className="icon-text" href="/">
            Osallistuja
          </a>
          <button className="icon-text" onClick={refresh} type="button">
            <RefreshCw size={18} />
            Päivitä
          </button>
          <button className="icon-only" onClick={switchTheme} type="button" title="Vaihda teemaa">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="ghost"
            onClick={() => {
              localStorage.removeItem(tokenKey);
              setToken("");
            }}
            type="button"
          >
            Ulos
          </button>
        </nav>
      </header>

      {error ? <div className="alert error">{error}</div> : null}

      <section className="stats-grid">
        {[
          ["Sessioita", stats?.totals.sessions ?? 0],
          ["Aktiivisia", stats?.totals.recentSessions ?? 0],
          ["Palautteita", stats?.totals.responses ?? 0],
          ["AI-yrityksiä", stats?.totals.attempts ?? 0]
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="admin-dashboard">
        <div className="panel analysis-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Palaute</p>
              <h2>Keskiarvot</h2>
            </div>
            <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
              <option value="all">Kaikki ryhmät</option>
              {participantGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </div>
          <div className="score-grid">
            {localAverages.map((item) => (
              <div className="score-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value ? item.value.toFixed(2) : "-"}</strong>
                <div className="bar">
                  <span style={{ width: `${item.value ? (item.value / 5) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="feedback-strip">
            <strong>{filteredResponses.length}</strong>
            <span>vastausta valinnassa</span>
            <strong>{feedbackTexts.length}</strong>
            <span>avointa palautetta</span>
          </div>
        </div>

        <div className="panel analysis-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Haaste</p>
              <h2>Tasot</h2>
            </div>
            <BarChart3 size={22} />
          </div>
          <div className="level-stat-list">
            {stats?.levelStats.map((level) => {
              const leakRate = level.attempts ? Math.round((level.successes / level.attempts) * 100) : 0;
              const completionRate = stats.totals.sessions ? Math.round((level.completions / stats.totals.sessions) * 100) : 0;
              return (
                <div className="level-stat" key={level.levelId}>
                  <div>
                    <strong>{level.nameFi}</strong>
                    <span>
                      {level.attempts} yritystä · {level.successes} vuotoa · {level.completions} läpäisyä
                    </span>
                  </div>
                  <div className="dual-bars">
                    <label>
                      Vuoto {leakRate}%
                      <span className="bar">
                        <span style={{ width: `${leakRate}%` }} />
                      </span>
                    </label>
                    <label>
                      Läpäisy {completionRate}%
                      <span className="bar alt">
                        <span style={{ width: `${completionRate}%` }} />
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="admin-dashboard lower">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Asetukset</p>
              <h2>Malli</h2>
            </div>
            <Settings size={22} />
          </div>
          <div className="segmented">
            {["google", "openai", "mock"].map((provider) => (
              <button
                className={aiProvider === provider ? "selected" : ""}
                key={provider}
                onClick={() => saveProvider(provider)}
                type="button"
              >
                {provider}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ryhmät</p>
              <h2>Salasanat</h2>
            </div>
            <KeyRound size={22} />
          </div>
          <form className="compact-form" onSubmit={createPassword}>
            <input
              placeholder="Ryhmän nimi"
              value={newGroup.label}
              onChange={(event) => setNewGroup({ ...newGroup, label: event.target.value })}
            />
            <input
              placeholder="Salasana"
              value={newGroup.password}
              onChange={(event) => setNewGroup({ ...newGroup, password: event.target.value })}
            />
            <button type="submit">
              <Plus size={18} />
              Lisää
            </button>
          </form>
          <div className="table-list compact-list">
            {passwords.map((group) => (
              <div className="table-row inline-row" key={group.id}>
                <div>
                  <strong>{group.label}</strong>
                  <span>{group.isAdmin ? "admin" : "osallistuja"}</span>
                </div>
                <button onClick={() => togglePassword(group)} type="button">
                  {group.isActive ? "Sulje" : "Avaa"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Tasot</p>
            <h2>Haasteen hallinta</h2>
          </div>
        </div>
        <div className="level-admin-list">
          {levels.map((level) => (
            <div className="level-editor" key={level.id}>
              <input defaultValue={level.nameFi} onBlur={(event) => updateLevel(level, { nameFi: event.target.value })} />
              <input defaultValue={level.nameEn} onBlur={(event) => updateLevel(level, { nameEn: event.target.value })} />
              <input defaultValue={level.model} onBlur={(event) => updateLevel(level, { model: event.target.value })} />
              <input
                defaultValue={level.hiddenPassword}
                onBlur={(event) => updateLevel(level, { hiddenPassword: event.target.value })}
              />
              <button onClick={() => updateLevel(level, { isActive: !level.isActive })} type="button">
                {level.isActive ? <Check size={16} /> : <Lock size={16} />}
                {level.isActive ? "Aktiivinen" : "Pois"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-dashboard">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Avoin palaute</p>
              <h2>Viimeisimmät</h2>
            </div>
          </div>
          <div className="table-list tall">
            {feedbackTexts.map((response) => (
              <div className="table-row" key={response.id}>
                <strong>{response.groupLabel}</strong>
                <p>{response.freeText}</p>
              </div>
            ))}
            {feedbackTexts.length === 0 ? <p className="empty-list">Ei avointa palautetta.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Onnistuneet promptit</p>
              <h2>Vuodot</h2>
            </div>
          </div>
          <div className="table-list tall">
            {successfulAttempts.map((attempt) => (
              <div className="table-row" key={attempt.id}>
                <strong>
                  {attempt.levelNameFi} · {attempt.groupLabel}
                </strong>
                <span>{attempt.userPrompt}</span>
                <p>{attempt.aiResponse}</p>
              </div>
            ))}
            {successfulAttempts.length === 0 ? <p className="empty-list">Ei onnistuneita vuotoja.</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
