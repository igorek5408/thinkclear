import { NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Канон Thinkclear: никакого анализа пользователя, советов, давления, приказов.
// Если нечего сказать — нейтрально/пусто.

const BASE_CONTEXT = `
КОНТЕКСТ (строго следовать):
- Thinkclear — тёплое присутствие, не советчик, не анализирует пользователя и не считает себя умнее.
- ФАКТЫ только по описанию, никаких выводов, анализа эмоций или предположений.
- Не использовать "ты", "тебе нужно", "ты должен", "надо", "следует", "обязаны", не делать выводов о личности или эмоциях.
- Никаких советов, кроме мягких, только если явно есть запрос.
- Если ситуация не ясна — верни нейтральный или пустой ответ.
- Если ввод пустой — допускается пустой/лаконичный ответ.
- НИКОГДА не осуждай, не приписывай намерения, не выводи о прошлом/Будущем/Личности. Не сравнивай.
- Не анализировать тревогу, не пытаться спасать.
- Пропуск дней не комментируется вообще.
- Чем короче и тише — тем лучше. Если не уверен, молчи.
- В длинных вводах не сокращать и не делать обобщений.
`;

const MODE_LITE_TEMPLATE = `
Режим: Поддержка (lite).
Формат ответа: один markdown-текст с ровно тремя секциями как ниже.
Ответ всегда лаконичный, можно пусто или одно нейтральное предложение.
ШАГ по умолчанию НЕ нужен — только если есть явный запрос.

Секции (заголовки строго такие, даже если секция пустая):
### 1) Я рядом
(Максимум 1-2 коротких нейтральных предложения, можно просто "Я здесь." или пусто.)

### 2) Что происходит
(Если в вводе есть конкретика: кратко и нейтрально повторить/обозначить факт. Если нет — оставить пусто.)

### 3) Один мягкий шаг на сегодня
(ПУСТО если нет прямого/явного запроса на шаг. Никаких советов без явного запроса.)`;

const MODE_GUIDE_TEMPLATE = `
Режим: Держи курс (guide).
Формат ответа: один markdown-текст с ровно тремя секциями как ниже.
Рамка + критерии по факту. Один шаг ТОЛЬКО если есть явный запрос или ситуация проста.
Никаких советов по умолчанию.

Секции:
### 1) Рамка
(Описать суть или задачу ровно одной фразой, НЕ делать выводы, не гадать. Если неясно — оставить пусто.)

### 2) Критерии выбора
(До 2-х критериев в стиле "Можно оттолкнуться от..." – если неочевидно, оставить пусто.)

### 3) Один шаг
(Только если очевиден мягкий первый шаг, и пользователь этого хочет. Иначе — пусто.)`;

const MODE_PUSH_TEMPLATE = `
Режим: Подгоняй (push).
Формат ответа: один markdown-текст с ровно тремя секциями как ниже.
Решение/выбор: по факту, без давления и приказов. Обязательно только один короткий шаг и один короткий дедлайн, без оценки.

Секции:
### 1) Решение
(Перечислить возможные действия или отметить выбор по тексту. Без советов, если неочевидно — пусто.)

### 2) Дедлайн
(Кратчайший реальный интервал: "до вечера" / "сегодня" / "в течение суток". Без угроз, давления. Если неуместно — пусто.)

### 3) Один шаг
(Один минимальный шаг, если он ясен без домысливания. Не придумывать, не гадать. Если неясно — оставить пусто.)`;

const OUTPUT_RULES = `
Ответ — только валидный JSON с одним полем: "result". Значение "result" — строка c markdown (точно указанные секции через ###). Без обёртки в \`\`\`json и дополнительного текста.
Ошибки не исправлять — если не можешь сказать/не уверен, секция пустая или отвечает нейтрально.
`;

function getSystemPrompt(mode: "lite" | "guide" | "push"): string {
  let template = MODE_GUIDE_TEMPLATE;
  if (mode === "lite") template = MODE_LITE_TEMPLATE;
  if (mode === "push") template = MODE_PUSH_TEMPLATE;
  // Соберём системный prompt
  return (
    BASE_CONTEXT.trim() +
    "\n\n" +
    template.trim() +
    "\n\n" +
    OUTPUT_RULES.trim()
  );
}

type AnalyzeBody = {
  text?: string;
  input?: string;
  mode?: "lite" | "guide" | "push";
  actionLabel?: string;
  actionKey?: string;
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

    // Edge: Пустой ввод — разрешено и нормально
    // Не отдаём ошибку, а просто обрабатываем на стороне prompt (система промпта знает).
    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Missing or empty input" },
        { status: 400 }
      );
    }

    const mode =
      body.mode === "lite" || body.mode === "guide" || body.mode === "push"
        ? body.mode
        : "guide";
    const actionLabel =
      typeof body.actionLabel === "string" ? body.actionLabel.trim() : "";

    // Не передавать никаких гипотез в userMessage
    // Просто само сообщение
    const userMessage = content;

    const systemPrompt = getSystemPrompt(mode);

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
        temperature: 0.2, // Чуть меньше креатива, чтобы тише
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: errText || `OpenAI API error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const contentRaw = data?.choices?.[0]?.message?.content;
    if (typeof contentRaw !== "string") {
      return NextResponse.json(
        { error: "Invalid response from OpenAI" },
        { status: 502 }
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(contentRaw);
    } catch {
      return NextResponse.json(
        { error: "OpenAI returned invalid JSON" },
        { status: 502 }
      );
    }

    const result =
      typeof parsed.result === "string" ? parsed.result : "";

    return NextResponse.json({ result });
  } catch (err) {
    console.error("[/api/analyze]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
