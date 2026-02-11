import { NextResponse } from "next/server";

// --- CONTRACT TYPES & CONSTANTS ---

type AppMode = "lite" | "guide" | "push";

export type Contract = {
  maxWords: number;
  maxQuestions: number;
  allowAction: boolean;
  allowDeadline: boolean;
  empathyLevel: number; // 0..10
};

export const MODE_CONTRACTS: Record<AppMode, Contract> = {
  lite: {
    maxWords: 150,
    maxQuestions: 1,
    allowAction: false,
    allowDeadline: false,
    empathyLevel: 9,
  },
  guide: {
    maxWords: 260,
    maxQuestions: 1,
    allowAction: true,
    allowDeadline: false,
    empathyLevel: 6,
  },
  push: {
    maxWords: 200,
    maxQuestions: 0,
    allowAction: true,
    allowDeadline: true,
    empathyLevel: 2,
  },
};

// Desired server return shape:
export type StructuredResponse = {
  kind: "answer" | "question";
  blocks: { title: string; text: string }[];
  nextStep?: string;
};


const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

type AnalyzeBody = {
  text?: string;
  input?: string;
  mode?: AppMode | string;
  appMode?: AppMode | string;
  actionKey?: string;
  actionLabel?: string;
  previousKind?: "question" | "answer";
  consecutiveUncertain?: number;
};

type ModelJson = {
  text?: unknown;
  next?: unknown;
};

type ApiResponseShape = {
  text: string;
  next: string | null;
};

function getModeFromBody(body: AnalyzeBody): AppMode {
  const raw = body.appMode ?? body.mode;
  if (raw === "lite" || raw === "guide" || raw === "push") return raw;
  return "guide";
}

function buildSystemPrompt(mode: AppMode): string {
  const base = [
    "Ты — диалоговый ассистент Thinkclear.",
    "Цель: меньше тревоги и больше ясности в следующем шаге.",
    "Говори по-человечески, без канцелярита и без оценок. Не используй формулировки вроде «пользователь находится…» — обращайся напрямую.",
    "Всегда отвечай в json. Только валидный json без текста вокруг.",
    "Строгий формат JSON-ответа:",
    "{",
    '  "text": "коротко, по-человечески, 1–2 предложения",',
    '  "next": "один вопрос (если нужен) ИЛИ null"',
    "}",
    "Ключи только text и next. Никаких полей kind/blocks/ФАКТ/ВОПРОС/ОТВЕТ.",
    "Return ONLY valid JSON.",
  ].join("\n");

  if (mode === "lite") {
    const lite = [
      "Режим: Лучший друг (lite).",
      "Разрешено: отражение ситуации + нормализация + 1 мягкий вопрос в next (если уместно). Длина короткая.",
      "Запрещено: советы, планы, «сделай/попробуй/может стоит», «например», любые варианты действий.",
      "Никаких инструкций, никаких шагов. Только теплое отражение и, при необходимости, один вопрос. Если вопрос не нужен — next = null.",
    ].join("\n");
    return `${base}\n\n${lite}`;
  }

  if (mode === "guide") {
    const guide = [
      "Режим: Старший брат (guide).",
      "Структура: «Что вижу» → «Направление» → 1 вопрос (если неясно).",
      "Разрешено: ровно 1 направление или 1 шаг. Без перечня альтернатив.",
      "Запрещено: «посмотри фильм», «почитай», «просто отдохни» как универсальные заглушки. Запрещены списки вариантов.",
      "Максимум 1 вопрос в next. Если направление ясно — next = null.",
    ].join("\n");
    return `${base}\n\n${guide}`;
  }

  const push = [
    "Режим: Достигатор (push).",
    "Обязательно: 1 конкретное действие + дедлайн + требование отчёта (ответь: сделал/нет). Вопросов 0. next = null почти всегда.",
    "Запрещено: эмпатия-успокоение («всё ок», «можно расслабиться»), уговоры («может», «попробуй»), альтернативы («или», «например», «тогда сделай другое»).",
    "Если пользователь пишет «не хочу/не буду/не знаю»: НЕ предлагай альтернативы. Фиксируй сопротивление нейтрально и всё равно дай 1 обязательное микро-действие на 2–10 минут + требование отчёта.",
    "text = императив (глагол в начале), дедлайн внутри, конец — «Ответь: сделал/нет.»",
    "Никаких вопросов. Без уговоров.",
  ].join("\n");
  return `${base}\n\n${push}`;
}

function safeFallback(message: string): ApiResponseShape {
  return {
    text: message,
    next: null,
  };
}

// --- ENFORCEMENT: post-process text by mode ---

const PUSH_FORBIDDEN = [
  "может",
  "попробуй",
  "давай",
  "хочешь",
  "если",
  "хорошо, тогда",
  "например",
  "можно",
  "стоит",
];

