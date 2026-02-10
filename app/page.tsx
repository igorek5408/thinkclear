"use client";

import { useState, useEffect, useRef } from "react";

// --- Types ---
type Aligns = "Да" | "Скорее да" | "Скорее нет" | "Нет" | null;
type Mode = "stuck" | "doubt" | "tired";
type AppMode = "lite" | "guide" | "push";
type ChatMsg = { role: "user" | "assistant"; kind?: "question" | "answer"; text: string; ts: number };

const appModeLabels: Record<AppMode, string> = {
  lite: "Лучший друг",
  guide: "Старший брат",
  push: "Достигатор",
};

const appModeDescriptions: Record<AppMode, string> = {
  lite: "Я помогу снизить шум и не сделать хуже.",
  guide: "Я помогу разобраться и выбрать следующий шаг.",
  push: "Я буду говорить прямо.\nПоказывать, где ты врёшь себе.\nИ что делать дальше без самообмана.",
};

const appModeFineDescription: Record<AppMode, string | null> = {
  lite: null,
  guide: "Без давления. По сути.",
  push: "Этот режим не щадит. Только если ты готов.",
};

const appModePrices: Record<AppMode, string | null> = {
  lite: null,
  guide: "$3",
  push: "$5",
};

const appModeIcons: Record<AppMode, string> = {
  lite: "☀️",
  guide: "🧭",
  push: "🔥",
};

const appModeWarmLine: Record<AppMode, string> = {
  lite: "Я тут. Можно коротко, как есть.",
  guide: "Опиши, что главное сейчас.",
  push: "Пиши просто и не спеши.",
};

const PAID_TRIAL_KEY = "thinkclear_paid_trial";
const PAID_MODE_KEY = "thinkclear_paid_mode";
const PAID_CONTINUE_KEY = "thinkclear_paid_continue";
type PaidTrialState = {
  mode: "guide" | "push";
  started: string; // ISO date string
  finished: boolean;
  continued: boolean;
};
function getTrialState(): PaidTrialState | null {
  if (typeof window === "undefined") return null;
  try {
    const val = localStorage.getItem(PAID_TRIAL_KEY);
    if (!val) return null;
    return JSON.parse(val) as PaidTrialState;
  } catch {
    return null;
  }
}
function setTrialState(state: PaidTrialState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PAID_TRIAL_KEY, JSON.stringify(state));
  } catch {}
}
function clearTrialState() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PAID_TRIAL_KEY);
    localStorage.removeItem(PAID_MODE_KEY);
    localStorage.removeItem(PAID_CONTINUE_KEY);
  } catch {}
}
function setPaidContinue(mode: "guide" | "push") {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PAID_CONTINUE_KEY, mode);
  } catch {}
}
function getPaidContinue() {
  if (typeof window === "undefined") return null;
  try {
    const val = localStorage.getItem(PAID_CONTINUE_KEY);
    if (val === "guide" || val === "push") return val;
    return null;
  } catch {
    return null;
  }
}

const CURRENT_LENS = "Курс";

function getStoredAppMode(): AppMode | null {
  if (typeof window === "undefined") return null;
  try {
    const m = localStorage.getItem("thinkclear_mode");
    if (m === "lite" || m === "guide" || m === "push") return m;
    return null;
  } catch {
    return null;
  }
}

function setStoredAppMode(mode: AppMode) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("thinkclear_mode", mode);
  } catch {}
}

function clearStoredAppMode() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("thinkclear_mode");
  } catch {}
}

// API response type:
type ApiResponse =
  | { kind: "question"; text: string }
  | { kind: "answer"; blocks: { title: string; text: string }[]; nextStep?: string };

