"use client";

import { useState, useEffect, useRef } from "react";

// --- Types ---
type Aligns = "Да" | "Скорее да" | "Скорее нет" | "Нет" | null;

// Mode state (legacy): Stuck, Doubt, Tired
type Mode = "stuck" | "doubt" | "tired";

// --- App interaction modes ---
type AppMode = "lite" | "guide" | "push";

// Новые лейблы для UI:
const appModeLabels: Record<AppMode, string> = {
  lite: "Лучший друг",
  guide: "Старший брат",
  push: "Достигатор",
};

const appModeDescriptions: Record<AppMode, string> = {
  lite: "Я помогу снизить шум и не сделать хуже.",
  guide: "Я помогу разобраться и выбрать следующий шаг.",
  push:
    "Я буду говорить прямо.\nПоказывать, где ты врёшь себе.\nИ что делать дальше без самообмана.",
};

const appModeFineDescription: Record<AppMode, string | null> = {
  lite: null,
  guide: "Без давления. По сути.",
  push: "Этот режим не щадит. Только если ты готов.",
};

// Цены и иконки не изменяются
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

type ActionKey =
  | "stuck"
  | "doubt"
  | "tired"
  | "blocker"
  | "decision"
  | "overload"
  | "move"
  | "minimum"
  | "cut";

type ActionDef = { key: ActionKey; label: string };

const appModeActions: Record<AppMode, ActionDef[]> = {
  lite: [
    { key: "stuck", label: "Я застрял" },
    { key: "doubt", label: "Я сомневаюсь" },
    { key: "tired", label: "Я устал" },
  ],
  guide: [
    { key: "blocker", label: "Где стопор?" },
    { key: "decision", label: "Решение" },
    { key: "overload", label: "Перегруз" },
  ],
  push: [
    { key: "move", label: "Выбрать ход" },
    { key: "minimum", label: "Минимум" },
    { key: "cut", label: "Сократить" },
  ],
};

// Placeholder text per (mode, action)
const appModePrompt: Record<AppMode, Record<ActionKey, string>> = {
  lite: {
    stuck: "Что сейчас происходит?",
    doubt: "Если не знаешь — так и напиши.",
    tired: "Сегодня можно меньше.",
    blocker: "",
    decision: "",
    overload: "",
    move: "",
    minimum: "",
    cut: "",
  },
  guide: {
    blocker: "Можно описать, где затык. Без спешки.",
    decision: "Можно перечислить пару вариантов.",
    overload: "Что хочется оставить на потом?",
    stuck: "",
    doubt: "",
    tired: "",
    move: "",
    minimum: "",
    cut: "",
  },
  push: {
    move: "Любая мысль подойдёт.",
    minimum: "Можно обозначить минимум.",
    cut: "Что неважно сейчас?",
    stuck: "",
    doubt: "",
    tired: "",
    blocker: "",
    decision: "",
    overload: "",
  },
};

const PAID_TRIAL_KEY = "thinkclear_paid_trial";
const PAID_TRIAL_START_KEY = "thinkclear_paid_trial_start";
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

// For journal display of action key labels in each mode
const actionLabelFor: (mode: AppMode, key: ActionKey) => string = (mode, key) => {
  const found = appModeActions[mode]?.find((a) => a.key === key);
  return found ? found.label : key;
};

// === Тип ответа API (новый!) ===
type ApiResponse =
  | { kind: "question"; text: string }
  | { kind: "answer"; blocks: { title: string; text: string }[]; nextStep?: string };

type Entry = {
  id: string;
  createdAt: string;
  inputText: string;
  lens: string;
  output: ApiResponse;
  aligns: Aligns;
  done: boolean | null;
  appMode?: AppMode;
  actionKey?: ActionKey;
  mode?: Mode;
  nextStepUser?: string;
  confidence?: number;
  falsifier?: string;
  minStep?: string;
  notDoing?: string;
};

const LOCAL_KEY = "thinkclear_entries";
const LOCAL_APP_MODE_KEY = "thinkclear_mode";

function getStoredAppMode(): AppMode | null {
  if (typeof window === "undefined") return null;
  try {
    const m = localStorage.getItem(LOCAL_APP_MODE_KEY);
    if (m === "lite" || m === "guide" || m === "push") return m;
    return null;
  } catch {
    return null;
  }
}

function setStoredAppMode(mode: AppMode) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_APP_MODE_KEY, mode);
  } catch {}
}

