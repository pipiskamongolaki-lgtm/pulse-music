// Настройки: внешний вид, полные треки через YouTube, установка, резервная копия.
import { h, icon } from '../util.js';
import * as store from '../store.js';
import { settings, setSettings } from '../store.js';
import { ACCENTS } from '../theme.js';
import * as yt from '../api/youtube.js';
import { canInstall, install, isIOS, isStandalone, onInstallChange } from '../pwa.js';
import { toast, confirmBox } from '../ui.js';

function toggle(on, onChange, label) {
  const b = h('button.toggle' + (on ? '.on' : ''), { role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', () => {
    const v = !b.classList.contains('on');
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

const rowEl = (title, sub, control) => h('div.set-row', h('div', h('b', title), sub ? h('small', sub) : null), control || null);

export default function settingsView(view, ctx) {
  view.append(h('div.page-head', h('h1', 'Настройки')));

  /* ---- внешний вид ---- */
  const swatches = h('div.swatches', Object.entries(ACCENTS).map(([k, a]) => {
    const s = h('button.swatch' + (settings.accent === k ? '.active' : ''), { title: a.name, 'aria-label': a.name, style: { '--a': a.a, '--b': a.b } });
    s.addEventListener('click', () => {
      setSettings({ accent: k });
      swatches.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === s));
    });
    return s;
  }));
  view.append(h('section.set-group',
    h('h2', 'Внешний вид'),
    rowEl('Тёмная тема', 'Светлая включится, если выключить', toggle(settings.theme !== 'light', (v) => setSettings({ theme: v ? 'dark' : 'light' }), 'Тёмная тема')),
    h('div.set-row', h('div', h('b', 'Акцентный цвет'), h('small', 'Кнопки, подсветка, градиенты')), swatches)));

  /* ---- полные треки ---- */
  const keyInput = h('input.field', { type: 'password', placeholder: 'Вставь ключ: AIza…', value: settings.ytKey || '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Ключ YouTube Data API' });
  const showB = h('button.btn.sm.ghost', { onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; showB.textContent = keyInput.type === 'password' ? 'Показать' : 'Скрыть'; } }, 'Показать');
  const status = h('div.status');
  const setStatus = (ok, text) => {
    status.className = 'status ' + (ok ? 'ok' : ok === false ? 'bad' : '');
    status.replaceChildren(ok ? icon('check', 'sm') : ok === false ? icon('info', 'sm') : '', text);
  };
  if (yt.hasKey()) setStatus(true, 'Ключ сохранён');
  const saveB = h('button.btn.primary.sm', {
    onclick: async () => {
      const key = keyInput.value.trim();
      setSettings({ ytKey: key });
      if (!key) {
        setStatus(null, 'Ключ удалён: хиты играют превью');
        return;
      }
      setStatus(null, 'Проверяю ключ…');
      try {
        await yt.testKey(key);
        setStatus(true, 'Готово! Хиты теперь играют целиком');
        toast('Полные треки включены');
      } catch (e) {
        setStatus(false, yt.explain(e) + '. Ключ сохранён, попробуй позже.');
      }
    },
  }, 'Сохранить');
  view.append(h('section.set-group',
    h('h2', 'Полные треки из чартов'),
    h('p.note', 'Каталог Deezer бесплатно даёт только 30 секунд. Чтобы хиты играли целиком, Pulse находит официальное видео трека и играет его во встроенном плеере YouTube (видео показывается на обложке). Для этого нужен бесплатный ключ YouTube Data API. Он хранится только в этом браузере.'),
    rowEl('Играть хиты целиком через YouTube', yt.hasKey() ? 'Когда выключено, играют 30-секундные превью' : 'Сначала добавь ключ ниже', toggle(settings.fullMode, (v) => setSettings({ fullMode: v }), 'Играть хиты целиком')),
    h('div.set-row', { style: { display: 'block' } },
      h('b', 'Ключ YouTube Data API'),
      h('div.key-row', { style: { marginTop: '10px' } }, keyInput, showB, saveB),
      h('div', { style: { marginTop: '8px' } }, status),
      h('details', { style: { marginTop: '12px' } },
        h('summary', { style: { cursor: 'pointer', fontWeight: '700', color: 'var(--accent)' } }, 'Как получить ключ (5 минут, бесплатно)'),
        h('ol.howto',
          h('li', 'Открой ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud Console'), ' и войди в свой Google-аккаунт.'),
          h('li', 'Создай проект: любое имя, например «pulse». Банковская карта не нужна.'),
          h('li', 'Открой ', h('a', { href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', target: '_blank', rel: 'noopener' }, 'YouTube Data API v3'), ' и нажми «Включить» (Enable).'),
          h('li', 'Перейди в ', h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Учётные данные'), ' → «Создать учётные данные» → «Ключ API».'),
          h('li', 'Скопируй ключ (начинается с AIza) и вставь сюда, нажми «Сохранить».'),
          h('li', 'Желательно ограничить ключ: в настройках ключа выбери «Ограничить ключ» → только YouTube Data API v3.')),
        h('p.note', 'Бесплатно Google даёт около 100 поисков новых треков в день. Найденные треки запоминаются и лимит больше не тратят. Если лимит кончится, до завтра будут играть превью. Если YouTube в твоей сети не открывается, полные версии тоже не заиграют.')))));

  /* ---- приложение ---- */
  const installRow = h('div');
  const renderInstall = () => {
    if (isStandalone()) installRow.replaceChildren(rowEl('Приложение установлено', 'Pulse открыт как отдельное приложение'));
    else if (canInstall()) installRow.replaceChildren(rowEl('Установить Pulse', 'Иконка на рабочем столе и в меню, своё окно без вкладок браузера', h('button.btn.primary.sm', { onclick: () => install() }, icon('install'), 'Установить')));
    else if (isIOS()) installRow.replaceChildren(rowEl('Установить на iPhone', 'В Safari нажми «Поделиться» → «На экран Домой»'));
    else installRow.replaceChildren(rowEl('Установить приложение', 'В Chrome или Edge: значок установки справа в адресной строке или меню ⋮ → «Установить Pulse»'));
  };
  renderInstall();
  ctx.onCleanup(onInstallChange(renderInstall));

  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try {
      store.importAll(JSON.parse(await f.text()));
      toast('Данные восстановлены');
    } catch (e) {
      toast('Не получилось: ' + e.message, 4000);
    }
  });
  view.append(h('section.set-group',
    h('h2', 'Приложение и данные'),
    installRow,
    rowEl('Резервная копия', 'Любимые, плейлисты, станции и история в одном файле. Твои аудиофайлы и ключ в неё не входят',
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        h('button.btn.sm', { onclick: exportBackup }, icon('download'), 'Сохранить'),
        h('button.btn.sm', { onclick: () => importInput.click() }, icon('upload'), 'Восстановить'),
        importInput)),
    rowEl('Очистить историю', 'Список прослушанного и «Ты часто слушаешь»',
      h('button.btn.sm.danger', { onclick: async () => { if (await confirmBox('Очистить историю?', 'Это нельзя отменить.', 'Очистить')) { store.clearHistory(); toast('История очищена'); } } }, 'Очистить')),
    rowEl('Сбросить подбор видео', 'Если трек играл не ту версию с YouTube, сбрось, и Pulse поищет заново',
      h('button.btn.sm', { onclick: () => { store.save('ytmap', {}); toast('Сброшено. Перезагружаю…'); setTimeout(() => location.reload(), 900); } }, 'Сбросить'))));

  /* ---- клавиши ---- */
  view.append(h('section.set-group.desktop-only',
    h('h2', 'Горячие клавиши'),
    ...[['Пробел', 'Играть / пауза'], ['Ctrl + → / ←', 'Следующий / предыдущий трек'], ['→ / ←', 'Перемотка на 5 секунд'], ['Ctrl + F', 'Поиск'], ['M', 'Выключить звук'], ['L', 'Нравится'], ['Esc', 'Свернуть плеер']]
      .map(([k, d]) => rowEl(d, null, h('span.badge', { style: { height: '24px', padding: '0 10px', fontSize: '12px' } }, k)))));

  /* ---- о приложении ---- */
  view.append(h('section.set-group',
    h('h2', 'О приложении'),
    h('p.note', 'Pulse — личный плеер. Музыка берётся только из легальных открытых источников: каталог и 30-секундные превью Deezer, полные треки Audius, официальный встроенный плеер YouTube, интернет-радио из каталога Radio Browser и твои собственные файлы. Тексты песен из открытой базы LRCLIB.'),
    h('p.note', 'Всё, что ты сохраняешь (любимые, плейлисты, файлы), хранится только в этом браузере на этом устройстве.')));
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pulse-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Файл резервной копии сохранён');
}