async function analyzeDecision(
  input: string,
  appMode: AppMode,
  actionKey: string,
  previousKind: "question" | "answer" | null,
): Promise<ApiResponse> {
  const dataForBody: any = { input, appMode, actionKey };
  if (previousKind !== null) {
    dataForBody.previousKind = previousKind;
  }
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dataForBody),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Ошибка ${res.status}`);
  }
  const data = await res.json();
  if (data.kind === "question") {
    return { kind: "question", text: data.text ?? "" };
  }
  if (data.kind === "answer" && Array.isArray(data.blocks)) {
    return {
      kind: "answer",
      blocks: data.blocks.map((block: any) => ({
        title: block.title ?? "",
        text: block.text ?? "",
      })),
      nextStep: data.nextStep ?? undefined,
    };
  }
  throw new Error("Неверный формат ответа от сервера.");
}

function todayISO() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}
function isSameDay(dateA: string, dateB: string) {
  return dateA.slice(0, 10) === dateB.slice(0, 10);
}
function dateLocalString(iso: string) {
  try {
    const date = new Date(iso);
    return (
      date
        .toLocaleDateString("ru-RU", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        }) +
      " " +
      date
        .toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
    );
  } catch {
    return iso;
  }
}

function getStats(entries: { createdAt: string }[]) {
  const todayStr = todayISO();
  let todayCount = 0;
  const daySet = new Set<string>();
  const now = new Date();
  for (const e of entries) {
    const entryDate = e.createdAt.slice(0, 10);
    if (entryDate === todayStr) todayCount++;
    const day = new Date(entryDate);
    if (
      !isNaN(day as unknown as number) &&
      day.getTime() <= now.getTime() &&
      now.getTime() - day.getTime() < 8 * 24 * 60 * 60 * 1000
    ) {
      daySet.add(entryDate);
    }
  }
  return { today: todayCount, week: daySet.size };
}

export default function Home() {
  // ---- Мульти-режим (оплата/промо/доступ) — оставляем как есть.
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [showModeScreen, setShowModeScreen] = useState(false);
  const [showAgreement, setShowAgreement] = useState<null | "guide" | "push">(null);
  const [showTrialOverPrompt, setShowTrialOverPrompt] = useState<null | "guide" | "push">(null);
  const [showUpgrade, setShowUpgrade] = useState<null | "guide" | "push">(null); // Upgrade modal state

  // Пробная неделя/оплата
  const [trialState, setTrialState_] = useState<PaidTrialState | null>(null);
  useEffect(() => {
    setTrialState_(getTrialState());
  }, [showModeScreen]);

  function startTrial(mode: "guide" | "push") {
    const nowIso = new Date().toISOString();
    const obj: PaidTrialState = { mode, started: nowIso, finished: false, continued: false };
    applyTrialState(obj);
    setTrialState_(obj);
    setStoredAppMode(mode);
    setAppMode(mode);
    setShowModeScreen(false);
    setShowAgreement(null);
  }

  function applyTrialState(obj: PaidTrialState | null) {
    if (obj) setTrialState_(obj);
    if (!obj) {
      clearTrialState();
      setTrialState_(null);
      return;
    }
    setTrialState_(obj);
    setTrialState(obj);
  }

  function continuePaidMode(mode: "guide" | "push") {
    setPaidContinue(mode);
    setStoredAppMode(mode);
    setAppMode(mode);
    setShowTrialOverPrompt(null);
    setShowModeScreen(false);
    setTrialState_((curr) =>
      curr && curr.mode === mode
        ? { ...curr, continued: true, finished: true }
        : curr
    );
    const val = getTrialState();
    if (val && val.mode === mode) {
      applyTrialState({ ...val, continued: true, finished: true });
    }
  }

  function isTrialActive(mode: "guide" | "push") {
    if (!trialState || trialState.mode !== mode) return false;
    if (trialState.finished) return false;
    const start = new Date(trialState.started);
    const now = new Date();
    if ((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) < 7) {
      return true;
    }
    return false;
  }
  function isPaidContinued(mode: "guide" | "push") {
    return !!getPaidContinue() && getPaidContinue() === mode;
  }

  // --- МОД выбора режима и прочее, не трогаем
  function initialActionKey(am: AppMode | null): string {
    switch (am) {
      case "lite":   return "stuck";
      case "guide":  return "blocker";
      case "push":   return "move";
      default:       return "stuck";
    }
  }

  // --- ЧАТ СОСТОЯНИЯ
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAssistantKind, setLastAssistantKind] = useState<"question" | "answer" | null>(null);

  // История для журнала — только для таба "journal", не трогаем реализацию дневника
  const [entries, setEntries] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"today" | "journal">("today");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const m = getStoredAppMode();
    setTrialState_(getTrialState());
    setShowAgreement(null);
    setShowTrialOverPrompt(null);

    if (m === "guide" || m === "push") {
      const trialCur = getTrialState();
      if (trialCur && trialCur.mode === m && trialCur.finished && !isPaidContinued(m)) {
        setShowTrialOverPrompt(m);
        setAppMode("lite");
        setStoredAppMode("lite");
      } else if (trialCur && trialCur.mode === m && isTrialActive(m)) {
        setAppMode(m);
      } else if (trialCur && trialCur.mode === m && trialCur.continued) {
        setAppMode(m);
      } else if (!trialCur) {
        setAppMode("lite");
        setShowAgreement(m);
      } else {
        setAppMode("lite");
      }
    } else if (m === "lite" || !m) {
      setAppMode(m ?? null);
    }
  }, []);

  // Для подсчёта статистики по "дневнику" - отдельно
  useEffect(() => {
    if (typeof window === "undefined") return;
    const safeParseEntries = () => {
      try {
        const raw = localStorage.getItem("thinkclear_entries");
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr;
      } catch {
        return [];
      }
    };
    setEntries(safeParseEntries());
  }, []);

  // --- chat UX: blocks к тексту
  function blocksToText(blocks: { title: string; text: string }[]) {
    return blocks
      .filter((block) => (block.text && block.text.trim()) || (block.title && block.title.trim()))
      .map((block) => {
        if (block.title && block.text && block.text.trim()) {
          return `${block.title.toUpperCase()}\n${block.text.trim()}`;
        }
        if (block.title) return block.title;
        return block.text.trim();
      })
      .join("\n\n");
  }

  // --- handle sending the message (Отправить)
  async function handleSend() {
    if (!input.trim() || !appMode || loading) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Добавить user сообщение в чат.
      const userMsg: ChatMsg = {
        role: "user",
        text: input.trim(),
        ts: Date.now(),
      };
      setChat((prev) => [...prev, userMsg]);

      // 2. Формировать контекст (6-10 последних сообщений, плюс текущий ввод)
      //    - берем последние N сообщений chat после ДОБАВЛЕНИЯ userMsg (но тут нет race, т.к. setChat async, берем осн. массив)
      let contextMsgs = [...chat, userMsg];
      if (contextMsgs.length > 10) contextMsgs = contextMsgs.slice(-10);

      const contextStr =
        "Диалог:\n" +
        contextMsgs
          .map((msg) =>
            msg.role === "user"
              ? `Пользователь: ${msg.text}`
              : `Ассистент: ${msg.text}`
          )
          .join("\n") +
        `\n\nНовая реплика пользователя: ${input.trim()}`;

      // 3. actionKey хардкодим как по режиму:
      const defaultAction = initialActionKey(appMode);

      // 4. previousKind — то, что assistant прислал прошлым сообщением (или null):
      const kindToSend = lastAssistantKind;

      // 5. API вызов
      const resp = await analyzeDecision(
        contextStr,
        appMode,
        defaultAction,
        kindToSend,
      );

      // 6. После ответа — добавить assistant сообщение в чат с нужным kind и содержимым
      if (resp.kind === "question") {
        setChat((prev) => [
          ...prev,
          {
            role: "assistant",
            kind: "question",
            text: resp.text,
            ts: Date.now() + 1,
          }
        ]);
        setLastAssistantKind("question");
      } else if (resp.kind === "answer") {
        setChat((prev) => [
          ...prev,
          {
            role: "assistant",
            kind: "answer",
            text: blocksToText(resp.blocks),
            ts: Date.now() + 1,
          }
        ]);
        setLastAssistantKind("answer");
      }
      setInput(""); // Очистить поле
    } catch (e) {
      setError(e instanceof Error ? e.message : "Что-то пошло не так.");
    } finally {
      setLoading(false);
    }
  }

  // ---- Новый заход (очистить диалог)
  function handleNewDialog() {
    setChat([]);
    setInput("");
    setLastAssistantKind(null);
  }

  function toggleExpand(id: string) {
    setExpanded((curr) => ({
      ...curr,
      [id]: !curr[id],
    }));
  }

  // --- UI переключение режимов, договора, апгрейдов
  function renderAgreementScreen(mode: "guide" | "push") {
    const price = appModePrices[mode];
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 flex flex-col gap-8 items-center">
          <div className="w-full flex flex-col items-center text-center gap-2 mb-2">
            <span className="text-2xl">{appModeIcons[mode]}</span>
            <h1 className="text-xl font-semibold mb-1 mt-2">{appModeLabels[mode]}</h1>
            <span className="text-base text-gray-700 mt-2 mb-1">
              Этот режим задаёт другой тон разговора.<br />
              Если хочешь, можешь попробовать его в течение недели.<br />
              Без оплаты. Потом решишь, оставлять его или нет.
            </span>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button
              className="w-full px-4 py-3 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
              onClick={() => startTrial(mode)}
              type="button"
            >
              Попробовать неделю
            </button>
            <button
              className="w-full py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 font-normal mt-1"
              onClick={() => {
                setShowAgreement(null);
                setStoredAppMode("lite");
                setAppMode("lite");
                setShowModeScreen(false);
              }}
              type="button"
              autoFocus
            >
              Оставить как есть
            </button>
          </div>
        </div>
      </main>
    );
  }

  function renderTrialOverPrompt(mode: "guide" | "push") {
    const price = appModePrices[mode];
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 flex flex-col gap-8 items-center">
          <div className="w-full flex flex-col items-center text-center gap-2 mb-2">
            <span className="text-2xl">{appModeIcons[mode]}</span>
            <h1 className="text-xl font-semibold mb-1 mt-2">{appModeLabels[mode]}</h1>
            <span className="text-base text-gray-700 mt-2 mb-1">
              Мы договаривались на неделю.<br />
              Хочешь продолжить — или вернёмся к Лучшему другу?
            </span>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button
              className="w-full px-4 py-3 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
              onClick={() => {
                continuePaidMode(mode);
                setShowTrialOverPrompt(null);
              }}
              type="button"
            >
              Продолжить{price ? ` (${price})` : ""}
            </button>
            <button
              className="w-full py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 font-normal mt-1"
              onClick={() => {
                setShowTrialOverPrompt(null);
                setStoredAppMode("lite");
                setAppMode("lite");
                clearTrialState();
                setShowModeScreen(false);
              }}
              type="button"
              autoFocus
            >
              Вернуться к Лучшему другу
            </button>
          </div>
        </div>
      </main>
    );
  }

  function renderUpgradeScreen(current?: "guide" | "push" | null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4 z-50 absolute top-0 left-0 w-full h-full">
        <div className="w-full max-w-lg bg-white rounded-xl shadow-md p-6 flex flex-col gap-8 items-center">
          <div className="w-full flex flex-col items-center text-center gap-1 mb-2">
            <h1 className="text-2xl font-bold mb-1 mt-2">Переход на другой режим</h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            {/* Лучший друг */}
            <div className="flex flex-col flex-1 items-stretch rounded-lg border border-gray-200 bg-gray-50">
              <div className="p-4 flex flex-col items-center gap-1">
                <span className="text-lg font-semibold mt-1 flex items-center gap-1">
                  <span>{appModeIcons["lite"]}</span>
                  {appModeLabels["lite"]}
                </span>
                <span className="text-gray-600 text-sm mt-2 whitespace-pre-line text-center">{appModeDescriptions["lite"]}</span>
                {appModeFineDescription["lite"] && (
                  <span className="text-gray-400 text-xs mt-2">{appModeFineDescription["lite"]}</span>
                )}
              </div>
              <div className="px-4 pb-4 mt-2">
                <button
                  className="w-full px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                  onClick={() => {
                    setStoredAppMode("lite");
                    setAppMode("lite");
                    setShowUpgrade(null);
                    setShowModeScreen(false);
                  }}
                  type="button"
                >Выбрать</button>
              </div>
              <div className="text-amber-600 text-xs text-center mb-2">Бесплатно</div>
            </div>
            {/* Старший брат */}
            <div className="flex flex-col flex-1 items-stretch rounded-lg border border-gray-200 bg-gray-50">
              <div className="p-4 flex flex-col items-center gap-1">
                <span className="text-2xl">{appModeIcons["guide"]}</span>
                <span className="text-lg font-semibold mt-1">{appModeLabels["guide"]}</span>
                <span className="text-gray-600 text-sm mt-2 whitespace-pre-line text-center">{appModeDescriptions["guide"]}</span>
                {appModeFineDescription["guide"] && (
                  <span className="text-gray-400 text-xs mt-2">{appModeFineDescription["guide"]}</span>
                )}
              </div>
              <div className="px-4 pb-4 mt-2">
                <button
                  className="w-full px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                  onClick={() => {
                    setShowUpgrade(null);
                    setShowAgreement("guide");
                  }}
                  type="button"
                >Выбрать этот режим</button>
              </div>
              <div className="text-amber-600 text-xs text-center mb-2">{appModePrices["guide"]}/мес</div>
            </div>
            {/* Достигатор */}
            <div className="flex flex-col flex-1 items-stretch rounded-lg border border-gray-200 bg-gray-50">
              <div className="p-4 flex flex-col items-center gap-1">
                <span className="text-2xl">{appModeIcons["push"]}</span>
                <span className="text-lg font-semibold mt-1">{appModeLabels["push"]}</span>
                <span className="text-gray-600 text-sm mt-2 whitespace-pre-line text-center">{appModeDescriptions["push"]}</span>
                {appModeFineDescription["push"] && (
                  <span className="text-gray-400 text-xs mt-2">{appModeFineDescription["push"]}</span>
                )}
              </div>
              <div className="px-4 pb-4 mt-2">
                <button
                  className="w-full px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                  onClick={() => {
                    setShowUpgrade(null);
                    setShowAgreement("push");
                  }}
                  type="button"
                >Мне нужен честный разговор</button>
              </div>
              <div className="text-amber-600 text-xs text-center mb-2">{appModePrices["push"]}/мес</div>
            </div>
          </div>
          <div className="mt-2 text-gray-400 text-xs text-center">
              Thinkclear не принимает решений за тебя. Он лишь помогает увидеть следующий шаг.
          </div>
          <button
            className="mt-2 underline text-xs text-gray-500 hover:text-gray-900"
            onClick={() => setShowUpgrade(null)}
            type="button"
          >
            Отмена
          </button>
        </div>
      </main>
    );
  }

  function renderModeScreen() {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-xl bg-white rounded-xl shadow-md p-6 flex flex-col gap-10 items-center">
          <div className="w-full flex flex-col items-center text-center gap-2 mb-2">
            <h1 className="text-2xl font-bold mb-1 mt-2">Какой формат тебе сейчас нужен?</h1>
            <span className="text-sm text-gray-500 mt-0.5 mb-2">
              Режим можно поменять в любой момент.
            </span>
          </div>
          <div className="flex flex-col gap-4 w-full">
            {/* Карточки трех режимов */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="w-full flex flex-col items-center justify-between md:flex-row rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition px-4 py-5">
                  <div className="flex flex-col items-center text-center flex-grow">
                    <span className="text-lg font-semibold mt-1 flex items-center gap-1">
                      <span>{appModeIcons["lite"]}</span>
                      {appModeLabels["lite"]}
                    </span>
                    <span className="text-gray-600 text-sm mt-2 whitespace-pre-line">{appModeDescriptions["lite"]}</span>
                  </div>
                  <div className="mt-3">
                    <button
                      className="px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                      onClick={() => {
                        setStoredAppMode("lite");
                        setAppMode("lite");
                        setShowModeScreen(false);
                        setShowUpgrade(null);
                        setShowAgreement(null);
                      }}
                      type="button"
                    >
                      Выбрать
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="w-full flex flex-col items-center md:flex-row rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition px-4 py-5">
                  <div className="flex flex-col items-center text-center flex-grow">
                    <span className="text-2xl">{appModeIcons["guide"]}</span>
                    <span className="text-lg font-semibold mt-1">{appModeLabels["guide"]}</span>
                    <span className="text-gray-600 text-sm mt-2 whitespace-pre-line">{appModeDescriptions["guide"]}</span>
                    <span className="text-gray-400 text-xs mt-2">{appModeFineDescription["guide"]}</span>
                  </div>
                  <div className="mt-3 flex flex-col items-center">
                    <button
                      className="px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                      onClick={() => {
                        const trial = getTrialState();
                        if (!trial || trial.mode !== "guide" || (!isTrialActive("guide") && !isPaidContinued("guide"))) {
                          setShowUpgrade("guide");
                        } else {
                          setStoredAppMode("guide");
                          setAppMode("guide");
                          setShowModeScreen(false);
                          setShowAgreement(null);
                        }
                      }}
                      type="button"
                    >
                      Выбрать
                    </button>
                    <span className="text-amber-600 text-xs mt-1 ml-px">{appModePrices["guide"]}/мес</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="w-full flex flex-col items-center md:flex-row rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition px-4 py-5">
                  <div className="flex flex-col items-center text-center flex-grow">
                    <span className="text-2xl">{appModeIcons["push"]}</span>
                    <span className="text-lg font-semibold mt-1">{appModeLabels["push"]}</span>
                    <span className="text-gray-600 text-sm mt-2 whitespace-pre-line">{appModeDescriptions["push"]}</span>
                    <span className="text-gray-400 text-xs mt-2">{appModeFineDescription["push"]}</span>
                  </div>
                  <div className="mt-3 flex flex-col items-center">
                    <button
                      className="px-4 py-2 rounded-lg border border-black bg-black text-white font-semibold hover:bg-gray-900 transition"
                      onClick={() => {
                        const trial = getTrialState();
                        if (!trial || trial.mode !== "push" || (!isTrialActive("push") && !isPaidContinued("push"))) {
                          setShowUpgrade("push");
                        } else {
                          setStoredAppMode("push");
                          setAppMode("push");
                          setShowModeScreen(false);
                          setShowAgreement(null);
                        }
                      }}
                      type="button"
                    >
                      Мне нужен честный разговор
                    </button>
                    <span className="text-amber-600 text-xs mt-1 ml-px">{appModePrices["push"]}/мес</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {showUpgrade && renderUpgradeScreen(showUpgrade)}
      </main>
    );
  }

  if (showUpgrade) {
    return renderUpgradeScreen(showUpgrade);
  }
  if (showAgreement === "guide" || showAgreement === "push") {
    return renderAgreementScreen(showAgreement);
  }
  if (showTrialOverPrompt === "guide" || showTrialOverPrompt === "push") {
    return renderTrialOverPrompt(showTrialOverPrompt);
  }
  if (showModeScreen || !appMode) {
    return renderModeScreen();
  }

  function AppModeIndicator() {
    let ui = appMode ? (
      <span className="inline-flex items-center gap-1">
        {appMode === "lite" && <span>{appModeIcons["lite"]}</span>}
        {appModeLabels[appMode]}
      </span>
    ) : null;
    let note: string | null = null;
    if (appMode && (appMode === "guide" || appMode === "push") && isTrialActive(appMode)) {
      note = "Неделя бесплатно";
    } else if (appMode && (appMode === "guide" || appMode === "push") && isPaidContinued(appMode)) {
      note = appModePrices[appMode] ? appModePrices[appMode]! + "/мес" : null;
    }
    return (
      <div className="absolute right-0 top-0 mt-4 mr-4 z-20 flex items-center gap-2">
        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-lg">
          {`Режим: `}{ui}{note ? ` · ${note}` : ""}
        </span>
        <button
          className="text-gray-400 text-xs underline hover:text-gray-600 transition p-1"
          type="button"
          onClick={() => {
            clearStoredAppMode();
            setAppMode(null);
            setShowModeScreen(true);
          }}
        >
          Изменить режим
        </button>
      </div>
    );
  }

  // --- UI ---
  const stats = getStats(entries);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4 relative">
      <AppModeIndicator />
      <div className="bg-white p-0 sm:p-8 rounded-xl shadow-md w-full max-w-2xl">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-4">
          <button
            className={`flex-1 py-3 text-center font-semibold text-sm ${
              tab === "today"
                ? "border-b-2 border-black text-black"
                : "text-gray-500 hover:text-black"
            }`}
            onClick={() => setTab("today")}
          >
            Сегодня
          </button>
          <button
            className={`flex-1 py-3 text-center font-semibold text-sm ${
              tab === "journal"
                ? "border-b-2 border-black text-black"
                : "text-gray-500 hover:text-black"
            }`}
            onClick={() => setTab("journal")}
          >
            Дневник
          </button>
        </div>

        {/* Stats line */}
        <div className="text-xs text-gray-500 mb-6 flex gap-6">
          <span>Сегодня: <b>{stats.today}</b></span>
          <span>Неделя: <b>{stats.week}</b>/7</span>
        </div>

        {tab === "today" && (
          <div>
            <div className="mb-2 mt-2">
              <h1 className="text-2xl font-bold mb-1 text-center">Давай посмотрим, где ты сейчас.</h1>
              <p className="text-center text-base font-medium text-gray-700 mb-6">
                Какой следующий шаг без самообмана?
              </p>
            </div>
            {appMode !== "push" && (
              <div className="mb-3">
                <div className="text-center text-[15px] text-teal-600 font-medium">
                  {appMode && appModeWarmLine[appMode]}
                </div>
              </div>
            )}

            {/* === ЧАТ === */}
            <div
              className="mb-6 max-h-[440px] overflow-y-auto px-2 flex flex-col gap-3"
              style={{ minHeight: "200px" }}
            >
              {chat.length === 0 && (
                <div className="text-gray-400 text-center mt-8">
                  Нет сообщений. Начни диалог 👋
                </div>
              )}
              {chat.map((msg, idx) => (
                <div
                  key={msg.ts + "-" + idx}
                  className={
                    "flex " +
                    (msg.role === "user" ? "justify-end" : "justify-start")
                  }
                >
                  <div
                    className={
                      "rounded-xl px-4 py-2 max-w-[80%] break-words " +
                      (msg.role === "user"
                        ? "bg-blue-600 text-white self-end ml-auto"
                        : msg.kind === "question"
                        ? "bg-yellow-50 text-yellow-800 border border-yellow-100 font-semibold"
                        : "bg-gray-100 text-gray-900")
                    }
                    style={
                      msg.kind === "question"
                        ? { fontWeight: 600, fontSize: "18px" }
                        : msg.kind === "answer"
                        ? { whiteSpace: "pre-line", fontSize: "16px" }
                        : {}
                    }
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                handleSend();
              }}
              className="w-full"
              autoComplete="off"
            >
              <label className="block text-xs text-gray-500 mb-1" htmlFor="main-input">
                Твой ввод
              </label>
              <textarea
                ref={inputRef}
                id="main-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  lastAssistantKind === "question"
                    ? "Ответь коротко на вопрос выше..."
                    : "Напиши, что происходит..."
                }
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none resize-y mb-3"
                disabled={loading}
                autoFocus
                spellCheck={true}
              />

              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={
                    loading ||
                    input.trim().length < 1 ||
                    !appMode
                  }
                  className="flex-1 py-3 rounded-lg bg-black text-white hover:bg-gray-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? "Пишу..." : "Отправить"}
                </button>
                <button
                  type="button"
                  onClick={handleNewDialog}
                  className="px-3 py-3 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 text-xs flex-shrink-0"
                  title="Новый диалог"
                  tabIndex={0}
                >
                  Новый заход
                </button>
              </div>
            </form>

            {error && (
              <p className="mt-4 text-red-600 text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {tab === "journal" && (
          <div>
            {entries.length === 0 && (
              <div className="text-gray-400 text-center mt-16">
                Нет записей.
              </div>
            )}
            {/* Журнал — старая реализация */}
            <div>
              {entries.map((e: any) => (
                <div
                  key={e.id}
                  className="border-b border-gray-100 py-4 hover:bg-gray-50 transition px-2 -mx-2"
                >
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer select-none"
                    onClick={() => toggleExpand(e.id)}
                  >
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-gray-400">{dateLocalString(e.createdAt)}</span>
                      <span className="inline-block text-xs text-gray-500 font-medium">{e.lens}</span>
                      {e.appMode && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-500">
                          {appModeIcons[e.appMode]}
                          {appModeLabels[e.appMode]}
                        </span>
                      )}
                      <span className="inline-block text-gray-900 font-medium text-sm truncate max-w-[18ch] align-middle">
                        {e.output && e.output.kind === "answer" && e.output.blocks[0]?.text
                          ? e.output.blocks[0].text.replace(/\s*\n.*/g, "")
                          : e.output && e.output.kind === "question"
                          ? e.output.text.replace(/\s*\n.*/g, "")
                          : ""}
                      </span>
                    </div>
                  </div>
                  {expanded[e.id] && (
                    <div className="mt-4 px-2 sm:px-4">
                      {e.output && e.output.kind === "question" ? (
                        <div className="text-lg text-gray-900 font-semibold mb-4 whitespace-pre-line text-center">
                          {e.output.text}
                        </div>
                      ) : (
                        <div>
                          {e.output.blocks && e.output.blocks.map((block: any, idx: number) => (
                            <section key={idx} className="mb-3">
                              {block.title && (
                                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">
                                  {block.title}
                                </h2>
                              )}
                              <p className="text-gray-800 whitespace-pre-line">{block.text}</p>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}