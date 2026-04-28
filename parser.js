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
  try {
    const response = await axios.get(url.trim(), {
      headers: REQUEST_HEADERS,
      timeout: 15000, // 10 секунд на запрос
      maxRedirects: 5,
      proxy: false, // отключаем встроенный proxy, используем только agent
    });
    return response.data;
  } catch (error) {
    console.error('[parser] Ошибка загрузки страницы:', error.message);
    throw new Error('Не удалось загрузить страницу Яндекс.Музыки. Проверьте ссылку или попробуйте позже.');
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
function extractJsonFromHtml(html) {
  const $ = cheerio.load(html);

  // Вариант 1: #js-state
  const jsStateEl = $('#js-state');
  if (jsStateEl.length) {
    try {
      const raw = jsStateEl.html();
      if (raw) {
        const parsed = JSON.parse(raw);
        console.log('[parser] Найден JSON в #js-state');
        return { source: 'js-state', data: parsed };
      }
    } catch (e) {
      console.warn('[parser] Не удалось разобрать #js-state JSON:', e.message);
    }
  }

  // Вариант 2: window.__INITIAL_STATE__
  let initialStateJson = null;
  $('script').each((_, el) => {
    const scriptText = $(el).html() || '';
    const match = scriptText.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+)/s);
    if (match && match[1]) {
      // Убираем возможный мусор в конце
      let raw = match[1].replace(/;\s*window\..+$/s, '').trim();
      try {
        initialStateJson = JSON.parse(raw);
        console.log('[parser] Найден JSON в window.__INITIAL_STATE__');
        return false;
      } catch (e) {
        console.warn('[parser] Ошибка парсинга __INITIAL_STATE__:', e.message);
      }
    }
  });
  if (initialStateJson) return { source: 'initial-state', data: initialStateJson };

  // Вариант 3: ищем JSON с durationMs в любом script-теге
  let trackJson = null;
  $('script').each((_, el) => {
    const scriptText = $(el).html() || '';
    if (!scriptText.includes('durationMs')) return;

    // Ищем все JSON-объекты в тексте скрипта
    const matches = scriptText.matchAll(/\{[^{}]*"durationMs"\s*:\s*\d+[^{}]*\}/g);
    for (const m of matches) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj.durationMs && obj.title && obj.artists) {
          trackJson = obj;
          console.log('[parser] Найден объект трека в script-теге');
          return false;
        }
      } catch {}
    }
  });
  if (trackJson) return { source: 'script-tag', data: { track: trackJson } };

  // Вариант 4: ld+json
 // Вариант 4: ld+json (Schema.org MusicRecording)
let ldJsonResult = null;
$('script[type="application/ld+json"]').each((_, el) => {
  if (ldJsonResult) return; // уже нашли
  try {
    const raw = $(el).html();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    console.log('[parser] Найден JSON в ld+json, тип:', parsed['@type']);

    if (parsed['@type'] === 'MusicRecording') {
      const title = parsed.name;
      const duration = parsed.duration; // PT3M45S
      const artistRaw = parsed.byArtist;

      let artists = [];
      if (Array.isArray(artistRaw)) {
        artists = artistRaw.map(a => a.name).filter(Boolean);
      } else if (artistRaw?.name) {
        artists = [artistRaw.name];
      }

      let durationMs = 0;
      if (duration) {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const hours   = parseInt(match[1] || '0', 10);
          const minutes = parseInt(match[2] || '0', 10);
          const seconds = parseInt(match[3] || '0', 10);
          durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
        }
      }

      if (title && artists.length > 0) {
        console.log('[parser] MusicRecording:', title, '| ISO:', duration, '| ms:', durationMs);
        ldJsonResult = {
          source: 'ld+json',
          data: {
            track: {
              title,
              artists: artists.map(n => ({ name: n })),
              durationMs,
            }
          }
        };
      }
    }
  } catch (e) {
    console.warn('[parser] Ошибка парсинга ld+json:', e.message);
  }
});
if (ldJsonResult) return ldJsonResult;

  return null;
}