const LITE_ADVICE_PATTERNS =
  /[^.!?]*(сделай|попробуй|нужно|надо|давай|стоит|например)[^.!?]*[.!?]/gi;

function enforcePush(text: string): string {
  let t = text.trim();
  // Remove persuasion words (whole-word match, case-insensitive)
  for (const w of PUSH_FORBIDDEN) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    t = t.replace(re, "").replace(/\s+/g, " ").trim();
  }
  // Remove "или" alternatives — keep first part
  const orIdx = t.search(/\sили\s/i);
  if (orIdx > 0) t = t.slice(0, orIdx).trim();
  // Remove 1)/2) style lists — keep content, drop list structure
  t = t.replace(/\s*\d+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  // Split by sentences; if multiple action sentences, keep first
  const sentences = t.match(/[^.!?]+[.!?]?/g) || [t];
  const actionVerbs = /\b(открой|напиши|сделай|поставь|отправь|заполни|позвони|отметь|создай|зайди)\b/i;
  let firstActionIdx = -1;
  let secondActionIdx = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (actionVerbs.test(sentences[i]!)) {
      if (firstActionIdx < 0) firstActionIdx = i;
      else if (secondActionIdx < 0) secondActionIdx = i;
    }
  }
  if (secondActionIdx >= 0) {
    t = sentences.slice(0, secondActionIdx).join(" ").trim();
  }
  // Ensure has deadline and report
  const hasDeadline = /\d+\s*(минут|час|сек)/i.test(t);
  const hasReport = /ответь.*сделал|сделал.*нет/i.test(t);
  t = t.replace(/[.!?]+$/, "").trim();
  if (t.length > 0) {
    if (!hasDeadline) t += " За 5 минут.";
    if (!hasReport) t += " Ответь: сделал/нет.";
  }
  return t.replace(/\s+/g, " ").trim();
}

function enforceLite(text: string): string {
  // Remove advice sentences
  let t = text.replace(LITE_ADVICE_PATTERNS, "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 3) {
    return "Вижу, что тебе сейчас нелегко. Как ощущаешь себя?";
  }
  return t;
}

function enforceGuide(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const actionRegex =
    /\b(сделай|напиши|открой|позвони|отправь|выбери|начни|заверши)\b/i;
  let foundFirst = false;
  const kept: string[] = [];
  for (const s of sentences) {
    if (actionRegex.test(s)) {
      if (foundFirst) continue;
      foundFirst = true;
    }
    kept.push(s);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim() || text;
}

function enforceResponse(
  text: string,
  next: string | null,
  mode: AppMode
): ApiResponseShape {
  const contract = MODE_CONTRACTS[mode];
  let outText = text;
  let outNext = next;

  if (mode === "push") {
    outText = enforcePush(outText);
    outNext = null;
  } else if (mode === "lite" && !contract.allowAction) {
    outText = enforceLite(outText);
    if (outNext && contract.maxQuestions < 1) outNext = null;
  } else if (mode === "guide") {
    outText = enforceGuide(outText);
  }

  return {
    text: outText || "Сбой ответа. Повтори ещё раз.",
    next: outNext,
  };
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    let body: AnalyzeBody;
    try {
      body = (await request.json()) as AnalyzeBody;
    } catch {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    const input = typeof body.input === "string" ? body.input.trim() : "";
    const content = text || input;

    if (!content) {
      return NextResponse.json(
        safeFallback("Сначала напиши пару слов о ситуации."),
        { status: 200 }
      );
    }

    const mode = getModeFromBody(body);
    const userMessage = content;

    const systemPrompt = buildSystemPrompt(mode);

    let res: Response;
    try {
      res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `User message:\n${userMessage}\n\nReturn ONLY valid JSON.`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });
    } catch {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    const choice = (data as any)?.choices?.[0]?.message?.content;
    let parsed: ModelJson | null = null;

    if (typeof choice === "string") {
      const trimmed = choice.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          parsed = JSON.parse(trimmed) as ModelJson;
        } catch {
          parsed = null;
        }
      }
    } else if (choice && typeof choice === "object") {
      parsed = choice as ModelJson;
    }

    if (!parsed || typeof parsed.text !== "string") {
      return NextResponse.json(
        safeFallback("Сбой ответа. Повтори ещё раз."),
        { status: 200 }
      );
    }

    const textOut = parsed.text.toString().trim();
    const nextRaw = parsed.next;
    const nextOut =
      typeof nextRaw === "string" && nextRaw.trim().length > 0
        ? nextRaw.trim()
        : null;

    const result = enforceResponse(textOut, nextOut, mode);

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[/api/analyze]", err);
    return NextResponse.json(
      safeFallback("Сбой ответа. Повтори ещё раз."),
      { status: 200 }
    );
  }
}
