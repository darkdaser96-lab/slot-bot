/**
 * Telegram webhook: /api/bot
 * Env: TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, WEBHOOK_URL (optional)
 * Dialog state is in-memory Map (demo; slots do not block each other).
 */

const sessions = new Map();

const BOOK_BTN = "Записаться";
const SERVICES = ["Замер", "Ремонт", "Консультация"];
const TIMES = ["11:00", "14:00", "16:00", "18:00"];

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_RU = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function adminChatId() {
  return process.env.ADMIN_CHAT_ID || "";
}

function webhookPublicUrl() {
  return (
    process.env.WEBHOOK_URL ||
    "https://slot-bot-seven.vercel.app/api/bot"
  );
}

async function tg(method, body) {
  const t = token();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg =
      (data && data.description) || `Telegram ${method} HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, {
      step: null,
      service: "",
      day: "",
      dayLabel: "",
      time: "",
      name: "",
      phone: "",
    });
  }
  return sessions.get(key);
}

function clearSession(chatId) {
  sessions.delete(String(chatId));
}

async function sendMessage(chatId, text, extra) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

function mainKeyboard() {
  return {
    keyboard: [[{ text: BOOK_BTN }]],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
  };
}

function serviceKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Замер", callback_data: "svc:Замер" },
        { text: "Ремонт", callback_data: "svc:Ремонт" },
      ],
      [{ text: "Консультация", callback_data: "svc:Консультация" }],
    ],
  };
}

/** Current calendar parts in Europe/Moscow */
function moscowNowParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
  };
}

function addDaysISO(y, m, d, add) {
  // Use noon UTC to avoid DST edge issues when building civil dates
  const dt = new Date(Date.UTC(y, m - 1, d + add, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const wd = dt.getUTCDay();
  return { iso: `${yy}-${mm}-${dd}`, year: yy, month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), weekday: wd };
}

function formatDayLabel(weekday, day, month) {
  return `${WEEKDAYS_RU[weekday]}, ${day} ${MONTHS_RU[month - 1]}`;
}

/** Three nearest working days Mon–Fri from today (Europe/Moscow), including today if weekday. */
function nextWorkingDays(count) {
  const now = moscowNowParts();
  const out = [];
  let offset = 0;
  while (out.length < count && offset < 21) {
    const d = addDaysISO(now.year, now.month, now.day, offset);
    if (d.weekday >= 1 && d.weekday <= 5) {
      out.push({
        iso: d.iso,
        label: formatDayLabel(d.weekday, d.day, d.month),
      });
    }
    offset += 1;
  }
  return out;
}

function dayKeyboard() {
  const days = nextWorkingDays(3);
  return {
    inline_keyboard: days.map((d) => [
      { text: d.label, callback_data: "day:" + d.iso },
    ]),
  };
}

function timeKeyboard() {
  return {
    inline_keyboard: [
      TIMES.slice(0, 2).map((t) => ({ text: t, callback_data: "time:" + t })),
      TIMES.slice(2).map((t) => ({ text: t, callback_data: "time:" + t })),
    ],
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dayLabelFromIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "—";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const wd = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
  return formatDayLabel(wd, d, mo);
}

async function askStart(chatId) {
  const session = getSession(chatId);
  session.step = null;
  session.service = "";
  session.day = "";
  session.dayLabel = "";
  session.time = "";
  session.name = "";
  session.phone = "";
  await sendMessage(
    chatId,
    "Здравствуйте! Здесь можно записаться на услугу. Нажмите кнопку «Записаться» внизу экрана.",
    { reply_markup: mainKeyboard() }
  );
}

async function startBooking(chatId) {
  const session = getSession(chatId);
  session.step = "service";
  session.service = "";
  session.day = "";
  session.dayLabel = "";
  session.time = "";
  session.name = "";
  session.phone = "";
  await sendMessage(chatId, "Выберите услугу:", {
    reply_markup: serviceKeyboard(),
  });
}

async function afterServiceChosen(chatId, service) {
  const session = getSession(chatId);
  session.service = service;
  session.step = "day";
  await sendMessage(
    chatId,
    "Услуга: <b>" +
      escapeHtml(service) +
      "</b>\nВыберите день (ближайшие рабочие дни):",
    { reply_markup: dayKeyboard() }
  );
}

async function afterDayChosen(chatId, iso) {
  const session = getSession(chatId);
  session.day = iso;
  session.dayLabel = dayLabelFromIso(iso);
  session.step = "time";
  await sendMessage(
    chatId,
    "День: <b>" + escapeHtml(session.dayLabel) + "</b>\nВыберите время:",
    { reply_markup: timeKeyboard() }
  );
}

async function afterTimeChosen(chatId, time) {
  const session = getSession(chatId);
  session.time = time;
  session.step = "name";
  await sendMessage(
    chatId,
    "Время: <b>" +
      escapeHtml(time) +
      "</b>\nКак вас зовут? Напишите имя.",
    { reply_markup: mainKeyboard() }
  );
}

async function finishBooking(chatId, session, from) {
  const admin = adminChatId();
  const uname = from && from.username ? "@" + from.username : "—";
  const uid = from && from.id != null ? String(from.id) : "—";
  const dayShown = session.dayLabel || dayLabelFromIso(session.day);

  const text =
    "<b>Новая запись</b>\n" +
    "Услуга: " +
    escapeHtml(session.service || "—") +
    "\n" +
    "День: " +
    escapeHtml(dayShown) +
    " (" +
    escapeHtml(session.day || "—") +
    ")\n" +
    "Время: " +
    escapeHtml(session.time || "—") +
    "\n" +
    "Имя: " +
    escapeHtml(session.name) +
    "\n" +
    "Телефон: " +
    escapeHtml(session.phone) +
    "\n" +
    "Telegram: " +
    escapeHtml(uname) +
    " (id " +
    escapeHtml(uid) +
    ")";

  if (!admin) {
    await sendMessage(
      chatId,
      "Запись сохранена, но ADMIN_CHAT_ID не задан на сервере. Напишите администратору.",
      { reply_markup: mainKeyboard() }
    );
    clearSession(chatId);
    return;
  }

  try {
    await sendMessage(admin, text);
  } catch (err) {
    await sendMessage(
      chatId,
      "Не удалось отправить запись администратору. Попробуйте позже.",
      { reply_markup: mainKeyboard() }
    );
    clearSession(chatId);
    return;
  }

  const confirm =
    "Вы записаны.\n" +
    escapeHtml(session.service) +
    " — " +
    escapeHtml(dayShown) +
    ", " +
    escapeHtml(session.time) +
    ".\n" +
    "Имя: " +
    escapeHtml(session.name) +
    ", тел.: " +
    escapeHtml(session.phone);

  clearSession(chatId);
  await sendMessage(chatId, confirm, { reply_markup: mainKeyboard() });
}

async function handleMessage(message) {
  if (!message || !message.chat) return;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const session = getSession(chatId);

  if (text === "/start" || text.startsWith("/start ")) {
    await askStart(chatId);
    return;
  }

  if (text === BOOK_BTN) {
    await startBooking(chatId);
    return;
  }

  if (text === "/cancel") {
    clearSession(chatId);
    await sendMessage(
      chatId,
      "Запись отменена. Чтобы начать снова — нажмите «Записаться» внизу.",
      { reply_markup: mainKeyboard() }
    );
    return;
  }

  if (session.step === "service") {
    if (SERVICES.includes(text)) {
      await afterServiceChosen(chatId, text);
      return;
    }
    await sendMessage(chatId, "Выберите услугу кнопкой ниже.", {
      reply_markup: serviceKeyboard(),
    });
    return;
  }

  if (session.step === "day") {
    await sendMessage(chatId, "Выберите день кнопкой ниже.", {
      reply_markup: dayKeyboard(),
    });
    return;
  }

  if (session.step === "time") {
    if (TIMES.includes(text)) {
      await afterTimeChosen(chatId, text);
      return;
    }
    await sendMessage(chatId, "Выберите время кнопкой ниже.", {
      reply_markup: timeKeyboard(),
    });
    return;
  }

  if (session.step === "name") {
    if (!text) {
      await sendMessage(chatId, "Напишите, пожалуйста, ваше имя.");
      return;
    }
    session.name = text.slice(0, 200);
    session.step = "phone";
    await sendMessage(chatId, "Укажите телефон для связи.");
    return;
  }

  if (session.step === "phone") {
    if (!text) {
      await sendMessage(chatId, "Напишите номер телефона.");
      return;
    }
    session.phone = text.slice(0, 64);
    session.step = null;
    await finishBooking(chatId, session, message.from);
    return;
  }

  await sendMessage(
    chatId,
    "Чтобы записаться, нажмите кнопку «Записаться» внизу экрана.",
    { reply_markup: mainKeyboard() }
  );
}

async function handleCallback(query) {
  if (!query || !query.message) return;
  const chatId = query.message.chat.id;
  const data = query.data || "";
  try {
    await tg("answerCallbackQuery", { callback_query_id: query.id });
  } catch (_) {
    /* ignore */
  }

  if (data.startsWith("svc:")) {
    const service = data.slice(4);
    if (SERVICES.includes(service)) {
      await afterServiceChosen(chatId, service);
    }
    return;
  }

  if (data.startsWith("day:")) {
    const iso = data.slice(4);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      await afterDayChosen(chatId, iso);
    }
    return;
  }

  if (data.startsWith("time:")) {
    const time = data.slice(5);
    if (TIMES.includes(time)) {
      await afterTimeChosen(chatId, time);
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    try {
      if (!token()) {
        return res.status(503).json({
          ok: false,
          error: "TELEGRAM_BOT_TOKEN is not set",
        });
      }
      const url = webhookPublicUrl();
      const result = await tg("setWebhook", {
        url,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
      return res.status(200).json({
        ok: true,
        webhook: url,
        telegram: result,
        hasAdmin: Boolean(adminChatId()),
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: String((err && err.message) || err),
      });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!token()) {
    return res.status(503).json({ ok: false, error: "no_token" });
  }

  let update = req.body;
  if (typeof update === "string") {
    try {
      update = JSON.parse(update);
    } catch {
      update = {};
    }
  }
  if (!update || typeof update !== "object") update = {};

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("bot error", err);
    return res.status(200).json({
      ok: false,
      error: String((err && err.message) || err),
    });
  }
};
