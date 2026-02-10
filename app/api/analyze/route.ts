import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// --- PROMPT DEFINITIONS ---
// Все допустимые title и номера блоков по режимам:
const MODE_BLOCKS = {
  lite: [
    "СЕЙЧАС",
    "МОЖНО",
    "НЕ ДЕЛАЙ",
  ],
  guide: [
    "ФАКТ",
    "УЗКОЕ МЕСТО",
    "СЛЕДУЮЩИЙ ШАГ (≤30 МИНУТ)",
    "СДЕЛАНО, ЕСЛИ",
  ],
  push: [
    "САМООБМАН",
    "ЦЕНА",
    "ДЕЛАЙ СЕГОДНЯ (≤30 МИНУТ)",
  ],
} as const;

// Новый базовый промпт + спец-ограничения на служебные слова и структуры
const BASE_PROMPT = `
Ты — диалоговый ассистент.

Соблюдай строгое форматирование как валидный JSON-объект согласно структуре: 
{
  kind: "answer" | "question",
  blocks: [{ title: string, text: string }] | undefined,
  text: string | undefined,
  nextStep?: string
}

ВАЖНО!
— Заголовки блоков ("title") допускаются только из списка для данного режима (см. ниже), и только в правильном порядке.
— Запрещены любые другие заголовки (например: "КОРОТКО", "ВОПРОС", "ОТВЕТ", "СЕЙЧАС:" и т.д.).
— Запрещено писать слова: коротко, вопрос, факт, самообман, цена, сейчас, следующий шаг, сделано если, можно, не делай — отдельными строками, в title, в качестве меток, а также включать другие служебные слова как заголовки.
— Не добавляй никаких других блоков и не меняй число блоков (см. для режима).
— Не выводи технических меток, структур, пояснений, списков.
— Один ответ = одно сообщение.
— Максимум один вопрос в ответе.
— Не повторяй слова пользователя.
— Если пользователь отвечает «не знаю», сужай выбор до двух вариантов, следуй общей структуре.
— Всегда строго валидируй JSON-формат и только правильные ключи.

Режимы и допустимые заголовки блоков:

[Лучший друг] (lite): только 3 блока c указанными заголовками по порядку:
1. СЕЙЧАС
2. МОЖНО
3. НЕ ДЕЛАЙ

[Старший брат] (guide): только 4 блока по порядку:
1. ФАКТ
2. УЗКОЕ МЕСТО
3. СЛЕДУЮЩИЙ ШАГ (≤30 МИНУТ)
4. СДЕЛАНО, ЕСЛИ

[Достигатор] (push): только 3 блока и только строго такие заголовки по порядку:
1. САМООБМАН
2. ЦЕНА
3. ДЕЛАЙ СЕГОДНЯ (≤30 МИНУТ)

Если хоть одно служебное слово появляется не по месту — это ошибка. 
Если структура нарушена — ошибка.
Никогда не добавляй вывод типа "КОРОТКО", "ВОПРОС", "ОТВЕТ" и не объясняй структуру.

Пиши только чистый JSON, ничего лишнего.
`;

