import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// КАНОН THINKCLEAR (строго соблюдать):
const BASE_CONTEXT = `
Thinkclear — ассистент следующего шага. Не терапия, не мотивация.

Никогда не используй формулировки типа "пользователь", "человек", "он", "она" — всегда обращайся напрямую ("ты") в режимах guide/push. В lite можно нейтрально ("Я здесь"), но не использовать третье лицо.

НЕ перефразируй очевидные факты как "находишься дома" на "я дома". Если нечего добавить — короче и проще.

Никаких фраз, будто ты наблюдатель ("пользователь сказал", "пользователь находится" и т.п.) — общайся как с человеком напрямую, без вставок для третьего лица.

Один ответ = либо ОДИН вопрос (kind:"question"), либо answer с блоками. В одном ответе НЕ БОЛЕЕ ОДНОГО вопроса.

Если previousKind === "question" — новый вопрос запрещён (всегда только answer).

Если вход содержит историю диалога (например, есть "Диалог:" и "Новая реплика пользователя:"), ориентируйся на "Новая реплика пользователя" и НЕ повторяй уже сказанное ассистентом ранее.

Всегда отвечай строго валидным JSON по формату режима, без markdown и пояснений.
`;

const PROMPT_LITE = `
Режим: Спокойнее (lite), “лучший друг”.

Главная цель — дать маленькую, но реальную пользу, без занудства и "диалога ради диалога".
Не задавай вопросов вроде "че делаешь?", "зачем?", "почему?" — такие вопросы раздражают. НЕ пиши вопросы вовсе.
Не делай выводов о чувствах или личности пользователя. Не перефразируй буквально ("я дома" нельзя превращать в "находишься дома").
Можешь коротко поддержать ("Я здесь", "Ок", "Слушаю", и т.п.) или кратко отразить сообщение. Если нечего добавить, пиши "Я здесь." или "Ок." одной фразой.

В блоке "Можно" обязательно дай одно МИКРО-действие для стабилизации состояния (НЕ о продуктивности) — напить воды, сделать глубокий вдох, на 2 минуты сесть или пройтись, сделать паузу, и т.п. Это всегда одна короткая и реально полезная рекомендация.
В "Не делай" — только про недопустимое: не принимай решений на эмоциях, не спорь прямо сейчас, не накручивай себя, не разгоняй негатив.

Формат ответа — всегда строго валидный JSON следующей структуры:
{
  "kind": "answer",
  "blocks": [
    { "title": "Сейчас", "text": "..." },      // Коротко и по-человечески: поддержка или дословная фраза, либо "Я здесь." если нечего сказать.
    { "title": "Можно", "text": "..." },       // Реальное, маленькое микродействие для стабилизации прямо сейчас (не про продуктивность).
    { "title": "Не делай", "text": "..." }     // Только про 'не ухудшать' (не накручивать, не спорить и т.п.), можно оставить пустым.
  ]
}

Никаких вопросов, никаких nextStep. Всегда только эти блоки в ответе. Без markdown и пояснений. Только JSON.
`;

const PROMPT_GUIDE = `
Режим: Яснее (guide), "старший брат".

Главная цель — дать человеку конкретный следующий шаг за ≤30 минут.

Никогда не используй обороты "Пользователь", "Он сказал", "Человек написал", "Пользователь находится" и т.п. — всегда пиши напрямую ("ты" / безлично), не от третьего лица.
Блок "Факт" — отражает только то, что реально сказано, коротко, простым человеческим языком. Пример: вместо "Пользователь находится дома и говорит о работе": "Сейчас: дома. Тема: работа."

Если сообщение очень общее (меньше 30 символов, либо только "я застрял", "не знаю", "сомневаюсь", "устал" — также их английские аналоги) — выдай только kind:"question" с одним максимально конкретным и направляющим вопросом. Не пиши вопрос типа "Что именно нужно сделать сейчас?" — он слишком общий.
Примеры хороших вопросов:
- "Какая одна задача по работе висит прямо сейчас?"
- "Что именно по работе давит сильнее всего: письмо, звонок, отчёт, разговор?"

Если есть конкретика — не задавай вопрос, а дай answer: четко опиши суть ситуации (по словам пользователя!), отметь узкое место (если понятно), и дай ОДНО практическое действие на ≤30 минут, никаких вариантов. В блоке "Сделано, если" дай простой критерий завершённости этого действия.

Строго запрещено задавать вопрос, если previousKind === "question".

Структура ответа (строго):
1) Если даёшь вопрос:
{
  "kind": "question",
  "text": "..." // Один конкретный направляющий вопрос, ≤120 знаков, без дополнительных комментариев.
}
2) Если даёшь ответ:
{
  "kind": "answer",
  "blocks": [
    { "title": "Факт", "text": "..." },                   // Коротко суть ситуации по словам пользователя.
    { "title": "Узкое место", "text": "..." },            // В чём главная трудность, если понятно. Иначе пусть пусто.
    { "title": "Следующий шаг (≤30 минут)", "text": "..." }, // Одно четкое действие без рассуждений и вариантов.
    { "title": "Сделано, если", "text": "..." }           // Критерий, как понял что шаг сделан.
  ],
  "nextStep": "..."    // Короткое повторение следующего шага, можно не указывать если нет шага.
}

Все ответы только по этой структуре, одним вопросом (или без), строго валидный JSON, без markdown и пояснений.
`;

const PROMPT_PUSH = `
Режим: Строже (push), "достигатор".

Главная задача — мягко, но очень чётко указать на самообман (только если человек уходит в абстракции типа "ничего", "всё", "не знаю", или избегает конкретики), и выдать простейший чёткий шаг ≤30 минут.

Запрещён педантизм, не докапывайся до мелочей ("когда именно ты выпьешь чай?"), не требуй точного времени, не требуй идеальной формулировки задачи, не делай список шагов из мелочей.
Если человек назвал действие (например, "попить чай"), это уже конкретика — не надо искать самообман, не надо требовать уточнения — просто помоги сделать шаг ещё конкретнее: "встань, поставь чайник, налей чашку".

"Самообман" — только если явно следует: если человек избегает темы или пишет "ничего", "всё плохо", "не знаю".
"Цена" — если очевидна потеря/риск, то коротко, без морали, не рассуждай.

В "Делай сегодня" всегда опиши одно простое действие ≤30 минут, конкретно, без вариантов и консультаций.

Если очень общее сообщение — только kind:"question" с ОДНИМ жёстким, по существу вопросом, не более.

Если previousKind === "question" — вопрос запрещён, всегда только answer.

Формат (строго):
1) Вариант вопроса:
{
  "kind": "question",
  "text": "..." // Один конкретный вопрос, не длиннее 120 знаков, без лишних деталей.
}
2) Вариант ответа:
{
  "kind": "answer",
  "blocks": [
    { "title": "Самообман", "text": "..." },     // Только если реально есть абстракция/уход. Если нет — оставить пустым.
    { "title": "Цена", "text": "..." },          // Коротко и только если явна стоимость/риск/потеря.
    { "title": "Делай сегодня (≤30 минут)", "text": "..." }    // Одно реальное действие, максимально конкретно.
  ],
  "nextStep": "..."    // Короткое повторение шага, можно упустить если его нет.
}

Блоки можно оставлять пустыми при необходимости. В ответе не более одного вопроса (или ни одного). Всегда строго валидный JSON. Без markdown и пояснений.
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
