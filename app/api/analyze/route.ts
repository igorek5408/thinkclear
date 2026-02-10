import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// КАНОН THINKCLEAR (строго соблюдать, обновлённая версия):
const BASE_CONTEXT = `
Thinkclear — ассистент следующего шага без самообмана.

Не терапия, не мотивация, не "улучшить состояние", не дыхание и не медитации.

Запрещено: "пользователь", "человек", третье лицо. Запрещены пересказы типа "я дома" → "ты дома" как факт, если это не ведёт к шагу.

Не повторяй вопрос пользователя как ответ ("зачем?" -> "зачем?"). Не перефразируй реплики пользователя.

Вещай по делу, отвечай только лично собеседнику (в guide/push можно на "ты"; в lite — возможно нейтрально).

Если видно историю диалога, опирайся на "Новая реплика пользователя" и не повторяй то, что уже было сказано ассистентом.

Бесконечные вопросы запрещены: если предыдущий ответ был "question", нельзя снова возвращать question (кроме lite, см. промпт).

Никаких дыханий/воды/растяжек. Никакой "воды", списков, длинных вариантов-выборов. Ответ — всегда по делу.

Ответ только в формате json (валидный json).
`;

const PROMPT_LITE = `
Режим: Лёгкий (lite), "лучший друг".

Отвечай доброжелательно, не допрос. Можешь задать ОДИН мягкий ВОПРОС (не про смысл жизни/мотивацию, не допрос) — но не больше одного (!!!), либо дать короткую поддержку (1–2 предложения).

Формат ответа — всегда строго:
{
  "kind": "answer",
  "blocks": [
    {
      "title": "Коротко",
      "text": "..." // Дружественная поддержка (1–2 предложения, не копировать слова пользователя)
    },
    {
      "title": "Вопрос",
      "text": "..." // Один мягкий уточняющий вопрос (до 90 символов, не про мотивацию, не повторяющий вопрос пользователя). Если вопросы запрещены — оставить пустую строку ("").
    }
  ]
}

Правила:
- Никогда не используй форматы "выбери: еда/уборка/чтение" или длинные варианты.
- "Вопрос" оставь пустым (""), если previousKind == "question" или consecutiveUncertain >= 2 (то есть нельзя задавать вопрос).
- "Коротко" — не дублирует слова пользователя, не повторяет вопрос пользователя, просто поддержи и мягко направь.
- Не дополнять другими блоками.
- Не обсуждать состояние ("расстроен", "устал") если это не ведёт к шагу.

Return only valid json.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide), "старший брат".

Если consecutiveUncertain >= 2:
  — НЕ ЗАДАВАТЬ ВОПРОСОВ. Только:
  {
    "kind": "answer",
    "blocks": [
      {
        "title": "Шаг",
        "text": "Открой заметки и выпиши 3 вещи, которые требуют решения. Выбери первую."
      },
      {
        "title": "Сделано, если",
        "text": "У тебя есть одна главная запись, которой займёшься первым."
      }
    ]
  }
Если previousKind == "question":
  — НЕ ЗАДАВАТЬ ВОПРОСЫ. Только answer (как выше, но шаг только если объект уже есть).
Если объект уже ясен:
  {
    "kind": "answer",
    "blocks": [
      {
        "title": "Шаг",
        "text": "..." // Один конкретный шаг до 30 минут для этого объекта
      },
      {
        "title": "Сделано, если",
        "text": "..." // Кратко критерий, как поймёшь что завершено
      }
    ]
  }
Если объекта ещё нет (и consecutiveUncertain < 2):
  {
    "kind": "question",
    "text": "..." // Один конкретный вопрос про объект (что требует действия сейчас?), не про "мотивацию" и не повторять слова пользователя. Не про состояние ("что ты чувствуешь" запрещено).
  }
Запреты:
- не давать цепочку вопросов.
- не возвращать варианты-выборы/списки.
- больше никаких других блоков.
- не повторять слова/вопросы пользователя.

Return only valid json.
`;

const PROMPT_PUSH = `
Режим: Строже (push), "достигатор".

Если consecutiveUncertain >= 2:
  — Не задавай вопросов, только answer:
  {
    "kind": "answer",
    "blocks": [
      {
        "title": "Делай",
        "text": "Открой заметки, напиши строку 'сегодня я делаю ___', поставь таймер на 10 минут и начни."
      },
      {
        "title": "Ко времени",
        "text": "Будет выполнено, когда таймер прозвонит и у тебя есть результат по записи."
      }
    ]
  }
Если объекта ещё нет (и consecutiveUncertain < 2):
  — можно один ЖЁСТКИЙ вопрос ВЫБОРА между максимум двумя вариантами, никаких открытых вопросов, ни одного длинного списка!
  {
    "kind": "question",
    "text": "Выбери, что важнее сейчас: работа / здоровье? Ответь одним словом."
  }
Если объект уже есть:
  {
    "kind": "answer",
    "blocks": [
      {
        "title": "Жёстко",
        "text": "..." // Короче по сути, шаг на ≤30 минут, без воды (без морали, пояснений и многословия)
      },
      {
        "title": "Делай",
        "text": "..." // Одно конкретное действие по этому объекту, чётко и жёстко
      }
    ]
  }
Важно:
- никаких дыханий, воды, удовольствия, списков или "советов".
- не повторять слова или вопросы пользователя.

Return only valid json.
`;

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