function getPromptByMode(
  mode: "lite" | "guide" | "push",
  previousKind?: "question" | "answer",
  consecutiveUncertain?: number
): string {
  let description = "";

  if (mode === "lite") {
    description = `
Режим: Лучший друг.
Пиши тепло, спокойно, мягко, дружески. Не дави и не заставляй, помоги человеку понять себя, поддержи. Один мягкий вопрос допустим, но только если уместно. Не повторяй слова пользователя.
Только три блока, только с этими заголовками по порядку: СЕЙЧАС, МОЖНО, НЕ ДЕЛАЙ.
`;
  } else if (mode === "guide") {
    description = `
Режим: Старший брат.
Пиши прямым тоном, но без нажима. Помоги человеку выбрать направление или сузить выбор — задай один уточняющий вопрос. Не повторяй слова пользователя. Не используй агрессию.
Если дважды подряд "не знаю" — предложи два варианта выбора.
Только четыре блока, только с этими заголовками по порядку: ФАКТ, УЗКОЕ МЕСТО, СЛЕДУЮЩИЙ ШАГ (≤30 МИНУТ), СДЕЛАНО, ЕСЛИ.
    `;
  } else if (mode === "push") {
    description = `
Режим: Достигатор.
Пиши очень кратко, жёстко, не теряя человечности, всегда веди к простому конкретному действию, без лишних объяснений. Обращайся прямо, всегда к делу.
Если дважды подряд "не знаю" — предложи два варианта выбора.
Только три блока, только с этими заголовками по порядку: САМООБМАН, ЦЕНА, ДЕЛАЙ СЕГОДНЯ (≤30 МИНУТ).
`;
  } else {
    description = "";
  }

  // Динамические ограничения на количество вопросов
  let restriction = "";
  if (
    typeof consecutiveUncertain === "number" &&
    consecutiveUncertain >= 2
  ) {
    restriction = "Пользователь уже дважды ответил уклончиво или 'не знаю' — предложи ровно два варианта. Без дополнительных вопросов или объяснений.";
  } else if (previousKind === "question") {
    restriction = "В прошлом сообщении уже был вопрос, в этом просто поддержи или побуди к действию (без вопроса).";
  }

  return (
    BASE_PROMPT.trim() +
    "\n\n" +
    description.trim() +
    (restriction ? "\n" + restriction : "")
  );
}

function getModeFromBody(body: any): "lite" | "guide" | "push" {
  const raw = body?.appMode || body?.mode;
  if (raw === "lite" || raw === "guide" || raw === "push") return raw;
  return "guide";
}

function getMaxTokens(mode: "lite" | "guide" | "push"): number {
  if (mode === "lite") return 80;
  if (mode === "guide") return 120;
  if (mode === "push") return 140;
  return 120;
}

type AnalyzeBody = {
  text?: string;
  input?: string;
  mode?: "lite" | "guide" | "push" | string;
  actionLabel?: string;
  actionKey?: string;
  appMode?: "lite" | "guide" | "push" | string;
  previousKind?: "question" | "answer";
  consecutiveUncertain?: number;
};