function clearStoredAppMode() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LOCAL_APP_MODE_KEY);
  } catch {}
}

function safeParseEntries(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        if (
          typeof x === "object" &&
          x &&
          typeof x.id === "string" &&
          typeof x.createdAt === "string" &&
          typeof x.inputText === "string" &&
          typeof x.lens === "string" &&
          typeof x.output === "object" &&
          x.output
        ) {
          let output: ApiResponse;
          if ("kind" in x.output) {
            output = x.output;
          } else if (
            typeof x.output.essence === "string" &&
            typeof x.output.assumptions === "string" &&
            typeof x.output.risks === "string" &&
            Array.isArray(x.output.strategies) &&
            typeof x.output.nextStep === "string"
          ) {
            let blocks: { title: string; text: string }[] = [];
            if (x.output.essence)
              blocks.push({ title: "Суть", text: x.output.essence });
            if (x.output.assumptions)
              blocks.push({ title: "Как это выглядит", text: x.output.assumptions });
            if (x.output.risks)
              blocks.push({ title: "Что если так оставить", text: x.output.risks });
            if (x.output.strategies?.length)
              blocks.push({ title: "Можно так", text: x.output.strategies.join("\n") });
            let nextStep = x.output.nextStep ? x.output.nextStep : undefined;
            output = { kind: "answer", blocks, nextStep };
          } else {
            output = { kind: "answer", blocks: [], nextStep: undefined };
          }
          const m =
            typeof x.appMode === "string" && ["lite", "guide", "push"].includes(x.appMode)
              ? (x.appMode as AppMode)
              : undefined;
          const act =
            typeof x.actionKey === "string"
              ? (x.actionKey as ActionKey)
              : undefined;
          const oldMode =
            ["stuck", "doubt", "tired"].includes(x.mode) ? x.mode : undefined;

          return {
            ...x,
            appMode: m,
            actionKey: act,
            mode: oldMode,
            nextStepUser: typeof x.nextStepUser === "string" ? x.nextStepUser : undefined,
            confidence:
              typeof x.confidence === "number"
                ? x.confidence
                : undefined,
            falsifier:
              typeof x.falsifier === "string"
                ? x.falsifier
                : undefined,
            minStep:
              typeof x.minStep === "string"
                ? x.minStep
                : undefined,
            notDoing:
              typeof x.notDoing === "string"
                ? x.notDoing
                : undefined,
            aligns:
              x.aligns === "Да" ||
              x.aligns === "Скорее да" ||
              x.aligns === "Скорее нет" ||
              x.aligns === "Нет"
                ? x.aligns
                : null,
            done: typeof x.done === "boolean" ? x.done : null,
            output: output,
          } as Entry;
        }
        return null;
      })
      .filter(Boolean) as Entry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: Entry[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
  } catch {}
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

function copyTextToClipboard(text: string) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

const CURRENT_LENS = "Курс";

const alignsLabels: Aligns[] = ["Да", "Скорее да", "Скорее нет", "Нет"];

