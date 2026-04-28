'use strict';

/**
 * utils.js — вспомогательные утилиты для бота
 */

/**
 * Конвертирует миллисекунды в формат мм:сс
 * @param {number} ms — длительность в миллисекундах
 * @returns {string} — строка вида "03:45"
 */
function formatDuration(ms) {
  if (!ms || isNaN(ms) || ms < 0) return '00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  // Добавляем ведущий ноль если нужно
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${mm}:${ss}`;
}

/**
 * Проверяет, является ли строка валидной ссылкой на Яндекс.Музыку
 * Принимает форматы:
 *   https://music.yandex.ru/album/XXXXX/track/YYYYY
 *   https://music.yandex.com/album/XXXXX/track/YYYYY
 * @param {string} url
 * @returns {boolean}
 */
function isValidYandexMusicUrl(url) {
  if (!url || typeof url !== 'string') return false;

  try {
    const parsed = new URL(url.trim());

    // Проверяем хост
    const validHosts = ['music.yandex.ru', 'music.yandex.com'];
    if (!validHosts.includes(parsed.hostname)) return false;

    // Проверяем путь — должен содержать /album/ и /track/
    const pathMatch = /\/album\/\d+\/track\/\d+/.test(parsed.pathname);
    return pathMatch;
  } catch {
    // new URL() бросит ошибку если строка не является URL
    return false;
  }
}

/**
 * Логирует входящее сообщение в консоль
 * @param {object} ctx — контекст Telegraf
 */
function logMessage(ctx) {
  const user = ctx.from;
  const text = ctx.message?.text || '[нет текста]';
  const timestamp = new Date().toISOString();

  console.log(
    `[${timestamp}] Сообщение от @${user?.username || 'unknown'} ` +
    `(id=${user?.id}): ${text}`
  );
}

module.exports = {
  formatDuration,
  isValidYandexMusicUrl,
  logMessage,
};
