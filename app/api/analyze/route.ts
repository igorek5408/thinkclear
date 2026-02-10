import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// --- PROMPT DEFINITIONS ---
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

  let restriction = "";
  if (
    typeof consecutiveUncertain === "number" &&
    consecutiveUncertain >= 2
  ) {
    restriction = "Пользователь уже дважды ответил уклончиво или 'не знаю' — предложи ровно два варианта. Без дополнительных вопросов или объяснений.";
  } else if (previousKind === "question") {
    restriction = "В прошлом сообщении уже был вопрос, в этом просто поддержи или побуди к действию (без вопроса).";
  }

  // Добавляем явную инструкцию про json для OpenAI (см. требования)
  return (
    BASE_PROMPT.trim() +
    "\n\n" +
    description.trim() +
    (restriction ? "\n" + restriction : "") +
    "\nReturn ONLY valid json."
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
    // Очищаем до только title/text
    blocks = blocks.map((b) => ({ title: b.title, text: b.text }));

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
  return null;
}

// Fallback-ответ для любых аварийных ситуаций, всегда формат kind/blocks стандартный для фронта
function fallbackAnswer(
  text: string = "Техническая ошибка. Попробуй ещё раз.",
  status: number = 200
) {
  return NextResponse.json(
    {
      kind: "answer",
      blocks: [{ title: "Ответ", text }],
    },
    { status }
  );
}

function fallbackQuestion(
  text: string = "Техническая ошибка. Попробуй ещё раз.",
  status: number = 200
) {
  return NextResponse.json(
    {
      kind: "question",
      text,
    },
    { status }
  );
}

// Валидация результата после разбора JSON
function isValidThinkclearAnswer(obj: any, mode: "lite" | "guide" | "push"): boolean {
  if (!obj) return false;
  if (obj.kind === "question" && typeof obj.text === "string") return true;
  if (obj.kind === "answer" && Array.isArray(obj.blocks)) {
    const wanted_titles = MODE_BLOCKS[mode];
    if (obj.blocks.length !== wanted_titles.length) return false;
    for (let i = 0; i < wanted_titles.length; ++i) {
      if (obj.blocks[i].title !== wanted_titles[i]) return false;
      if (typeof obj.blocks[i].text !== "string") return false;
    }
    // nextStep необязательный, text необязательный
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 500);
    }

    let body: AnalyzeBody;
    try {
      body = await request.json();
    } catch {
      return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 400);
    }

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const input = typeof body?.input === "string" ? body.input.trim() : "";
    const content = text || input;

    if (typeof content !== "string" || !content) {
      return fallbackAnswer("Пустой или некорректный ввод. Попробуй ещё раз.", 400);
    }

    const mode = getModeFromBody(body);
    const previousKind = body?.previousKind;
    const consecutiveUncertain = typeof body?.consecutiveUncertain === "number" ? body.consecutiveUncertain : undefined;
    const userMessage = content;

    const systemPrompt = getPromptByMode(mode, previousKind, consecutiveUncertain);

    const max_tokens = getMaxTokens(mode);

    let res;
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
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens,
        }),
      });
    } catch (_err) {
      // fetch сломан — OpenAI недоступен
      return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 502);
    }

    if (!res.ok) {
      // Не возвращаем raw текст ошибок OpenAI, только fallback
      return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 502);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      // OpenAI не вернул json
      return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 502);
    }

    // main: получили JSON в message.content (по response_format: json_object)
    let responseContent: string | undefined = data?.choices?.[0]?.message?.content;

    // fallback: бывает payload уже как объект
    if (typeof responseContent !== "string") {
      if (typeof data?.choices?.[0]?.message?.content === "object") {
        responseContent = JSON.stringify(data?.choices?.[0]?.message?.content);
      } else if (typeof data === "string") {
        responseContent = data;
      } else {
        return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 502);
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

    const lowerResponse = responseContent.toLocaleLowerCase("ru-RU");
    for (const word of forbidden) {
      if (lowerResponse.includes(word.replace(/\s+/g, '').toLowerCase())) {
        // Fallback с сообщением об ошибке, но формат корректный
        return fallbackAnswer("Ответ содержит запрещённые слова. Попробуй ещё раз.", 200);
      }
    }

    // Попытка парсить и вернуть строго валидную структуру
    let parsed: any;
    if (
      responseContent.trim().startsWith("{") &&
      responseContent.trim().endsWith("}")
    ) {
      try {
        parsed = JSON.parse(responseContent.trim());
        // Усиленная валидация контракта
        if (isValidThinkclearAnswer(parsed, mode)) {
          if (parsed.kind === "question") {
            // Возвращаем только question в своём формате
            return NextResponse.json(
              { kind: "question", text: typeof parsed.text === "string" ? parsed.text : "" },
              { status: 200 }
            );
          }
          if (parsed.kind === "answer") {
            const answerObj: any = {
              kind: "answer",
              blocks: parsed.blocks,
            };
            if (parsed.nextStep) answerObj.nextStep = parsed.nextStep;
            return NextResponse.json(answerObj, { status: 200 });
          }
        }
        // Если невалидно — санитайзер, fallback если всё равно невалидно
        const sanitized = sanitizeOpenAIResponse(parsed, mode);
        if (sanitized && isValidThinkclearAnswer(sanitized, mode)) {
          if (sanitized.kind === "question")
            return NextResponse.json({ kind: "question", text: sanitized.text }, { status: 200 });
          if (sanitized.kind === "answer")
            return NextResponse.json(
              sanitized.nextStep
                ? { kind: "answer", blocks: sanitized.blocks, nextStep: sanitized.nextStep }
                : { kind: "answer", blocks: sanitized.blocks },
              { status: 200 }
            );
        }
        // Как бы ни парсили — в случае невалидности: только корректный fallback-answer
        return fallbackAnswer("Ответ не распознан. Попробуйте переформулировать.", 200);
      } catch {
        // invalid json — падать на fallback ниже
      }
    }

    // основной fallback путь — если ничего не распознали или ответ не JSON, возвращаем только в правильном answer-формате
    return fallbackAnswer(responseContent.trim(), 200);

  } catch (err: any) {
    console.error("[/api/analyze]", err);
    return fallbackAnswer("Техническая ошибка. Попробуй ещё раз.", 500);
  }
}