function getStats(entries: Entry[]) {
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

// --- Changed: Always send default action key on analyzeDecision ---
async function analyzeDecision(
  input: string,
  appMode: AppMode,
  actionKey: ActionKey,
  previousKind: "question" | "answer" | null
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

// --- Main ---
export default function Home() {
  // Оплата и пробный доступ
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [showModeScreen, setShowModeScreen] = useState(false);
  const [showAgreement, setShowAgreement] = useState<null | "guide" | "push">(null);
  const [showTrialOverPrompt, setShowTrialOverPrompt] = useState<null | "guide" | "push">(null);
  const [showUpgrade, setShowUpgrade] = useState<null | "guide" | "push">(null); // Upgrade modal state

  // Пробная неделя
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

  function finishTrial(mode: "guide" | "push") {
    setTrialState_((curr) =>
      curr && curr.mode === mode
        ? { ...curr, finished: true }
        : curr
    );
    const val = getTrialState();
    if (val && val.mode === mode) {
      applyTrialState({ ...val, finished: true });
    }
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
  function isTrialOver(mode: "guide" | "push") {
    if (!trialState || trialState.mode !== mode) return false;
    const start = new Date(trialState.started);
    const now = new Date();
    return (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) >= 7;
  }
  function isPaidContinued(mode: "guide" | "push") {
    return !!getPaidContinue() && getPaidContinue() === mode;
  }

  // --- Multi-mode: Now, set a hardcoded ActionKey for each mode; no options in interface
  function initialActionKey(am: AppMode | null): ActionKey {
    switch (am) {
      case "lite":   return "stuck";
      case "guide":  return "blocker";
      case "push":   return "move";
      default:       return "stuck";
    }
  }
  // Hardcode selectedAction, but store for API schema compatibility:
  const [selectedAction, setSelectedAction] = useState<ActionKey>(initialActionKey(appMode));
  useEffect(() => {
    setSelectedAction(initialActionKey(appMode));
  }, [appMode]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastApiResponse, setLastApiResponse] = useState<ApiResponse | null>(null);
  const [previousKind, setPreviousKind] = useState<"question" | "answer" | null>(null);

  // Вставляем два состояния: followupInput и pendingQuestion
  const [followupInput, setFollowupInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"today" | "journal">("today");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Используется для "журнала" и фиксации (оставим, если надо)
  const [nextStepUser, setNextStepUser] = useState("");
  const [confidence, setConfidence] = useState<number>(0);
  const [falsifier, setFalsifier] = useState("");
  const [minStep, setMinStep] = useState("");
  const [notDoing, setNotDoing] = useState("");

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEntries(safeParseEntries());
  }, []);

  useEffect(() => {
    setNextStepUser("");
    setConfidence(0);
    setFalsifier("");
    setMinStep("");
    setNotDoing("");
  }, [selectedAction, lastApiResponse]);

  const stats = getStats(entries);

  // Обновляем: handleAnalyze теперь учитывает pendingQuestion и followupInput
  async function handleAnalyze() {
    if (!appMode) return;
    setLoading(true);
    setError(null);

    try {
      const defaultAction = initialActionKey(appMode);

      let usedInput = "";
      let kindToSend: "question" | "answer" | null = null;

      if (pendingQuestion !== null) {
        // Это follow-up ответ
        if (followupInput.trim().length === 0) {
          setError("Пожалуйста, напиши ответ.");
          setLoading(false);
          return;
        }
        usedInput = followupInput;
        kindToSend = "question";
      } else {
        usedInput = input;
        kindToSend = previousKind;
      }

      const analysis = await analyzeDecision(
        usedInput,
        appMode,
        defaultAction,
        pendingQuestion !== null ? "question" : kindToSend
      );
      setLastApiResponse(analysis);

      let possibleLegacyMode: Mode | undefined;
      if (appMode === "lite") {
        if (defaultAction === "stuck") possibleLegacyMode = "stuck";
        else if (defaultAction === "doubt") possibleLegacyMode = "doubt";
        else if (defaultAction === "tired") possibleLegacyMode = "tired";
      }

      if (analysis.kind === "question") {
        setPendingQuestion(analysis.text);
        setPreviousKind("question");
        setFollowupInput("");
        // input НЕ очищать, пусть остается
        // Журнал пишем только когда приходит answer!
      }
      else if (analysis.kind === "answer") {
        setPendingQuestion(null);
        setPreviousKind("answer");
        setFollowupInput("");
        // Можно очистить основной input, но необязательно (оставим как есть)
        // Сохраняем entry в журнал только по answer!
        const newEntry: Entry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          createdAt: new Date().toISOString(),
          inputText: input,
          lens: CURRENT_LENS,
          output: analysis,
          aligns: null,
          done: null,
          appMode,
          actionKey: defaultAction,
          mode: possibleLegacyMode,
        };
        let newEntries: Entry[] = [];
        setEntries((prev) => {
          newEntries = [newEntry, ...prev];
          saveEntries(newEntries);
          return newEntries;
        });
        setNextStepUser("");
        setConfidence(0);
        setFalsifier("");
        setMinStep("");
        setNotDoing("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Что-то пошло не так.");
    } finally {
      setLoading(false);
    }
  }

  // Последняя entry для journal
  const latestEntry =
    entries.length > 0 &&
    lastApiResponse &&
    (lastApiResponse.kind === "answer") &&
    JSON.stringify(entries[0]?.output) === JSON.stringify(lastApiResponse) &&
    entries[0]?.inputText === input
      ? entries[0]
      : null;

  function patchLatestEntry(fields: Partial<Entry>) {
    if (!latestEntry) return;
    setEntries((prev) => {
      const updated = prev.map((e, i) => (i === 0 ? { ...e, ...fields } : e));
      saveEntries(updated);
      return updated;
    });
  }

  function updateLatestEntry(patch: Partial<Pick<Entry, "aligns" | "done">>) {
    if (!latestEntry) return;
    setEntries((prev) => {
      const updated = prev.map((e, i) => (i === 0 ? { ...e, ...patch } : e));
      saveEntries(updated);
      return updated;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((curr) => ({
      ...curr,
      [id]: !curr[id],
    }));
  }

  function Badge({
    label,
    type,
  }: {
    label: string;
    type: "aligns" | "done" | "mode";
  }) {
    const color =
      type === "done"
        ? label === "Сделан"
          ? "bg-green-100 text-green-700 border-green-400"
          : "bg-gray-100 text-gray-600 border-gray-300"
        : type === "mode"
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : label === "Да"
        ? "bg-green-100 text-green-700 border-green-400"
        : label === "Скорее да"
        ? "bg-lime-100 text-lime-700 border-lime-400"
        : label === "Скорее нет"
        ? "bg-orange-100 text-orange-700 border-orange-400"
        : label === "Нет"
        ? "bg-rose-100 text-rose-700 border-rose-400"
        : "bg-gray-100 text-gray-600 border-gray-300";
    return (
      <span
        className={
          "inline-block px-2 py-0.5 rounded text-xs border font-semibold " +
          color
        }
      >
        {label}
      </span>
    );
  }

  function composeEntryText(e: Entry) {
    // Выводим только blocks в случае answer
    const lines = [
      `Дата: ${dateLocalString(e.createdAt)}`,
      `Линза: ${e.lens}`,
      `Ввод: ${e.inputText}`,
      "",
    ];

    if (e.output.kind === "question") {
      lines.push(e.output.text);
    } else if (e.output.kind === "answer") {
      e.output.blocks.forEach((block) => {
        if (block.title) {
          lines.push(`${block.title}:\n${block.text}`);
        } else {
          lines.push(block.text);
        }
        lines.push(""); // blank between blocks
      });
    }

    lines.push(
      "",
      `Это соотносится с твоим направлением?: ${e.aligns ? e.aligns : "—"}`,
      `Что случилось: ${
        e.done === true ? "Сделал" : e.done === false ? "Не делал" : "—"
      }`
    );
    return lines.join("\n");
  }

  // --- ЭКРАН ДОГОВОРА (просмотра тестового доступа) ---
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

  // --- ПРОМПТ ПО ОКОНЧАНИИ НЕДЕЛЬНОГО ТЕСТА ---
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

  // --- ЭКРАН АПГРЕЙДА ---
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

  // --- ЭКРАН ВЫБОРА РЕЖИМА (ONBOARDING) ---
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
            {/* Подсказка только для lite/guide, не для push */}
            {appMode !== "push" && (
              <div className="mb-3">
                <div className="text-center text-[15px] text-teal-600 font-medium">
                  {appMode && appModeWarmLine[appMode]}
                </div>
              </div>
            )}

            {/* УБРАНЫ КНОПКИ СОСТОЯНИЙ/ХОДОВ */}

            {/* ======== Новый UX для pendingQuestion ======= */}
            {pendingQuestion === null ? (
              <>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="main-input">
                  Введи свой запрос
                </label>
                <textarea
                  ref={inputRef}
                  id="main-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    // Используем только общий плейсхолдер для читаемости (не по action)
                    appMode === "lite"
                      ? "Что сейчас происходит?"
                      : appMode === "guide"
                        ? "Можно описать, где затык. Без спешки."
                        : ""
                  }
                  className="w-full min-h-[140px] p-3 rounded-lg border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none resize-y mb-4"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={
                    loading ||
                    input.trim().length < 2 ||
                    !appMode
                  }
                  className="w-full py-3 rounded-lg bg-black text-white hover:bg-gray-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? "Пишу..." : "Посмотреть"}
                </button>
              </>
            ) : (
              <>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="main-input">
                  Твой ввод
                </label>
                <textarea
                  ref={inputRef}
                  id="main-input"
                  value={input}
                  readOnly
                  tabIndex={-1}
                  className="w-full min-h-[100px] bg-gray-50 p-3 rounded-lg border border-gray-200 opacity-90 mb-2"
                />
                <div
                  className="text-2xl font-bold text-blue-900 mb-6 whitespace-pre-line text-center"
                  style={{ lineHeight: 1.4 }}
                >
                  {pendingQuestion}
                </div>
                <textarea
                  id="followup-input"
                  value={followupInput}
                  onChange={e => setFollowupInput(e.target.value)}
                  placeholder="Ответь коротко..."
                  className="w-full min-h-[56px] p-3 rounded-lg border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none resize-y mb-4"
                  disabled={loading}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={
                    loading ||
                    followupInput.trim().length === 0
                  }
                  className="w-full py-3 rounded-lg bg-black text-white hover:bg-gray-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? "Пишу..." : "Продолжить"}
                </button>
              </>
            )}
            {/* конец блока pendingQuestion UX */}

            {error && (
              <p className="mt-4 text-red-600 text-sm" role="alert">
                {error}
              </p>
            )}

            {/* === Рендер результата: только blocks/question, никаких "можно попробовать" и других секций === */}
            {lastApiResponse && latestEntry && lastApiResponse.kind === "answer" && (
              <div className="mt-8 pt-6 border-t border-gray-200 space-y-5">
                <div>
                  {lastApiResponse.blocks.map((block, idx) => (
                    <section key={idx} className="mb-5">
                      {block.title && (
                        <h2 className="text-base font-semibold text-gray-600 uppercase tracking-wide mb-2">
                          {block.title}
                        </h2>
                      )}
                      <div className="text-gray-800 whitespace-pre-line text-[16px]">{block.text}</div>
                    </section>
                  ))}
                </div>

                {/* Фиксация (aligns/done) только если answer, оставим без изменений */}
                <div className="mt-6 border-t pt-4 border-gray-100">
                  <div className="mb-3">
                    <span className="text-gray-600 text-sm font-medium">
                      Это соотносится с твоим направлением?
                    </span>
                  </div>
                  <div className="flex gap-2 mb-3">
                    {alignsLabels.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => updateLatestEntry({ aligns: label })}
                        className={`px-3 py-1 rounded-lg border text-sm font-semibold ${
                          latestEntry.aligns === label
                            ? "bg-black text-white border-black"
                            : "bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="done-today"
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                      checked={!!latestEntry.done}
                      onChange={(e) =>
                        updateLatestEntry({
                          done: e.target.checked ? true : false,
                        })
                      }
                    />
                    <label htmlFor="done-today" className="text-sm text-gray-700">
                      Что случилось
                    </label>
                  </div>
                </div>
              </div>
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
            <div>
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="border-b border-gray-100 py-4 hover:bg-gray-50 transition px-2 -mx-2"
                >
                  {/* Заголовок для записи */}
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer select-none"
                    onClick={() => toggleExpand(e.id)}
                  >
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-gray-400">{dateLocalString(e.createdAt)}</span>
                      <span className="inline-block text-xs text-gray-500 font-medium">{e.lens}</span>
                      {e.appMode && e.actionKey && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {e.appMode === "lite" && (
                            <span>{appModeIcons["lite"]}</span>
                          )}
                          <Badge
                            label={`${e.appMode ? appModeLabels[e.appMode] : ""}`}
                            type="mode"
                          />
                        </div>
                      )}
                      {!e.appMode && e.mode && (
                        <Badge label={e.mode} type="mode" />
                      )}
                      <span className="inline-block text-gray-900 font-medium text-sm truncate max-w-[18ch] align-middle">
                        {e.output.kind === "answer" && e.output.blocks[0]?.text
                          ? e.output.blocks[0].text.replace(/\s*\n.*/g, "")
                          : e.output.kind === "question"
                          ? e.output.text.replace(/\s*\n.*/g, "")
                          : ""}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-2 sm:mt-0">
                      {e.aligns && <Badge label={e.aligns} type="aligns" />}
                      {typeof e.done === "boolean" && (
                        <Badge
                          label={e.done ? "Сделал" : "Не делал"}
                          type="done"
                        />
                      )}
                    </div>
                  </div>
                  {expanded[e.id] && (
                    <div className="mt-4 px-2 sm:px-4">
                      {e.output.kind === "question" ? (
                        <div className="text-lg text-gray-900 font-semibold mb-4 whitespace-pre-line text-center">
                          {e.output.text}
                        </div>
                      ) : (
                        <div>
                          {e.output.blocks.map((block, idx) => (
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
                      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4 text-xs">
                        {e.aligns && <Badge label={e.aligns} type="aligns" />}
                        {typeof e.done === "boolean" && (
                          <Badge
                            label={e.done ? "Сделал" : "Не делал"}
                            type="done"
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className="inline-block py-2 px-4 bg-gray-800 text-white rounded-lg text-xs hover:bg-black transition"
                        onClick={() => copyTextToClipboard(composeEntryText(e))}
                      >
                        Копировать
                      </button>
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