/**
 * Ищет данные трека в объекте из js-state / __INITIAL_STATE__
 * Структура может отличаться в зависимости от версии Яндекс.Музыки.
 * @param {object} data
 * @returns {{ title: string, artists: string[], durationMs: number }|null}
 */
function findTrackInStateData(data) {
  const results = [];

  function search(obj, depth = 0) {
    if (depth > 15 || !obj || typeof obj !== 'object') return;

    if (
      obj.title &&
      typeof obj.title === 'string' &&
      obj.durationMs &&
      typeof obj.durationMs === 'number' &&
      Array.isArray(obj.artists) &&
      obj.artists.length > 0
    ) {
      const artists = obj.artists
        .map(a => a.name || a.title || '')
        .filter(Boolean);

      if (artists.length > 0) {
        results.push({
          title: obj.title.trim(),
          artists,
          durationMs: obj.durationMs,
        });
      }
    }

    for (const key of Object.keys(obj)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      search(obj[key], depth + 1);
    }
  }

  search(data);

  // Берём результат с наибольшей длительностью (самый полный объект)
  if (results.length > 0) {
    return results.sort((a, b) => b.durationMs - a.durationMs)[0];
  }

  return null;
}

/**
 * Парсит мета-теги Open Graph как запасной вариант.
 * Яндекс.Музыка содержит og:title в формате "Исполнитель — Название"
 * и og:description может содержать длительность.
 * @param {string} html
 * @returns {{ title: string, artists: string[], durationMs: number }|null}
 */
function extractFromMetaTags(html) {
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription = $('meta[property="og:description"]').attr('content') || '';
  const pageTitle = $('title').text() || '';

  console.log('[parser] og:title =', ogTitle);
  console.log('[parser] og:description =', ogDescription);
  console.log('[parser] <title> =', pageTitle);

  let title = null;
  let artists = [];

  // og:title содержит только название трека
  if (ogTitle) {
    title = ogTitle.trim();
  }

  // og:description содержит "Исполнитель1, Исполнитель2 • Трек • Год"
  // Берём всё что до первого " • "
  if (ogDescription) {
    const beforeBullet = ogDescription.split('•')[0].trim();
    if (beforeBullet) {
      // Разбиваем по запятой — несколько исполнителей
      artists = beforeBullet
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);
    }
  }

  // Длительность ищем в тексте страницы
  let durationMs = 0;
  const durationMatch = (ogDescription + ' ' + pageTitle).match(/(\d{1,2}):(\d{2})/);
  if (durationMatch) {
    const minutes = parseInt(durationMatch[1], 10);
    const seconds = parseInt(durationMatch[2], 10);
    durationMs = (minutes * 60 + seconds) * 1000;
  }

  if (title && artists.length > 0) {
    return { title, artists, durationMs };
  }

  return null;
}

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

  const html = await fetchPage(url);

  const jsonResult = extractJsonFromHtml(html);

  if (jsonResult) {
    console.log('[parser] Источник JSON:', jsonResult.source);
    const trackData = findTrackInStateData(jsonResult.data);
    if (trackData) {
      console.log('[parser] Трек найден через JSON:', trackData.title, '| ms:', trackData.durationMs);
      return {
        title: trackData.title,
        artists: trackData.artists,
        durationMs: trackData.durationMs,
        duration: formatDuration(trackData.durationMs),
      };
    } else {
      console.log('[parser] JSON найден, но данные трека не извлечены');
    }
  }

  console.log('[parser] Пробуем мета-теги...');
  const metaData = extractFromMetaTags(html);
  if (metaData) {
    console.log('[parser] Трек найден через мета-теги:', metaData.title);
    return {
      title: metaData.title,
      artists: metaData.artists,
      durationMs: metaData.durationMs,
      duration: metaData.durationMs > 0 ? formatDuration(metaData.durationMs) : 'неизвестно',
    };
  }

  throw new Error(
    'Не удалось извлечь информацию о треке. ' +
    'Возможно, трек недоступен или формат страницы изменился.'
  );
}

module.exports = { getTrackInfo };