// --- SANITIZER ВЕРСИЯ ---
// Возвращает нормализованный ответ или текст для fallback явных ошибок структуры.
function sanitizeOpenAIResponse(parsedResult: any, mode: "lite" | "guide" | "push") {
  // Если kind == question: оставляем только text (string, <=120)
  if (parsedResult && parsedResult.kind === "question") {
    let text = typeof parsedResult.text === "string" ? parsedResult.text.trim() : "";
    if (text.length > 120) text = text.slice(0, 120).trim();
    return { kind: "question", text };
  }
  // Если kind == answer: blocks нормализовать, nextStep - по правилам
  if (parsedResult && parsedResult.kind === "answer") {
    const wanted_titles = MODE_BLOCKS[mode];
    let blocks: { title: string; text: string }[] = [];
    if (Array.isArray(parsedResult.blocks)) {
      blocks = parsedResult.blocks.slice(0, wanted_titles.length).map((block: any, idx: number) => ({
        title: wanted_titles[idx],
        text: typeof block?.text === "string" ? block.text : "",
      }));
    }
    // Дополняем, если не хватает блоков, пустыми text
    while (blocks.length < wanted_titles.length) {
      blocks.push({ title: wanted_titles[blocks.length], text: "" });
    }

    // Удаляем любые доп. поля внутри block (оставляем только title, text)
    blocks = blocks.map((b) => ({ title: b.title, text: b.text }));

    // nextStep
    let nextStep: string | undefined;
    if (mode === "lite") {
      nextStep = undefined;
    } else if (mode === "guide" || mode === "push") {
      const rawNextStep = parsedResult?.nextStep;
      if (typeof rawNextStep === "string" && rawNextStep.trim().length > 0 && rawNextStep.trim().length <= 140) {
        nextStep = rawNextStep.trim();
      }
    }
    const sanitized: any = {
      kind: "answer",
      blocks,
    };
    if (nextStep) sanitized.nextStep = nextStep;
    return sanitized;
  }
  // Fallback: пробуем отдать text, иначе короткий fallback
  if (typeof parsedResult?.text === "string") {
    return { text: parsedResult.text };
  }
  return { text: "Ответ не распознан. Попробуйте переформулировать." };
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    let body: AnalyzeBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const input = typeof body?.input === "string" ? body.input.trim() : "";
    const content = text || input;

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Missing or empty input" },
        { status: 400 }
      );
    }

    const mode = getModeFromBody(body);
    const previousKind = body?.previousKind;
    const consecutiveUncertain = typeof body?.consecutiveUncertain === "number" ? body.consecutiveUncertain : undefined;

    const userMessage = content;

    const systemPrompt = getPromptByMode(mode, previousKind, consecutiveUncertain);

    const max_tokens = getMaxTokens(mode);

    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" }, // Всегда только JSON!
        temperature: 0.2,
        max_tokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: errText || `OpenAI API error: ${res.status}` },
        { status: 502 }
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch (jsonErr) {
      return NextResponse.json({
        text: "Не удалось сформировать ответ. Попробуйте позже.",
      }, { status: 502 });
    }

    // main: получили JSON в message.content (по response_format: json_object)
    let responseContent: string | undefined = data?.choices?.[0]?.message?.content;

    // fallback: бывает payload уже как объет
    if (typeof responseContent !== "string") {
      if (typeof data?.choices?.[0]?.message?.content === "object") {
        responseContent = JSON.stringify(data?.choices?.[0]?.message?.content);
      } else if (typeof data === "string") {
        responseContent = data;
      } else {
        return NextResponse.json({
          text: "Не удалось получить результат. Попробуйте еще раз.",
        }, { status: 502 });
      }
    }

    // Проверка на запрещённые слова (case insensitive, в любом регистре, даже если слито)
    const forbidden = [
      "коротко",
      "вопрос",
      "факт",
      "самообман",
      "цена",
      "сейчас",
      "следующий шаг",
      "сделано если",
      "можно",
      "не делай"
    ];

    // NB: здесь строка может быть JSON
    const lowerResponse = responseContent.toLocaleLowerCase("ru-RU");
    for (const word of forbidden) {
      if (lowerResponse.includes(word.replace(/\s+/g, '').toLowerCase())) {
        return NextResponse.json({
          text: "Ответ содержит запрещённые слова. Попробуйте ещё раз.",
          error: "forbidden_words_detected"
        }, { status: 200 });
      }
    }

    // Попытка парсить и отдать "санитайзер"
    let sanitizedToSend: any = undefined;
    let parsed: any;
    if (
      responseContent.trim().startsWith("{") &&
      responseContent.trim().endsWith("}")
    ) {
      try {
        parsed = JSON.parse(responseContent.trim());
        sanitizedToSend = sanitizeOpenAIResponse(parsed, mode);
        // дополнительная server-side очистка - удаляем мусорные ключи
        if (sanitizedToSend && typeof sanitizedToSend === "object") {
          // Обрезаем "text" в question, оставляем только нужные ключи
          if (sanitizedToSend.kind === "question") {
            return NextResponse.json(
              { kind: "question", text: sanitizedToSend.text },
              { status: 200 }
            );
          }
          // answer — строго blocks (c доп. nextStep если нужно)
          if (sanitizedToSend.kind === "answer") {
            const responseObj: any = {
              kind: "answer",
              blocks: sanitizedToSend.blocks,
            };
            if (sanitizedToSend.nextStep) {
              responseObj.nextStep = sanitizedToSend.nextStep;
            }
            return NextResponse.json(responseObj, { status: 200 });
          }
        }
        // Если не распознано, отправим text raw.
        let fallbackText = "Ответ не распознан. Попробуйте переформулировать.";
        if (typeof sanitizedToSend?.text === "string") fallbackText = sanitizedToSend.text;
        return NextResponse.json({ text: fallbackText }, { status: 200 });
      } catch {
        // invalid json — падать на fallback ниже (ответ "text")
      }
    }

    // основной fallback путь — если ничего не распознали, возвращаем только текст
    return NextResponse.json({ text: responseContent.trim() }, { status: 200 });

  } catch (err: any) {
    console.error("[/api/analyze]", err);
    return NextResponse.json({
      text: "Внутренняя ошибка сервера. Попробуйте позднее.",
    }, { status: 500 });
  }
}
