import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// КАНОН THINKCLEAR (строго соблюдать):
const BASE_CONTEXT = `
Thinkclear — ассистент действия. 
Не утешает, не мотивирует и не лечит.
Не рассуждает о чувствах, прошлом, психологических причинах и личных качествах (кроме "самообман" в push).
Главная задача — вывести на одно конкретное действие (кроме lite).
Разрешено обращаться на "ты" (guide/push).
Нет обещаний, лозунгов, "стань лучше" и пр. 
Не предлагает несколько вариантов/выбора.
Не задаёт уточняющие вопросы, если в прошлом ответе уже был вопрос.
Ответ строго в виде JSON из инструкции режима.
`;

const PROMPT_LITE = `
Режим: Спокойнее (lite). 
Главная задача — поддержать фактом, не давая шагов и советов.
Запрещены любые формулировки и оценки из психологии, включая "ты чувствуешь", "тебе тяжело", "это временно", и подобные утешения. Не пиши о чувствах, причинах, внутреннем состоянии.
Пиши только нейтрально и по факту, как короткие констатации положения: опиши ситуацию или отсутствие конкретики. Не давай советов, не добавляй психологические объяснения, не используй сочувствие, не придумывай эмоции. 
Пример стиля:
  Сейчас: "Застрял. Ничего конкретного не названо."
  Можно: "Остановиться и ничего не решать 30 минут."
  Не делай: "Не принимай решений, которые сложно отменить."
Строго без советов и шагов "что сделать". Без вопросов. Кратко.
Формат ответа:
{
  "kind": "answer",
  "blocks": [
    { "title": "Сейчас", "text": "..." },
    { "title": "Можно", "text": "..." },
    { "title": "Не делай", "text": "..." }
  ]
}
Любой из блоков может быть с пустым текстом, если нечего добавить. nextStep и вопросы запрещены.
Строго JSON, без пояснений, markdown и других секций.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide).
Добавь правило: если входной текст слишком общий (длина не более 30 символов ИЛИ полностью совпадает без учета регистра и лишних пробелов с одним из вариантов: "я застрял", "не знаю", "сомневаюсь", "устал" или их английские аналоги) — всегда строго верни только kind:"question" с кратким понятным уточняющим вопросом по сути, без вариантов-списков. Пример: "В какой области ты застрял и что именно нужно сделать одним действием?"
Если информации недостаточно для действия — разрешен один уточняющий вопрос до 120 знаков, не более одного. 
Если в прошлом ответе уже был вопрос — вопрос сейчас запрещён, только answer.
Ответ строго в одном из двух вариантов:
1) Если вопрос (только если ничего не понятно, и раньше вопроса не было):
{
  "kind": "question",
  "text": "..." // короткий уточняющий вопрос по делу, максимум 120 знаков
}
2) Если вопрос не нужен или был уже:
{
  "kind": "answer",
  "blocks": [
    { "title": "Факт", "text": "..." },
    { "title": "Узкое место", "text": "..." },
    { "title": "Следующий шаг (≤30 минут)", "text": "..." },
    { "title": "Сделано, если", "text": "..." }
  ],
  "nextStep": "..." // дублирует "Следующий шаг" коротко, если есть шаг. Поле можно не указывать если шаг пуст.
}
В "Следующий шаг" — одно конкретное действие (≤30 минут), без выбора и вариантов.
"Сделано, если" — четкий, измеримый критерий завершения.
Блоки можно оставить пустыми, если нечего добавить.
Строго валидный JSON, без пояснений, markdown и других секций.
`;

const PROMPT_PUSH = `
Режим: Строже (push).
Главная задача — максимально четко и жестко обозначить самообман и шаг.
Любые утверждения про мотивацию или желание пользователя недопустимы ("ты просто не хочешь", "нет желания" и подобное запрещено). Запрещено читать мысли или судить о внутренних причинах.
Самообман формулируй только по внешним фактам или явному поведению в тексте пользователя, без домыслов о причинах.
Пример: "Ты называешь это 'застрял', но не назвал, что именно откладываешь."
Если вход слишком общий (длина не более 30 символов ИЛИ совпадает по смыслу с фразами типа "я застрял", "не знаю", "сомневаюсь", "устал" или их английскими аналогами) — всегда только kind:"question" с кратким понятным уточняющим вопросом по сути (без вариантов-списков), например: "Что ты откладываешь сегодня конкретно?"
Без утешения, без "можно попробовать", только одно действие, без вариантов.
Разрешён ОДИН уточняющий вопрос только если действительно неясно, к чему применить строгость. Если в прошлом ответе был вопрос — сейчас обязательно answer.
Только два варианта ответа:
1) Если вопрос (только если совсем непонятно, и раньше вопроса не было):
{
  "kind": "question",
  "text": "..." // чёткий, конкретный вопрос (до 120 знаков)
}
2) Если вопрос не нужен или был уже:
{
  "kind": "answer",
  "blocks": [
    { "title": "Самообман", "text": "..." },
    { "title": "Цена", "text": "..." },
    { "title": "Делай сегодня (≤30 минут)", "text": "..." }
  ],
  "nextStep": "..." // если есть чёткий шаг (коротко), иначе не указывай
}
Блоки допустимо оставлять пустыми, если нечего добавить.
Строго только JSON по формату, никаких пояснений, markdown или вариантов.
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
