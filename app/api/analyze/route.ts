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
`;

const PROMPT_LITE = `
Режим: Спокойнее (lite), “лучший друг”.

Полезный ответ без "пустого разговора".

- Никаких вопросов "че делаешь?/зачем?/почему?".
- Никаких советов про дыхание.
- Никаких оценок.
- Если ввод короткий или абстрактный (например "зачем", "не знаю", "всё"), то в "Можно" мягко попроси ДОБАВИТЬ ОДНУ ДЕТАЛЬ: например, "про что это сейчас?" или "какой следующий шаг нужен?".
- Ответ помогает продолжать разговор осмысленно: дай рамку, а не эхо ответа пользователя.

Пример:
Сейчас: "Ок. Понял."
Можно: "Одной фразой: про что это — деньги, работа, разговор, решение?"
Не делай: "Не пытайся сразу объяснить всё. Достаточно одной детали."

Запрещено: в lite не писать "Сделай глубокий вдох", "улучши состояние" и подобное.

Формат ответа — строго валидный JSON:
{
  "kind": "answer",
  "blocks": [
    { "title": "Сейчас", "text": "..." },      
    { "title": "Можно", "text": "..." },       
    { "title": "Не делай", "text": "..." }
  ]
}
Без вопросов, без nextStep, только эти блоки. Без markdown и пояснений. Только JSON.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide), "старший брат".

Либо 1 конкретный вопрос, либо 1 шаг.

- Блок "Факт" писать по делу шага, без "ты дома", если это не важно для следующего действия.
- Запрещены общие вопросы типа "Что именно нужно сделать сейчас?" и "Как улучшить состояние?".
- Вопрос должен вытаскивать ОБЪЕКТ действия:
  Например: "Какую одну задачу нужно сдвинуть прямо сейчас?" или "Что именно ты хочешь получить на выходе: решение, план, разговор или действие?" (выбери только один вопрос).
- Если пользователь уже дал объект (например "деньги", "работа", "отчёт", "позвонить"), вопрос не нужен — сразу шаг.
- "Следующий шаг" = одно действие ≤30 минут, без вариантов.
- "Сделано, если" = измеримый критерий.

Строго запрещено задавать вопрос, если previousKind === "question".

Структура (только один вариант ответа):

1) Если даёшь вопрос:
{
  "kind": "question",
  "text": "..." // Один конкретный вопрос, который помогает выявить объект действия или желаемый результат.
}

2) Если даёшь ответ:
{
  "kind": "answer",
  "blocks": [
    { "title": "Факт", "text": "..." }, // Коротко и по делу.
    { "title": "Узкое место", "text": "..." }, // Сформулируй реальное затруднение или оставь пустым.
    { "title": "Следующий шаг (≤30 минут)", "text": "..." }, // Только одно действие, никакого списка, без вариантов.
    { "title": "Сделано, если", "text": "..." } // Критерий результата.
  ],
  "nextStep": "..." // Повторение следующего шага, если нужен.
}

Ответ — строго по этой структуре, одним вопросом или одним шагом. Валидный JSON, без markdown, только по делу.
`;

const PROMPT_PUSH = `
Режим: Строже (push), "достигатор".

- Никакого педантизма и докапывания до мелочей.
- "Самообман" только если пользователь уходит в абстракции ("всё", "не знаю", "хочу денег") БЕЗ способа.
- Если есть конкретное действие ("попить чай") — не называй это самообманом, а ужимай до первого физического шага.
- Всегда только одно действие ≤30 минут — без вариантов.
- Если пользователь говорит "я денег хочу" — это абстракция. Тогда:
  Самообман: "Хочешь результат без способа."
  Делай сегодня: "Назови один способ заработать (1 строка) и сделай первый контакт: написать 1 человеку/клиенту/работодателю."
  (выбрать и сделать — это один шаг, без вариантов)

Важно: в push НЕ задавать вопрос в каждом ответе. Вопрос допускается только если вообще нет объекта (например "..." или "не знаю").
Если задаёшь вопрос — он один и максимально конкретный: "Один источник денег: работа/клиенты/продажи — что из этого реально доступно тебе сейчас?"

Формат (строго):

1) Если вопрос:
{
  "kind": "question",
  "text": "..." // Только один максимально конкретный вопрос про объект и следующий возможный шаг.
}
2) Если ответ:
{
  "kind": "answer",
  "blocks": [
    { "title": "Самообман", "text": "..." }, // Только в случае абстракции/ухода.
    { "title": "Цена", "text": "..." },      // Если выражен риск/потеря при бездействии — коротко, без морали.
    { "title": "Делай сегодня (≤30 минут)", "text": "..." } // Только одно действие, максимально конкретно.
  ],
  "nextStep": "..." // Можно не указывать, если нет шага.
}

Строго валидный JSON, один вопрос или один шаг, никаких вариантов, без markdown и пояснений.
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
    restriction = "\nВ предыдущем ответе уже был вопрос. Сейчас вопрос задавать запрещено. Дай answer.";
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
