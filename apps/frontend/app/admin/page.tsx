"use client";

import { FormEvent, useEffect, useState } from "react";
import { BarChart3, Check, KeyRound, Lock, Plus, RefreshCw, Settings, Shield } from "lucide-react";
import { apiJson } from "../lib/api";

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

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [passwords, setPasswords] = useState<PasswordGroup[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [aiProvider, setAiProvider] = useState("google");
  const [newGroup, setNewGroup] = useState({ label: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(tokenKey);
    if (saved) {
      setToken(saved);
      void loadAll(saved);
    }
  }, []);

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
      setError(err instanceof Error ? err.message : "Login failed");
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

  async function saveProvider(nextProvider: string) {
    setAiProvider(nextProvider);
    await apiJson("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ aiProvider: nextProvider }) }, token);
  }

  async function createPassword(event: FormEvent) {
    event.preventDefault();
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

  if (!token) {
    return (
      <main className="shell admin-shell">
        <section className="panel intro">
          <div>
            <p className="eyebrow">Admin</p>
            <h1>PromptQuest hallinta</h1>
            <p>Kirjaudu admin-salasanalla. Oletus kehitysympäristössä on admin-demo.</p>
          </div>
          {error ? <div className="alert error">{error}</div> : null}
          <form className="login-form" onSubmit={login}>
            <label>
              <span>Admin-salasana</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
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
        <div className="brand">
          <Shield size={22} />
          <span>PromptQuest Admin</span>
        </div>
        <nav className="top-actions">
          <a className="icon-text" href="/">
            Osallistujanäkymä
          </a>
          <button className="icon-text" onClick={() => loadAll()} type="button">
            <RefreshCw size={18} />
            Päivitä
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
          ["Aktiivisia 15 min", stats?.totals.recentSessions ?? 0],
          ["Palautteita", stats?.totals.responses ?? 0],
          ["AI-yrityksiä", stats?.totals.attempts ?? 0]
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Asetukset</p>
            <h2>AI-palveluntarjoaja</h2>
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
      </section>

      <section className="admin-grid">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Tulokset</p>
              <h2>Keskiarvot</h2>
            </div>
            <BarChart3 size={22} />
          </div>
          <div className="averages">
            {Object.entries(stats?.averages ?? {}).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value ? Number(value).toFixed(2) : "-"}</strong>
              </div>
            ))}
          </div>
          <div className="table-list">
            {stats?.levelStats.map((level) => (
              <div className="table-row" key={level.levelId}>
                <strong>{level.nameFi}</strong>
                <span>
                  Yritykset {level.attempts} · vuodot {level.successes} · suoritukset {level.completions}
                </span>
              </div>
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
          <div className="table-list">
            {passwords.map((group) => (
              <div className="table-row" key={group.id}>
                <strong>{group.label}</strong>
                <span>{group.isAdmin ? "admin" : "participant"}</span>
                <button onClick={() => togglePassword(group)} type="button">
                  {group.isActive ? "Poista käytöstä" : "Aktivoi"}
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
            <h2>AI-haasteen hallinta</h2>
          </div>
        </div>
        <div className="level-admin-list">
          {levels.map((level) => (
            <div className="level-editor" key={level.id}>
              <input value={level.nameFi} onChange={(event) => updateLevel(level, { nameFi: event.target.value })} />
              <input value={level.nameEn} onChange={(event) => updateLevel(level, { nameEn: event.target.value })} />
              <input value={level.model} onChange={(event) => updateLevel(level, { model: event.target.value })} />
              <input
                value={level.hiddenPassword}
                onChange={(event) => updateLevel(level, { hiddenPassword: event.target.value })}
              />
              <button onClick={() => updateLevel(level, { isActive: !level.isActive })} type="button">
                {level.isActive ? <Check size={16} /> : <Lock size={16} />}
                {level.isActive ? "Aktiivinen" : "Pois"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-grid">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Palautteet</p>
              <h2>Viimeisimmät vastaukset</h2>
            </div>
          </div>
          <div className="table-list tall">
            {responses.map((response) => (
              <div className="table-row" key={response.id}>
                <strong>{response.groupLabel}</strong>
                <span>
                  {response.presentationScore}/{response.imageAppScore}/{response.codeAppScore}/
                  {response.aiFeelingScore}
                </span>
                {response.freeText ? <p>{response.freeText}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AI</p>
              <h2>Viimeisimmät yritykset</h2>
            </div>
          </div>
          <div className="table-list tall">
            {attempts.map((attempt) => (
              <div className="table-row" key={attempt.id}>
                <strong>
                  {attempt.levelNameFi} · {attempt.wasSuccessful ? "onnistui" : "epäonnistui"}
                </strong>
                <span>{attempt.userPrompt}</span>
                <p>{attempt.aiResponse}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
