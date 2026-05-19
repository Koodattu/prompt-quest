"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, KeyRound, Lock, LogOut, Send, Shield, Sparkles } from "lucide-react";
import { API_BASE, apiJson } from "./lib/api";
import { copy, Lang } from "./lib/i18n";

type Session = {
  sessionId: string;
  group?: { id: string; label: string };
  groupLabel?: string;
  questionnaireCompleted: boolean;
};

type Level = {
  id: string;
  nameFi: string;
  nameEn: string;
  difficulty: number;
  model: string;
  hintFi?: string;
  hintEn?: string;
  completed: boolean;
  unlocked: boolean;
};

type Message = { role: "user" | "ai"; text: string };

const storageKeys = {
  sessionId: "promptquest.sessionId",
  lang: "promptquest.lang"
};

export default function Home() {
  const [lang, setLang] = useState<Lang>("fi");
  const t = copy[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [quiz, setQuiz] = useState([3, 3, 3, 3]);
  const [freeText, setFreeText] = useState("");
  const [levels, setLevels] = useState<Level[]>([]);
  const [activeLevelId, setActiveLevelId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [levelPassword, setLevelPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeLevel = useMemo(() => levels.find((level) => level.id === activeLevelId), [levels, activeLevelId]);

  useEffect(() => {
    const savedLang = localStorage.getItem(storageKeys.lang);
    if (savedLang === "fi" || savedLang === "en") setLang(savedLang);
    const sessionId = localStorage.getItem(storageKeys.sessionId);
    if (sessionId) {
      apiJson<Session>(`/api/session?sessionId=${encodeURIComponent(sessionId)}`)
        .then((data) => {
          setSession(data);
          if (data.questionnaireCompleted) void loadLevels(data.sessionId);
        })
        .catch(() => localStorage.removeItem(storageKeys.sessionId));
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function switchLang() {
    const next = lang === "fi" ? "en" : "fi";
    setLang(next);
    localStorage.setItem(storageKeys.lang, next);
  }

  async function loadLevels(sessionId = session?.sessionId) {
    if (!sessionId) return;
    const data = await apiJson<{ levels: Level[] }>(`/api/levels?sessionId=${encodeURIComponent(sessionId)}`);
    setLevels(data.levels);
    const current = data.levels.find((level) => !level.completed && level.unlocked) ?? data.levels[0];
    setActiveLevelId((previous) => previous || current?.id || "");
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const existing = localStorage.getItem(storageKeys.sessionId) ?? undefined;
      const data = await apiJson<Session>("/api/login", {
        method: "POST",
        body: JSON.stringify({ password, sessionId: existing })
      });
      localStorage.setItem(storageKeys.sessionId, data.sessionId);
      setSession(data);
      if (data.questionnaireCompleted) await loadLevels(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }

  async function submitQuiz(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await apiJson("/api/questionnaire", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.sessionId,
          presentationScore: quiz[0],
          imageAppScore: quiz[1],
          codeAppScore: quiz[2],
          aiFeelingScore: quiz[3],
          freeText
        })
      });
      setSession({ ...session, questionnaireCompleted: true });
      await loadLevels(session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt(event: FormEvent) {
    event.preventDefault();
    if (!session || !activeLevel || !prompt.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    const userText = prompt.trim();
    setPrompt("");
    setMessages((items) => [...items, { role: "user", text: userText }, { role: "ai", text: "" }]);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, levelId: activeLevel.id, message: userText })
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? t.error);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventBlock of events) {
          const eventName = eventBlock.match(/^event: (.+)$/m)?.[1];
          const dataLine = eventBlock.match(/^data: (.+)$/m)?.[1];
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (eventName === "token") {
            setMessages((items) => {
              const next = [...items];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, text: last.text + data.token };
              return next;
            });
          }
          if (eventName === "done" && data.wasSuccessful) setNotice(t.successLeak);
          if (eventName === "error") throw new Error(data.error);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }

  async function unlockLevel(event: FormEvent) {
    event.preventDefault();
    if (!session || !activeLevel) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/levels/${activeLevel.id}/unlock`, {
        method: "POST",
        body: JSON.stringify({ sessionId: session.sessionId, password: levelPassword })
      });
      setNotice(t.unlocked);
      setLevelPassword("");
      setMessages([]);
      await loadLevels(session.sessionId);
      setActiveLevelId((current) => {
        const currentIndex = levels.findIndex((level) => level.id === current);
        return levels[currentIndex + 1]?.id ?? current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    localStorage.removeItem(storageKeys.sessionId);
    setSession(null);
    setLevels([]);
    setMessages([]);
    setPassword("");
    setNotice("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <Sparkles size={22} />
          <span>PromptQuest</span>
        </div>
        <nav className="top-actions">
          {session ? (
            <button className="icon-text" onClick={reset} type="button">
              <LogOut size={18} />
              {t.logout}
            </button>
          ) : null}
          <a className="icon-text" href="/admin">
            <Shield size={18} />
            {t.admin}
          </a>
          <button className="ghost" onClick={switchLang} type="button">
            {t.otherLanguage}
          </button>
        </nav>
      </header>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {!session ? (
        <section className="panel intro">
          <div>
            <p className="eyebrow">{t.language}</p>
            <h1>{t.passwordTitle}</h1>
            <p>{t.passwordLead}</p>
          </div>
          <form className="login-form" onSubmit={login}>
            <label>
              <span>{t.passwordPlaceholder}</span>
              <input
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t.passwordPlaceholder}
                type="password"
              />
            </label>
            <button disabled={busy} type="submit">
              <KeyRound size={18} />
              {busy ? t.loading : t.continue}
            </button>
          </form>
        </section>
      ) : !session.questionnaireCompleted ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {t.group}: {session.group?.label ?? session.groupLabel}
              </p>
              <h1>{t.quizTitle}</h1>
              <p>{t.quizLead}</p>
            </div>
          </div>
          <form className="quiz" onSubmit={submitQuiz}>
            {t.questions.map((question, index) => (
              <fieldset key={question}>
                <legend>{question}</legend>
                <div className="scale">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label className={quiz[index] === value ? "selected" : ""} key={value}>
                      <input
                        checked={quiz[index] === value}
                        name={`q-${index}`}
                        onChange={() => setQuiz((items) => items.map((item, i) => (i === index ? value : item)))}
                        type="radio"
                        value={value}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label>
              <span>{t.freeText}</span>
              <textarea value={freeText} onChange={(event) => setFreeText(event.target.value)} rows={4} />
            </label>
            <button disabled={busy} type="submit">
              <Check size={18} />
              {busy ? t.loading : t.submitQuiz}
            </button>
          </form>
        </section>
      ) : (
        <section className="challenge-grid">
          <aside className="panel level-list">
            <p className="eyebrow">
              {t.group}: {session.group?.label ?? session.groupLabel}
            </p>
            <h1>{t.challengeTitle}</h1>
            <p>{t.challengeLead}</p>
            <div className="levels">
              {levels.map((level) => (
                <button
                  className={level.id === activeLevelId ? "level active" : "level"}
                  disabled={!level.unlocked}
                  key={level.id}
                  onClick={() => {
                    setActiveLevelId(level.id);
                    setMessages([]);
                    setNotice("");
                  }}
                  type="button"
                >
                  <span>{lang === "fi" ? level.nameFi : level.nameEn}</span>
                  {level.completed ? <Check size={17} /> : level.unlocked ? <Bot size={17} /> : <Lock size={17} />}
                </button>
              ))}
            </div>
          </aside>

          <div className="panel chat-panel">
            {activeLevel ? (
              <>
                <div className="chat-head">
                  <div>
                    <p className="eyebrow">Model: {activeLevel.model}</p>
                    <h2>{lang === "fi" ? activeLevel.nameFi : activeLevel.nameEn}</h2>
                  </div>
                  {activeLevel.completed ? <span className="pill">{t.completed}</span> : null}
                </div>
                <p className="hint">
                  {t.hint}: {lang === "fi" ? activeLevel.hintFi : activeLevel.hintEn}
                </p>
                <div className="messages">
                  {messages.length === 0 ? <p className="empty">{t.noMessages}</p> : null}
                  {messages.map((message, index) => (
                    <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                      {message.text}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <form className="prompt-row" onSubmit={sendPrompt}>
                  <input
                    disabled={busy || activeLevel.completed}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={t.promptPlaceholder}
                  />
                  <button disabled={busy || activeLevel.completed} type="submit" title={t.send}>
                    <Send size={18} />
                    <span>{t.send}</span>
                  </button>
                </form>
                <form className="unlock-row" onSubmit={unlockLevel}>
                  <input
                    disabled={busy || activeLevel.completed}
                    value={levelPassword}
                    onChange={(event) => setLevelPassword(event.target.value)}
                    placeholder={t.levelPassword}
                  />
                  <button disabled={busy || activeLevel.completed} type="submit">
                    <KeyRound size={18} />
                    {t.unlock}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}
