'use strict';

/**
 * bot.js — главный файл Telegram-бота
 *
 * Запуск: node bot.js
 * Требует: BOT_TOKEN в .env
 */

// Загружаем переменные окружения из файла .env
require('dotenv').config();

const { Telegraf } = require('telegraf');
const { getTrackInfo } = require('./parser');
const { isValidYandexMusicUrl, logMessage } = require('./utils');

// ─── Проверка конфигурации ──────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('[bot] ОШИБКА: Переменная BOT_TOKEN не задана в .env');
  process.exit(1);
}

// ─── Инициализация бота ─────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

// ─── Тексты сообщений ───────────────────────────────────────────────────────

const MESSAGES = {
  welcome: `
👋 Привет! Я бот для получения информации о треках с Яндекс.Музыки.

🎵 Просто отправь мне ссылку на трек, например:
<code>https://music.yandex.ru/album/12345/track/67890</code>

И я пришлю тебе:
• Название трека
• Исполнителя
• Длительность

Попробуй прямо сейчас!
`.trim(),

  invalidUrl: `
❌ Это не похоже на ссылку Яндекс.Музыки.

Пожалуйста, отправь корректную ссылку на трек в формате:
<code>https://music.yandex.ru/album/XXXXX/track/YYYYY</code>
`.trim(),

  emptyMessage: '⚠️ Пожалуйста, отправь ссылку на трек с Яндекс.Музыки.',

  loading: '⏳ Получаю информацию о треке...',

  error: '😔 Не удалось получить информацию о треке. Попробуй ещё раз или проверь ссылку.',
};

// ─── Форматирование ответа ───────────────────────────────────────────────────

/**
 * Формирует красивый ответ с информацией о треке
 * @param {{ title: string, artists: string[], duration: string }} track
 * @returns {string}
 */
function formatTrackResponse(track) {
  const artistsList = track.artists.join(', ');
  const durationText = track.duration !== '00:00'
    ? track.duration
    : 'неизвестно';

  return [
    `🎵 <b>Название:</b> ${escapeHtml(track.title)}`,
    `👤 <b>Исполнитель:</b> ${escapeHtml(artistsList)}`,
    `⏱ <b>Длительность:</b> ${durationText}`,
  ].join('\n');
}

/**
 * Экранирует специальные символы HTML для безопасного использования в parse_mode: 'HTML'
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Обработчики команд ──────────────────────────────────────────────────────

/**
 * Команда /start — приветствие
 */
bot.start((ctx) => {
  logMessage(ctx);
  console.log(`[bot] /start от пользователя id=${ctx.from.id}`);

  return ctx.replyWithHTML(MESSAGES.welcome);
});

/**
 * Команда /help — краткая справка
 */
bot.help((ctx) => {
  logMessage(ctx);
  return ctx.replyWithHTML(MESSAGES.welcome);
});

// ─── Обработчик текстовых сообщений ─────────────────────────────────────────

bot.on('text', async (ctx) => {
  // Логируем каждое сообщение
  logMessage(ctx);

  const text = ctx.message.text?.trim();

  // Защита от пустых сообщений
  if (!text) {
    return ctx.reply(MESSAGES.emptyMessage);
  }

  // Проверяем валидность ссылки
  if (!isValidYandexMusicUrl(text)) {
    console.log(`[bot] Некорректная ссылка от id=${ctx.from.id}: ${text}`);
    return ctx.replyWithHTML(MESSAGES.invalidUrl);
  }

  // Уведомляем пользователя о начале обработки
  const loadingMsg = await ctx.reply(MESSAGES.loading);

  try {
    // Парсим страницу трека
    const track = await getTrackInfo(text);

    console.log(
      `[bot] Трек получен: "${track.title}" — ` +
      `${track.artists.join(', ')} (${track.duration})`
    );

    // Удаляем сообщение "загрузка" и отправляем результат
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    await ctx.replyWithHTML(formatTrackResponse(track));

  } catch (error) {
    console.error(`[bot] Ошибка парсинга для id=${ctx.from.id}:`, error.message);

    // Удаляем сообщение "загрузка"
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    // Показываем пользователю понятное сообщение об ошибке
    await ctx.reply(`${MESSAGES.error}\n\n<i>Причина: ${escapeHtml(error.message)}</i>`, {
      parse_mode: 'HTML',
    });
  }
});

// ─── Обработчик не-текстовых сообщений ──────────────────────────────────────

bot.on('message', (ctx) => {
  logMessage(ctx);
  return ctx.reply('🤖 Я умею обрабатывать только текстовые ссылки. Отправь ссылку на трек!');
});

// ─── Обработка ошибок Telegraf ───────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[bot] Необработанная ошибка для @${ctx.from?.username}:`, err);
  ctx.reply('⚠️ Произошла внутренняя ошибка. Попробуй позже.').catch(() => {});
});

// ─── Запуск бота ─────────────────────────────────────────────────────────────

async function startBot(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      await bot.launch();
      console.log('[bot] ✅ Бот успешно запущен и ожидает сообщений...');
      return;
    } catch (err) {
      console.error(`[bot] Попытка ${i}/${retries} не удалась: ${err.message}`);
      if (i < retries) {
        console.log('[bot] Повтор через 3 секунды...');
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  }
  console.error('[bot] ❌ Не удалось запустить бота после всех попыток');
  process.exit(1);
}

startBot();
