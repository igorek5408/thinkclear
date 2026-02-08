"use client";

import { useState, useEffect, useRef } from "react";

// --- Types ---
type AnalysisResult = {
  essence: string;
  assumptions: string;
  risks: string;
  strategies: string[];
  nextStep: string;
};

type Aligns = "Да" | "Скорее да" | "Скорее нет" | "Нет" | null;

// Mode state (legacy): Stuck, Doubt, Tired
type Mode = "stuck" | "doubt" | "tired";

// --- App interaction modes ---
type AppMode = "lite" | "guide" | "push";
const appModeLabels: Record<AppMode, string> = {
  lite: "Поддержка",
  guide: "Держи курс",
  push: "Подгоняй",
};

const appModeDescriptions: Record<AppMode, string> = {
  lite: "Тёплый друг. Просто рядом.",
  guide: "Рамка и критерий для твоей ситуации.",
  push: "Ясно и коротко. Можно на потом.",
};

const appModePrices: Record<AppMode, string | null> = {
  lite: null,
  guide: "$3 / месяц",
  push: "$5 / месяц",
};

const appModeIcons: Record<AppMode, string> = {
  lite: "🫂",
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

type Entry = {
  id: string;
  createdAt: string;
  inputText: string;
  lens: string;
  output: {
    essence: string;
    assumptions: string;
    risks: string;
    strategies: string[];
    nextStep: string;
  };
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
          x.output &&
          typeof x.output.essence === "string" &&
          typeof x.output.assumptions === "string" &&
          typeof x.output.risks === "string" &&
          Array.isArray(x.output.strategies) &&
          typeof x.output.nextStep === "string"
        ) {
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

async function analyzeDecision(
  input: string,
  appMode: AppMode,
  actionKey: ActionKey
): Promise<AnalysisResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, appMode, actionKey }),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Ошибка ${res.status}`);
  }

  const data = await res.json();

  return {
    essence: data.essence ?? "",
    assumptions: data.assumptions ?? "",
    risks: data.risks ?? "",
    strategies: Array.isArray(data.strategies) ? data.strategies : [],
    nextStep: data.nextStep ?? "",
  };
}

// --- Main ---
export default function Home() {
  // Оплата и пробный доступ
  // paidMode ("guide" | "push" | null): текущий платный режим, если пользователь выбрал/подтвердил (включая платный период или после него)
  // trialState: объект с датой начала недели для платных режимов, либо null если не пробовал
  // trialOver: true если недельный тест для текущего режима закончился
  // trialActive: true если тест идёт

  // --- Local UI state
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [showModeScreen, setShowModeScreen] = useState(false);
  const [showAgreement, setShowAgreement] = useState<null | "guide" | "push">(null);
  const [showTrialOverPrompt, setShowTrialOverPrompt] = useState<null | "guide" | "push">(null);

  // Определяем состояние пробной недели
  const [trialState, setTrialState_] = useState<PaidTrialState | null>(null); // текущий trial
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
    // завершить trial
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
    // Trial завершён, continued true
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

  // Вычисляем, если пользователь находится в платном режиме, действует ли у него trial
  function isTrialActive(mode: "guide" | "push") {
    if (!trialState || trialState.mode !== mode) return false;
    if (trialState.finished) return false;
    const start = new Date(trialState.started);
    const now = new Date();
    // trial длится 7 полных суток
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

  // --- Multi-mode: Current "action" depends on appMode ---
  function initialActionKey(am: AppMode | null) {
    switch (am) {
      case "lite":
        return "stuck";
      case "guide":
        return "blocker";
      case "push":
        return "move";
      default:
        return "stuck";
    }
  }
  const [selectedAction, setSelectedAction] = useState<ActionKey>(initialActionKey(appMode));
  useEffect(() => {
    setSelectedAction(initialActionKey(appMode));
  }, [appMode]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const [nextStepUser, setNextStepUser] = useState(""); // stuck/minStep style
  const [confidence, setConfidence] = useState<number>(0);
  const [falsifier, setFalsifier] = useState("");
  const [minStep, setMinStep] = useState("");
  const [notDoing, setNotDoing] = useState("");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"today" | "journal">("today");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // --- ACTUAL MODE LOGIC ON SELECT ---
  useEffect(() => {
    const m = getStoredAppMode();
    setTrialState_(getTrialState());
    setShowAgreement(null);
    setShowTrialOverPrompt(null);

    // Если начался платный режим (guide/push)
    if (m === "guide" || m === "push") {
      // В режиме guide/push может быть активен trial, может быть завершён
      const trialCur = getTrialState();
      if (trialCur && trialCur.mode === m && trialCur.finished && !isPaidContinued(m)) {
        // test is over & не выбрал платить — покажем повторно триггер выбора
        setShowTrialOverPrompt(m);
        setAppMode("lite");
        setStoredAppMode("lite");
      } else if (trialCur && trialCur.mode === m && isTrialActive(m)) {
        setAppMode(m);
      } else if (trialCur && trialCur.mode === m && trialCur.continued) {
        setAppMode(m);
      } else if (!trialCur) {
        // нет trial — покажем договор
        setAppMode("lite"); // только после явного согласия
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
  }, [selectedAction, result]);

  const stats = getStats(entries);

  async function handleAnalyze() {
    if (!appMode) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const analysis = await analyzeDecision(input, appMode, selectedAction);
      setResult(analysis);

      let possibleLegacyMode: Mode | undefined;
      if (appMode === "lite") {
        if (selectedAction === "stuck") possibleLegacyMode = "stuck";
        else if (selectedAction === "doubt") possibleLegacyMode = "doubt";
        else if (selectedAction === "tired") possibleLegacyMode = "tired";
      }
      const newEntry: Entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        inputText: input,
        lens: CURRENT_LENS,
        output: {
          essence: analysis.essence ?? "",
          assumptions: analysis.assumptions ?? "",
          risks: analysis.risks ?? "",
          strategies: analysis.strategies ?? [],
          nextStep: analysis.nextStep ?? "",
        },
        aligns: null,
        done: null,
        appMode,
        actionKey: selectedAction,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Что-то пошло не так.");
    } finally {
      setLoading(false);
    }
  }

  const latestEntry =
    entries.length > 0 &&
    result &&
    entries[0]?.output?.essence === result.essence &&
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
    const modeActionStr = ((): string => {
      if (e.appMode && e.actionKey) {
        return (
          `${appModeLabels[e.appMode]} · ` +
          actionLabelFor(e.appMode, e.actionKey)
        );
      }
      if (e.mode) return e.mode;
      return "";
    })();

    const lines = [
      `Дата: ${dateLocalString(e.createdAt)}`,
      `Линза: ${e.lens}`,
      `Состояние: ${modeActionStr}`,
      `Ввод: ${e.inputText}`,
      "",
      `1) Суть:\n${e.output.essence}`,
      "",
      `2) Как это выглядит:\n${e.output.assumptions}`,
      "",
      `3) Что если так оставить:\n${e.output.risks}`,
      "",
      `4) Можно так:\n${e.output.strategies
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n")}`,
      "",
      `5) Можно попробовать:\n${e.output.nextStep}`,
    ];

    if ((e.mode === "stuck" || (e.appMode === "lite" && e.actionKey === "stuck")) && e.nextStepUser) {
      lines.push("", `Можно попробовать (≤30 минут): ${e.nextStepUser}`);
    }
    if ((e.mode === "doubt" || (e.appMode === "lite" && e.actionKey === "doubt"))) {
      if (typeof e.confidence === "number")
        lines.push(`Уверен (0–10): ${e.confidence}`);
      if (e.falsifier)
        lines.push(`Что поменяет мнение: ${e.falsifier}`);
    }
    if ((e.mode === "tired" || (e.appMode === "lite" && e.actionKey === "tired"))) {
      if (e.minStep)
        lines.push(`Минимум: ${e.minStep}`);
      if (e.notDoing)
        lines.push(`Сегодня не трогаю: ${e.notDoing}`);
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
    // agreement для "Держи курс" и "Подгоняй"
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
    // trial закончился — только при заходе в режим. Тон спокойный, две равнозначные опции
    const price = appModePrices[mode];
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 flex flex-col gap-8 items-center">
          <div className="w-full flex flex-col items-center text-center gap-2 mb-2">
            <span className="text-2xl">{appModeIcons[mode]}</span>
            <h1 className="text-xl font-semibold mb-1 mt-2">{appModeLabels[mode]}</h1>
            <span className="text-base text-gray-700 mt-2 mb-1">
              Мы договаривались на неделю.<br />
              Хочешь продолжить — или вернёмся к Поддержке?
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
              Вернуться к Поддержке
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- ЭКРАН ВЫБОРА РЕЖИМА ---
  function renderModeScreen() {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 flex flex-col gap-8 items-center">
          <div className="w-full flex flex-col items-center text-center gap-2 mb-2">
            <h1 className="text-2xl font-bold mb-1 mt-2">Как мне быть с тобой сейчас?</h1>
            <span className="text-sm text-gray-500 mt-0.5 mb-2">
              Это можно поменять в любой момент.
            </span>
          </div>
          <div className="flex flex-col gap-4 w-full">
            {(Object.keys(appModeLabels) as AppMode[]).map((mode) => (
              <button
                key={mode}
                className="w-full flex flex-row gap-3 items-center px-4 py-4 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 focus:outline-none transition group"
                onClick={() => {
                  // Если нажат платный режим — показываем договор, кроме случаев, когда test-режим уже действует (или продолжил)
                  if ((mode === "guide" || mode === "push")) {
                    // если user уже прошёл trial и не продолжил — предложим снова оплачивать только при желании
                    const trial = getTrialState();
                    if (trial && trial.mode === mode && !trial.continued && isTrialOver(mode)) {
                      setShowTrialOverPrompt(mode);
                    } else if (!trial || trial.mode !== mode) {
                      setShowAgreement(mode);
                    } else if (trial && trial.mode === mode && isTrialActive(mode)) {
                      setStoredAppMode(mode);
                      setAppMode(mode);
                      setShowModeScreen(false);
                      setShowAgreement(null);
                    } else if (trial && trial.mode === mode && trial.continued) {
                      setStoredAppMode(mode);
                      setAppMode(mode);
                      setShowModeScreen(false);
                      setShowAgreement(null);
                    } else {
                      setShowAgreement(mode);
                    }
                  } else {
                    setStoredAppMode(mode);
                    setAppMode(mode);
                    setShowModeScreen(false);
                    setShowAgreement(null);
                  }
                }}
                type="button"
              >
                <span className="text-2xl mr-1">{appModeIcons[mode]}</span>
                <span className="flex flex-col items-start">
                  <span className="text-base font-semibold text-gray-900">
                    {appModeLabels[mode]}
                  </span>
                  <span className="text-gray-500 text-xs mt-0.5">
                    {appModeDescriptions[mode]}
                  </span>
                  {/* Отображать цену только для платных */}
                  {appModePrices[mode] && (
                    <span className="text-amber-600 text-xs mt-1 ml-px">{appModePrices[mode]}</span>
                  )}
                  {/* Маркеры теста */}
                  {(mode === "guide" || mode === "push") && isTrialActive(mode) && (
                    <span className="inline-block text-emerald-600 text-xs mt-1 ml-px">
                        Неделя бесплатно
                    </span>
                  )}
                  {(mode === "guide" || mode === "push") && isPaidContinued(mode) && (
                    <span className="inline-block text-gray-400 text-xs mt-1 ml-px">
                      Активен
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
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

  // --- UI ---
  function AppModeIndicator() {
    let ui = appModeLabels[appMode];
    let note: string | null = null;
    if ((appMode === "guide" || appMode === "push") && isTrialActive(appMode)) {
      note = "Неделя бесплатно";
    } else if ((appMode === "guide" || appMode === "push") && isPaidContinued(appMode)) {
      note = appModePrices[appMode] ? appModePrices[appMode]! : null;
    }
    return (
      <div className="absolute right-0 top-0 mt-4 mr-4 z-20 flex items-center gap-2">
        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-lg">
          {`Режим: ${ui}`}{note ? ` · ${note}` : ""}
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
            <h1 className="text-2xl font-bold mb-2">Thinkclear</h1>
            <p className="text-gray-600 mb-6">
              Здесь можно выдохнуть и написать пару строк.
            </p>

            {/* Warm line depends on mode */}
            <div className="mb-3 mt-2">
              <div className="text-center text-[15px] text-teal-600 font-medium">{appModeWarmLine[appMode]}</div>
            </div>

            {/* Quick action + segmented controls */}
            <div className="flex flex-row gap-2 mb-4 select-none">
              {appModeActions[appMode].map((def) => (
                <button
                  key={def.key}
                  type="button"
                  className={
                    "flex-1 px-4 py-2 rounded-lg border text-xs font-medium transition-all " +
                    (selectedAction === def.key
                      ? "border-black bg-black text-white shadow"
                      : "border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100")
                  }
                  onClick={() => {
                    setSelectedAction(def.key);
                    setResult(null);
                    setInput("");
                  }}
                  disabled={loading}
                >
                  {def.label}
                </button>
              ))}
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={appModePrompt[appMode][selectedAction] || ""}
              className="w-full min-h-[140px] p-3 rounded-lg border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none resize-y mb-4"
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={
                loading ||
                input.trim().length < 2 ||
                !selectedAction ||
                !appMode
              }
              className="w-full py-3 rounded-lg bg-black text-white hover:bg-gray-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Пишу..." : "Посмотреть"}
            </button>
            {error && (
              <p className="mt-4 text-red-600 text-sm" role="alert">
                {error}
              </p>
            )}

            {result && latestEntry && (
              <div className="mt-8 pt-6 border-t border-gray-200 space-y-5">
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    1) Суть
                  </h2>
                  <p className="text-gray-800">{result.essence}</p>
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    2) Как это выглядит
                  </h2>
                  <p className="text-gray-800">{result.assumptions}</p>
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    3) Что если так оставить
                  </h2>
                  <p className="text-gray-800">{result.risks}</p>
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    4) Можно так
                  </h2>
                  <ul className="list-disc list-inside text-gray-800 space-y-1">
                    {result.strategies.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    5) Можно попробовать
                  </h2>
                  <p className="text-gray-800">{result.nextStep}</p>
                </section>

                {/* Fixation block (relevant only in lite mode with legacy action keys) */}
                <div className="border-t border-gray-100 pt-4 mt-4 space-y-4">
                  {(latestEntry?.mode === "stuck" || (latestEntry?.appMode === "lite" && latestEntry?.actionKey === "stuck")) && (
                    <div>
                      <label className="block font-medium text-sm text-gray-700 mb-1">
                        Можно попробовать (≤30 минут)
                      </label>
                      <input
                        type="text"
                        maxLength={120}
                        className="w-full p-2 rounded-md border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none"
                        placeholder="Если не хочется — не пиши"
                        value={
                          typeof latestEntry.nextStepUser === "string"
                            ? latestEntry.nextStepUser
                            : nextStepUser
                        }
                        onChange={(e) => {
                          setNextStepUser(e.target.value);
                          patchLatestEntry({ nextStepUser: e.target.value });
                        }}
                      />
                    </div>
                  )}

                  {(latestEntry?.mode === "doubt" || (latestEntry?.appMode === "lite" && latestEntry?.actionKey === "doubt")) && (
                    <div>
                      <div className="mb-3">
                        <label className="block font-medium text-sm text-gray-700 mb-1">
                          Насколько уверен
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={1}
                            value={
                              typeof latestEntry.confidence === "number"
                                ? latestEntry.confidence
                                : confidence
                            }
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setConfidence(n);
                              patchLatestEntry({ confidence: n });
                            }}
                            className="w-full"
                          />
                          <div className="w-10 text-center text-xs text-gray-700">
                            {typeof latestEntry.confidence === "number"
                              ? latestEntry.confidence
                              : confidence}
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium text-sm text-gray-700 mb-1">
                          Что поменяет мнение
                        </label>
                        <input
                          type="text"
                          maxLength={150}
                          className="w-full p-2 rounded-md border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none"
                          placeholder="Можно не отвечать"
                          value={
                            typeof latestEntry.falsifier === "string"
                              ? latestEntry.falsifier
                              : falsifier
                          }
                          onChange={(e) => {
                            setFalsifier(e.target.value);
                            patchLatestEntry({ falsifier: e.target.value });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {(latestEntry?.mode === "tired" || (latestEntry?.appMode === "lite" && latestEntry?.actionKey === "tired")) && (
                    <div>
                      <div className="mb-3">
                        <label className="block font-medium text-sm text-gray-700 mb-1">
                          Минимум (2–10 минут)
                        </label>
                        <input
                          type="text"
                          maxLength={70}
                          className="w-full p-2 rounded-md border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none"
                          placeholder="Если не хочется — не пиши"
                          value={
                            typeof latestEntry.minStep === "string"
                              ? latestEntry.minStep
                              : minStep
                          }
                          onChange={(e) => {
                            setMinStep(e.target.value);
                            patchLatestEntry({ minStep: e.target.value });
                          }}
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-sm text-gray-700 mb-1">
                          Сегодня не трогаю
                        </label>
                        <input
                          type="text"
                          maxLength={70}
                          className="w-full p-2 rounded-md border border-gray-300 focus:border-black focus:ring-1 focus:ring-black outline-none"
                          placeholder="Можно оставить на потом"
                          value={
                            typeof latestEntry.notDoing === "string"
                              ? latestEntry.notDoing
                              : notDoing
                          }
                          onChange={(e) => {
                            setNotDoing(e.target.value);
                            patchLatestEntry({ notDoing: e.target.value });
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Additional block for aligns and done */}
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
                  {/* Compact header */}
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer select-none"
                    onClick={() => toggleExpand(e.id)}
                  >
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-gray-400">{dateLocalString(e.createdAt)}</span>
                      <span className="inline-block text-xs text-gray-500 font-medium">{e.lens}</span>
                      {e.appMode && e.actionKey && (
                        <Badge label={`${appModeLabels[e.appMode]} · ${actionLabelFor(e.appMode, e.actionKey)}`} type="mode" />
                      )}
                      {!e.appMode && e.mode && (
                        <Badge label={e.mode} type="mode" />
                      )}
                      <span className="inline-block text-gray-900 font-medium text-sm truncate max-w-[18ch] align-middle">
                        {e.output.essence.replace(/\s*\n.*/g, "")}
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
                      <section className="mb-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">
                          1) Суть
                        </h2>
                        <p className="text-gray-800 whitespace-pre-line">{e.output.essence}</p>
                      </section>
                      <section className="mb-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          2) Как это выглядит
                        </h2>
                        <p className="text-gray-800 whitespace-pre-line">{e.output.assumptions}</p>
                      </section>
                      <section className="mb-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          3) Что если так оставить
                        </h2>
                        <p className="text-gray-800 whitespace-pre-line">{e.output.risks}</p>
                      </section>
                      <section className="mb-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          4) Можно так
                        </h2>
                        <ul className="list-decimal list-inside text-gray-800 space-y-0.5">
                          {e.output.strategies.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </section>
                      <section className="mb-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          5) Можно попробовать
                        </h2>
                        <p className="text-gray-800 whitespace-pre-line">{e.output.nextStep}</p>
                      </section>
                      {(e.mode === "stuck" || (e.appMode === "lite" && e.actionKey === "stuck")) && e.nextStepUser && (
                        <div className="mb-3">
                          <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
                            Можно попробовать (≤30 минут)
                          </h3>
                          <p className="text-gray-800 whitespace-pre-line">{e.nextStepUser}</p>
                        </div>
                      )}
                      {(e.mode === "doubt" || (e.appMode === "lite" && e.actionKey === "doubt")) && (typeof e.confidence === "number" || e.falsifier) && (
                        <div className="mb-3">
                          <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
                            Насколько уверен и что влияет
                          </h3>
                          {typeof e.confidence === "number" && (
                            <div className="text-gray-800 mb-1">Уверен: {e.confidence}/10</div>
                          )}
                          {e.falsifier && (
                            <div className="text-gray-800">Что поменяет мнение: {e.falsifier}</div>
                          )}
                        </div>
                      )}
                      {(e.mode === "tired" || (e.appMode === "lite" && e.actionKey === "tired")) && (e.minStep || e.notDoing) && (
                        <div className="mb-3">
                          <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">
                            Минимум и на потом
                          </h3>
                          {e.minStep && (
                            <div className="text-gray-800">Минимум: {e.minStep}</div>
                          )}
                          {e.notDoing && (
                            <div className="text-gray-800">Не трогаю: {e.notDoing}</div>
                          )}
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