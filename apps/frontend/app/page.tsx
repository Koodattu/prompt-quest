"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, KeyRound, Lock, LogOut, Moon, Send, Sparkles, Sun } from "lucide-react";
import { API_BASE, apiJson } from "./lib/api";
import { copy, Lang, Theme } from "./lib/i18n";

type Session = {
  sessionId: string;
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
type QuizValue = number | null;

const storageKeys = {
  sessionId: "promptquest.sessionId",
  lang: "promptquest.lang",
  theme: "promptquest.theme"
};

export default function Home() {
  const [lang, setLang] = useState<Lang>("fi");
  const [theme, setTheme] = useState<Theme>("dark");
  const t = copy[lang];
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [quiz, setQuiz] = useState<QuizValue[]>([null, null, null, null]);
  const [freeText, setFreeText] = useState("");
  const [levels, setLevels] = useState<Level[]>([]);
  const [activeLevelId, setActiveLevelId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [levelPassword, setLevelPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [celebration, setCelebration] = useState<{ levelName: string; nextLevelId?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  const activeLevel = useMemo(() => levels.find((level) => level.id === activeLevelId), [levels, activeLevelId]);
  const quizComplete = quiz.every((value) => value !== null);
  const isStreaming = busy && messages[messages.length - 1]?.role === "ai";

  useEffect(() => {
    const savedLang = localStorage.getItem(storageKeys.lang);
    const savedTheme = localStorage.getItem(storageKeys.theme);
    if (savedLang === "fi" || savedLang === "en") setLang(savedLang);
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);

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
    document.body.dataset.theme = theme;
    localStorage.setItem(storageKeys.theme, theme);
  }, [theme]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function switchLang() {
    const next = lang === "fi" ? "en" : "fi";
    setLang(next);
    localStorage.setItem(storageKeys.lang, next);
  }

  function switchTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function loadLevels(sessionId = session?.sessionId) {
    if (!sessionId) return [];
    const data = await apiJson<{ levels: Level[] }>(`/api/levels?sessionId=${encodeURIComponent(sessionId)}`);
    setLevels(data.levels);
    const current = data.levels.find((level) => !level.completed && level.unlocked) ?? data.levels[0];
    setActiveLevelId((previous) => {
      const previousStillValid = data.levels.some((level) => level.id === previous && level.unlocked);
      return previousStillValid ? previous : current?.id || "";
    });
    return data.levels;
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
    if (!session || !quizComplete) {
      setError(t.missingQuiz);
      return;
    }
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
      setTimeout(() => promptInputRef.current?.focus(), 80);
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
        body: JSON.stringify({
          sessionId: session.sessionId,
          levelId: activeLevel.id,
          message: userText,
          language: lang
        })
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
      setTimeout(() => promptInputRef.current?.focus(), 50);
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
      const nextLevels = await loadLevels(session.sessionId);
      const currentIndex = nextLevels.findIndex((level) => level.id === activeLevel.id);
      const nextLevel = nextLevels[currentIndex + 1];
      setCelebration({
        levelName: lang === "fi" ? activeLevel.nameFi : activeLevel.nameEn,
        nextLevelId: nextLevel?.id
      });
      setLevelPassword("");
      setMessages([]);
      setNotice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }

  function continueAfterCelebration() {
    if (celebration?.nextLevelId) setActiveLevelId(celebration.nextLevelId);
    setCelebration(null);
    setTimeout(() => promptInputRef.current?.focus(), 80);
  }

  function reset() {
    localStorage.removeItem(storageKeys.sessionId);
    setSession(null);
    setLevels([]);
    setMessages([]);
    setPassword("");
    setNotice("");
    setError("");
    setQuiz([null, null, null, null]);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <Sparkles size={22} />
          <span>PromptQuest</span>
        </div>
        <nav className="top-actions" aria-label="Controls">
          {session ? (
            <button className="icon-text" onClick={reset} type="button">
              <LogOut size={18} />
              {t.logout}
            </button>
          ) : null}
          <button className="ghost" onClick={switchLang} type="button">
            {t.otherLanguage}
          </button>
          <button className="icon-only" onClick={switchTheme} type="button" title={theme === "dark" ? t.themeLight : t.themeDark}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </nav>
      </header>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {!session ? (
        <section className="panel intro compact-intro">
          <div>
            <h1>{t.passwordTitle}</h1>
            <p>{t.passwordLead}</p>
          </div>
          <form className="login-form" onSubmit={login}>
            <label>
              <span>{t.passwordPlaceholder}</span>
              <input
                autoComplete="current-password"
                autoFocus
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
        <section className="panel quiz-panel">
          <div className="section-heading tight-heading">
            <div>
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
                      <span className="scale-number">{value}</span>
                      <span className="scale-label">{t.scale[value - 1]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label>
              <span>
                {t.freeText} <small>{t.optional}</small>
              </span>
              <textarea value={freeText} onChange={(event) => setFreeText(event.target.value)} rows={4} />
            </label>
            <button disabled={busy || !quizComplete} type="submit">
              <Check size={18} />
              {busy ? t.loading : t.submitQuiz}
            </button>
          </form>
        </section>
      ) : (
        <section className="challenge-grid">
          <aside className="panel level-list">
            <div className="section-heading tight-heading">
              <div>
                <h1>{t.challengeTitle}</h1>
                <p>{t.challengeLead}</p>
              </div>
            </div>
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
                    setTimeout(() => promptInputRef.current?.focus(), 80);
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
                    <p className="eyebrow">Level {activeLevel.difficulty}</p>
                    <h2>{lang === "fi" ? activeLevel.nameFi : activeLevel.nameEn}</h2>
                  </div>
                  {activeLevel.completed ? <span className="pill">{t.completed}</span> : null}
                </div>
                <p className="hint">
                  {t.hint}: {lang === "fi" ? activeLevel.hintFi : activeLevel.hintEn}
                </p>
                <div className="messages" aria-live="polite">
                  {messages.length === 0 ? <p className="empty">{t.noMessages}</p> : null}
                  {messages.map((message, index) => (
                    <div className={`message-wrap ${message.role}`} key={`${message.role}-${index}`}>
                      <span className="message-author">{message.role === "user" ? t.you : t.ai}</span>
                      <div className={`message ${message.role} ${isStreaming && index === messages.length - 1 ? "streaming" : ""}`}>
                        {message.text || (message.role === "ai" ? t.aiTyping : "")}
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <form className="prompt-row" onSubmit={sendPrompt}>
                  <input
                    disabled={busy || activeLevel.completed}
                    ref={promptInputRef}
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

      {celebration ? (
        <div className="celebration" role="dialog" aria-modal="true" aria-labelledby="level-complete-title">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 24 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="celebration-card">
            <div className="celebration-emoji">🎉</div>
            <h2 id="level-complete-title">{t.unlocked}</h2>
            <p>{celebration.levelName}</p>
            <button onClick={continueAfterCelebration} type="button">
              {celebration.nextLevelId ? t.nextLevel : t.keepPlaying}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
