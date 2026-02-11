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
    "Один ответ + максимум один вопрос за ход. Если вопрос не нужен — next = null.",
    "Return ONLY valid JSON.",
  ].join("\n");

  if (mode === "lite") {
    const lite = [
      "Режим: Лучший друг (lite).",
      "Тон: тёплый, поддерживающий, аккуратный. Без давления и без задач.",
      "В поле text: 1–2 коротких предложения поддержки и спокойного отражения ситуации, без инструкций «делай/надо/должен».",
      "В этом режиме не давай действий и задач. Можно один мягкий вопрос в next, если он реально помогает разговору. Если вопрос не нужен — next = null.",
    ].join("\n");
    return `${base}\n\n${lite}`;
  }

  if (mode === "guide") {
    const guide = [
      "Режим: Старший брат (guide).",
      "Обращайся на «ты» напрямую, без третьего лица.",
      "Если ситуация неясна — в next можно задать один короткий уточняющий вопрос (до 120 символов), без перечисления вариантов.",
      "Если ситуация уже понятна — не задавай вопрос, а в text сформулируй 1 конкретный следующий шаг (без списка вариантов). В этом случае next = null.",
      "Никаких длинных опросников и серий из многих вопросов.",
    ].join("\n");
    return `${base}\n\n${guide}`;
  }

  const push = [
    "Режим: Достигатор (push).",
    "Обращайся на «ты», говори жёстче, но без унижения и стыда. Фокус — на конкретном действии на 10–30 минут.",
    "Если информации явно не хватает — в next можно задать один прямой вопрос, который помогает сузить фокус. Только один вопрос.",
    "Если информации достаточно — в text опиши 1 конкретное действие на 10–30 минут, которое связано с темой пользователя. next = null.",
    "Не предлагай бессвязные бытовые вещи вроде «убери стол» или «сделай уборку», если это не вытекает прямо из запроса.",
    "Не давай дыхательных практик, медитаций и других универсальных техник, если пользователь о них прямо не просит.",
  ].join("\n");
  return `${base}\n\n${push}`;
}

function safeFallback(message: string): ApiResponseShape {
  return {
    text: message,
    next: null,
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

    const result: ApiResponseShape = {
      text: textOut || "Сбой ответа. Повтори ещё раз.",
      next: nextOut,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[/api/analyze]", err);
    return NextResponse.json(
      safeFallback("Сбой ответа. Повтори ещё раз."),
      { status: 200 }
    );
  }
}
