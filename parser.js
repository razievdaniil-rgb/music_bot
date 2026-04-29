'use strict';

/**
 * parser.js — парсинг страницы Яндекс.Музыки
 *
 * Яндекс.Музыка встраивает данные о треке прямо в HTML страницы
 * в виде JSON внутри тега <script id="js-state">.
 * Мы извлекаем этот JSON и достаём нужные поля.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { formatDuration } = require('./utils');

/**
 * Заголовки HTTP-запроса, имитирующие браузер.
 * Необходимо, чтобы Яндекс не отклонил запрос как бот.
 */
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Загружает страницу трека и возвращает HTML
 * @param {string} url — ссылка на трек
 * @returns {Promise<string>} — HTML страницы
 */
async function fetchPage(url) {
  // Извлекаем trackId и albumId из ссылки
  const match = url.match(/album\/(\d+)\/track\/(\d+)/);
  if (!match) throw new Error('Неверный формат ссылки');

  const albumId = match[1];
  const trackId = match[2];

  try {
    // Используем официальный API Яндекс.Музыки
    const response = await axios.get(
  `https://api.music.yandex.net/tracks/${trackId}`,
  {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'ru-RU,ru;q=0.9',
      'X-Yandex-Music-Client': 'YandexMusicAndroid/23020251',
      'X-Yandex-Music-Device': 'os=Android; os_version=9; manufacturer=Google; model=Pixel; clid=; device_id=random; uuid=random',
      'User-Agent': 'Yandex-Music-API',
    },
    timeout: 10000,
  }
);
    // Возвращаем данные в формате который ожидает парсер
    return { __apiResponse: response.data, albumId, trackId };
  } catch (error) {
    console.error('[parser] Ошибка API:', error.message);
    throw new Error('Не удалось получить данные трека.');
  }
}

/**
 * Ищет JSON с данными трека внутри HTML.
 *
 * Яндекс.Музыка хранит состояние страницы в нескольких возможных местах:
 *   1. <script id="js-state" type="application/json">...</script>
 *   2. window.__INITIAL_STATE__ = {...}
 *   3. <script type="application/ld+json"> (структурированные данные Schema.org)
 *
 * Пробуем все варианты по порядку.
 *
 * @param {string} html — HTML страницы
 * @returns {object|null} — распарсенный JSON или null
 */


/**
 * Ищет данные трека в объекте из js-state / __INITIAL_STATE__
 * Структура может отличаться в зависимости от версии Яндекс.Музыки.
 * @param {object} data
 * @returns {{ title: string, artists: string[], durationMs: number }|null}
 */


/**
 * Парсит мета-теги Open Graph как запасной вариант.
 * Яндекс.Музыка содержит og:title в формате "Исполнитель — Название"
 * и og:description может содержать длительность.
 * @param {string} html
 * @returns {{ title: string, artists: string[], durationMs: number }|null}
 */


/**
 * Главная функция: получает информацию о треке по URL
 * @param {string} url — ссылка на трек Яндекс.Музыки
 * @returns {Promise<{
 *   title: string,
 *   artists: string[],
 *   durationMs: number,
 *   duration: string
 * }>}
 */
async function getTrackInfo(url) {
  console.log('[parser] Запрос трека:', url);

  const result = await fetchPage(url);

  // Обрабатываем ответ API
  if (result.__apiResponse) {
    const data = result.__apiResponse;
    const track = data.result?.[0];

    if (track) {
      const title = track.title;
      const artists = (track.artists || []).map(a => a.name).filter(Boolean);
      const durationMs = track.durationMs;

      console.log('[parser] Трек получен через API:', title, '| ms:', durationMs);

      return {
        title,
        artists,
        durationMs,
        duration: formatDuration(durationMs),
      };
    }
  }

  throw new Error('Не удалось извлечь информацию о треке.');
}

module.exports = { getTrackInfo };
