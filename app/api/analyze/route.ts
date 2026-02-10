import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Новый промпт согласно инструкциям (исключает любые метки, структуры и запрещённые слова)
const BASE_PROMPT = `
Ты — диалоговый ассистент.

Запрещено выводить любые служебные слова, метки или структуру ответа.

Ни при каких условиях не используй и не выводи слова:
коротко, вопрос, факт, самообман, цена, сейчас, следующий шаг, сделано если, можно, не делай.

Пользователь должен видеть только живую человеческую речь.

Правила:
- Один ответ = одно сообщение.
- Максимум один вопрос в ответе.
- Запрещены списки и заголовки, не объясняй что делаешь.
- Не повторяй слова пользователя.
- Если пользователь отвечает «не знаю» — сужай выбор до двух вариантов.

Режимы:

[Лучший друг]
- Тёплый, спокойный, без давления.
- Помогает прояснить состояние.

[Старший брат]
- Прямой, без агрессии.
- Помогает выбрать направление, задаёт уточняющий вопрос.

[Достигатор]
- Жёстко и по делу, минимум слов.
- Всегда приводит к конкретному действию.

Если хоть одно запрещённое слово попадает в ответ — это ошибка.
Всегда пиши только как живой человек, ни намёка на внутренние метки или структуру.
`;

// Функция для выбора режима промпта
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
`;
  } else if (mode === "guide") {
    description = `
Режим: Старший брат.
Пиши прямым тоном, но без нажима. Помоги человеку выбрать направление или сузить выбор — задай один уточняющий вопрос. Не повторяй слова пользователя. Не используй агрессию.
Если дважды подряд "не знаю" — предложи два варианта выбора.
      `;
  } else if (mode === "push") {
    description = `
Режим: Достигатор.
Пиши очень кратко, жёстко, не теряя человечности, всегда веди к простому конкретному действию, без лишних объяснений. Обращайся прямо, всегда к делу.
Если дважды подряд "не знаю" — предложи два варианта выбора.
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
        response_format: { type: "text" }, // Ожидаем просто живую человеческую речь
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

    // Text-only response (без всяких структур)
    let responseContent: string | undefined = data?.choices?.[0]?.message?.content;

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

    const lowerResponse = responseContent.toLocaleLowerCase("ru-RU");
    for (const word of forbidden) {
      if (lowerResponse.includes(word.replace(/\s+/g, '').toLowerCase())) {
        return NextResponse.json({
          text: "Ответ содержит запрещённые слова. Попробуйте ещё раз.",
          error: "forbidden_words_detected"
        }, { status: 200 });
      }
    }

    // Удаляем структурные json, если вдруг встретился (может быть, если OpenAI продолжит отдавать json)
    if (
      responseContent.trim().startsWith("{") &&
      responseContent.trim().endsWith("}")
    ) {
      let fallbackText = "Ответ не распознан. Попробуйте переформулировать.";
      try {
        const parsed = JSON.parse(responseContent.trim());
        if (typeof parsed.text === "string") fallbackText = parsed.text;
      } catch {
        // ignore
      }
      return NextResponse.json({ text: fallbackText }, { status: 200 });
    }

    // основной путь: возвращаем просто человеческий ответ
    return NextResponse.json({ text: responseContent.trim() }, { status: 200 });

  } catch (err: any) {
    console.error("[/api/analyze]", err);
    return NextResponse.json({
      text: "Внутренняя ошибка сервера. Попробуйте позднее.",
    }, { status: 500 });
  }
}