// Главное: бесконечные вопросы запрещены, mode !== 'lite' и consecutiveUncertain >= 2 — answer без вопросов
function getSystemPrompt(
  mode: "lite" | "guide" | "push",
  previousKind?: "question" | "answer",
  consecutiveUncertain?: number
): string {
  let restriction = "";

  // Жесткое ограничение после 2+ уклончивых ответов (кроме lite)
  if (
    mode !== "lite" &&
    typeof consecutiveUncertain === "number" &&
    consecutiveUncertain >= 2
  ) {
    restriction =
      "\nПользователь 2+ раза подряд ответил уклончиво. ВОПРОСЫ ЗАПРЕЩЕНЫ. ДАЙ answer с одним конкретным микро-действием (≤10 минут) для добычи объекта.";
  } else if (
    (mode === "guide" || mode === "push") &&
    previousKind === "question"
  ) {
    restriction =
      "\nВ предыдущем ответе уже был вопрос. Сейчас вопрос задавать запрещено. Дай только answer строго по структуре.";
  }

  // Подключаем BASE_CONTEXT и нужный промпт
  if (mode === "lite")
    return BASE_CONTEXT.trim() + "\n\n" + PROMPT_LITE.trim();
  if (mode === "push")
    return BASE_CONTEXT.trim() + "\n\n" + PROMPT_PUSH.trim() + restriction;
  // default guide
  return BASE_CONTEXT.trim() + "\n\n" + PROMPT_GUIDE.trim() + restriction;
}

function getModeFromBody(body: any): "lite" | "guide" | "push" {
  // Сначала из appMode, потом из mode
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

    const systemPrompt = getSystemPrompt(mode, previousKind, consecutiveUncertain);

    // // debug only: console.log('API/analyze mode', mode, 'content', content, 'previousKind', previousKind);

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
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      // не палим детали openai внешнему клиенту
      return NextResponse.json(
        { error: errText || `OpenAI API error: ${res.status}` },
        { status: 502 }
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch (jsonErr) {
      // не парсится вообще
      return NextResponse.json({
        kind: "answer",
        blocks: [
          { title: "Ответ", text: "Не удалось сформировать ответ. Попробуйте позже." }
        ]
      }, { status: 502 });
    }

    let responseContent = data?.choices?.[0]?.message?.content;
    if (typeof responseContent !== "string") {
      // иногда может сразу быть объектом (редкий случай)
      if (typeof data?.choices?.[0]?.message?.content === "object") {
        responseContent = JSON.stringify(data?.choices?.[0]?.message?.content);
      } else if (data?.kind && (data?.blocks || data?.text)) {
        // если OpenAI вернул в корне
        responseContent = JSON.stringify(data);
      } else {
        return NextResponse.json({
          kind: "answer",
          blocks: [
            { title: "Ответ", text: "Не удалось получить результат. Попробуйте еще раз." }
          ]
        }, { status: 502 });
      }
    }

    let parsedResult: any;
    try {
      parsedResult = JSON.parse(responseContent);
    } catch {
      // Либо часто, либо если gpt вернул мусор
      return NextResponse.json({
        kind: "answer",
        blocks: [
          { title: "Ответ", text: responseContent.length < 200 ? responseContent : "Ошибка формата. Попробуйте переформулировать." }
        ]
      }, { status: 200 });
    }

    // ФИНАЛЬНАЯ ВАЛИДАЦИЯ
    if (parsedResult.kind === "question" && typeof parsedResult.text === "string") {
      return NextResponse.json({
        kind: "question",
        text: parsedResult.text
      });
    }
    if (
      parsedResult.kind === "answer"
      && Array.isArray(parsedResult.blocks)
      && parsedResult.blocks.every(
        (block: any) =>
          typeof block === "object" &&
          typeof block.title === "string" &&
          typeof block.text === "string"
      )
    ) {
      // nextStep может быть, может не быть (guide/push)
      const resp: any = {
        kind: "answer",
        blocks: parsedResult.blocks
      };
      if (typeof parsedResult.nextStep === "string" && parsedResult.nextStep.trim()) {
        resp.nextStep = parsedResult.nextStep.trim();
      }
      return NextResponse.json(resp);
    }

    // Fallback: невалидно, но хотим показать хоть что-то
    return NextResponse.json({
      kind: "answer",
      blocks: [
        { title: "Ответ", text: typeof parsedResult === 'string' ? parsedResult : "Ответ не распознан. Переформулируйте или попробуйте позже." }
      ]
    }, { status: 200 });

  } catch (err: any) {
    console.error("[/api/analyze]", err);
    return NextResponse.json({
      kind: "answer",
      blocks: [
        { title: "Ответ", text: "Внутренняя ошибка сервера. Попробуйте позднее." }
      ]
    }, { status: 500 });
  }
}
