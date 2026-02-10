import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// КАНОН THINKCLEAR (строго соблюдать):
const BASE_CONTEXT = `
Thinkclear — ассистент следующего шага без самообмана.

Не терапия, не мотивация, не "улучшить состояние", не дыхание и не медитации.

Запрещено: "пользователь", "человек", третье лицо, пересказ очевидного ("я дома" -> "ты дома") если это не помогает шагу.

Запрещено: повторять вопрос пользователя как ответ ("зачем?" -> "зачем?").

Всегда говорить по делу и для собеседника (можно на "ты" в guide/push; в lite допустимо нейтрально).

Если вход содержит историю диалога, ориентируйся на "Новая реплика пользователя" и не повторяй уже сказанное ассистентом.

Один ответ = либо ОДИН вопрос (kind:"question"), либо answer с блоками.

В одном ответе НЕ БОЛЕЕ ОДНОГО вопроса.

Цель guide/push: вывести к одному объекту действия и одному шагу ≤30 минут.

Никаких примеров с 'например'. Никаких вариантов. Никаких дыханий/воды/растяжек. Не повторять слова пользователя.
`;

const PROMPT_LITE = `
Режим: Спокойнее (lite), “лучший друг”. Лаконично.

Ответ — только валидный JSON строго по формату:
{
  "kind": "question",
  "text": "..." // Один уточняющий вопрос (до 90 символов), чтобы выяснить объект или действие.
}

- Только один вопрос, никаких answer/blоков.
- Без примеров, списков, вариантов, воды и пустых блоков.
- Запрещены вопросы "че делаешь?/зачем?/почему?" и любые бессмысленные уточнения.
- Вопрос должен быть осмысленным и явно требовать конкретики: например, "Про что это сейчас: деньги, работа, разговор или решение?" или "Какой следующий шаг: подумать или действовать?".
- Без заглушек ("вдох", "вода", "растяжка") и повтора слов пользователя.
- Только JSON с одним вопросом.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide), "старший брат".

Если нет объекта действия — только:
{
  "kind": "question",
  "text": "..." // Один короткий вопрос (до 90 символов), чтобы получить объект для шага.
}
Если есть объект — только:
{
  "kind": "answer",
  "blocks": [
    { "title": "Шаг", "text": "..." },      // Одно действие ≤30 минут
    { "title": "Сделано", "text": "..." }  // Критерий результата
  ]
}
- Не больше двух блоков.
- Запрещены списки, примеры, варианты, пустые слова.
- Без заглушек ("вдох", "вода", "растяжка").
- Один ответ = один вопрос или одно действие.
- Не повторяй слова пользователя.
- Только строго валидный JSON.
`;

const PROMPT_PUSH = `
Режим: Строже (push), "достигатор".

Если нет объекта — только:
{
  "kind": "question",
  "text": "..." // Один конкретный вопрос (до 90 символов) про объект или действие.
}
Если есть объект — только:
{
  "kind": "answer",
  "blocks": [
    { "title": "Жёстко", "text": "..." },  // Коротко по сути, без морали
    { "title": "Делай", "text": "..." }    // Одно действие ≤30 минут, максимально конкретно
  ]
}
- Не больше двух блоков.
- Запрещены списки, примеры, варианты, советы про "воду", "вдох", "растяжки".
- Без заглушек, воды и повторов.
- Один ответ = один вопрос или действие, строго в JSON.
`;

type AnalyzeBody = {
  text?: string;
  input?: string;
  mode?: "lite" | "guide" | "push" | string;
  actionLabel?: string;
  actionKey?: string;
  appMode?: "lite" | "guide" | "push" | string;
  previousKind?: "question" | "answer";
};

// protected from endless questioning: if previousKind is "question" — enforce answer in guide/push
function getSystemPrompt(
  mode: "lite" | "guide" | "push",
  previousKind?: "question" | "answer"
): string {
  let restriction = "";
  if (
    (mode === "guide" || mode === "push") &&
    previousKind === "question"
  ) {
    restriction = "\nВ предыдущем ответе уже был вопрос. Сейчас вопрос задавать запрещено. Дай только answer строго по структуре.";
  }

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

    const userMessage = content;

    const systemPrompt = getSystemPrompt(mode, previousKind);

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
