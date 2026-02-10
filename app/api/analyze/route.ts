import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// КАНОН THINKCLEAR (строго соблюдать):
const BASE_CONTEXT = `
Thinkclear — ассистент следующего шага. Не психотерапия и не мотивация.

Не делай выводов о человеке. Не описывай скрытые причины. Не гадай.

Не перефразируй очевидные факты как "находишься дома" — если нечего добавить, лучше коротко.

Если вход содержит историю диалога (есть "Диалог:" и "Новая реплика пользователя:"), НЕ повторяй уже сказанные ассистентом фразы.

Один ответ = либо один вопрос, либо структурированный answer.

Нельзя задавать больше одного вопроса в одном ответе. Нельзя задавать вопрос, если previousKind === "question".

Всегда строго валидный JSON по формату режима. Без markdown.
`;

const PROMPT_LITE = `
Режим: Спокойнее (lite), “лучший друг”.

Главная задача — мягко отразить сообщение пользователя (дословно или коротко), не давая советов и без психологических выводов.

Формулировки типа "ты чувствуешь", "ты находишься", "тебе нужно", "это временно" и любые трактовки/оценки запрещены.

Поддерживай коротко и по-человечески. Формальности и шаблоны не использовать. Можно дать 0 или 1 очень мягкий вопрос (например: "Хочешь рассказать подробнее?"). Вопрос не обязателен.

Структура:
{
  "kind": "answer",
  "blocks": [
    { "title": "Сейчас", "text": "..." },      // Краткое человеческое отражение или нейтральное "Ок." / "Я здесь." / дословно 1 фразу пользователя. Если совсем нечего — "Я здесь."
    { "title": "Можно", "text": "Можешь продолжать писать. Я здесь." },   // Поощрение продолжать, без советов, по факту.
    { "title": "Не делай", "text": "..." }     // Только о безопасности/недопустимом (может быть пустым). Не давать советов, не повторять общие шаблоны.
  ]
}
Можешь включить мягкий вопрос вместо основного ответа (но только 1 и не всегда). В каждом ответе не больше одного вопроса (или ноль). Если вообще нечего сказать — только "Сейчас": "Я здесь.".

Строго без советов “что делать”. Ответ — только JSON по этому шаблону, без markdown и пояснений.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide), "старший брат".

Цель — подвести пользователя к конкретному следующему шагу (≤30 минут).

Если сообщение очень общее (менее 30 символов или только "я застрял"/"не знаю"/"сомневаюсь"/"устал" — или их английские аналоги) — выдать только kind:"question" с ОДНИМ четким и направляющим вопросом по сути, максимально конкретным (например: "Про что сейчас — работа, разговор, решение или тело?" или "Какой один шаг откладываешь сейчас?"). Никогда не задавай более одного вопроса за раз. Категорически нельзя формулировать вопросы типа "Что именно нужно сделать сейчас?".

Если есть хотя бы что-то конкретное — не задавать вопрос, а дать структурированный answer: рамка и как минимум 1 четкий следующий шаг (одно действие на ≤30 минут, максимально практично).

Нельзя задавать вопросы, если previousKind === "question".

Структура ответа:
1) Вариант вопроса (ТОЛЬКО если вообще нет конкретики, и вопрос ранее не задавался):
{
  "kind": "question",
  "text": "..." // Один конкретный вопрос, не длиннее 120 знаков. Без дополнительных комментариев, без второго вопроса.
}
2) Вариант ответа:
{
  "kind": "answer",
  "blocks": [
    { "title": "Факт", "text": "..." },             // Отразить ситуацию — только по тексту пользователя, не додумывать.
    { "title": "Узкое место", "text": "..." },      // В чем сложность, если ясно.
    { "title": "Следующий шаг (≤30 минут)", "text": "..." },    // Одно действие, чётко и просто, никаких вариантов или размышлений.
    { "title": "Сделано, если", "text": "..." }     // Критерий завершенности, по факту.
  ],
  "nextStep": "..."    // Дублирует "Следующий шаг" коротко, можно не указывать если шаг пуст.
}

В каждом ответе максимум один вопрос (или ни одного, если answer). Всё строго JSON, без markdown и пояснений.
`;

const PROMPT_PUSH = `
Режим: Строже (push), "достигатор".

Главная задача — мягко, но конкретно указать на самообман (только исходя из текста пользователя) и предложить чёткий шаг, который реально сделать за ≤30 минут.

Запрещено: докапываться до ненужных мелочей ("когда именно ты выпьешь чай"), требовать идеальных дедлайнов, спрашивать точное время, педантизм.

"Самообман" только если явно следует из того, что пользователь написал. Запрещено придумывать или расширять.

"Цена" — коротко, только если в тексте ясна потеря или риск.

"Делай сегодня" — максимально простой и конкретный шаг (например: если пользователь написал "попить чай" — "Делай сегодня: встань и поставь чайник. Первый глоток = сделано.").

Никогда не требовать идеально формулировать задачу. Не требовать конкретного времени.

Если сообщение слишком общее (менее 30 символов или только "я застрял"/"не знаю"/"сомневаюсь"/"устал" или их английские аналоги), a также если вообще неясно к чему применить строгость — только kind:"question" с одним чётким вопросом по существу. Не больше одного вопроса.

Если previousKind === "question" — обязательно только answer.

Структура ответа:
1) Вариант вопроса:
{
  "kind": "question",
  "text": "..." // Один конкретный вопрос, не длиннее 120 знаков. Без уточняющих уточнений и расспросов по мелочам.
}
2) Вариант ответа:
{
  "kind": "answer",
  "blocks": [
    { "title": "Самообман", "text": "..." },     // Только если явный факт, без приписывания.
    { "title": "Цена", "text": "..." },          // Коротко и по факту.
    { "title": "Делай сегодня (≤30 минут)", "text": "..." }    // Одно действие, конкретно, не требовать расписания.
  ],
  "nextStep": "..."    // Если есть чёткий шаг — дублирует его коротко, иначе не указывать.
}

Блоки можно оставить пустыми по необходимости. В ответе всегда не более одного вопроса (или ни одного). Ответ — только JSON по шаблону.
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
