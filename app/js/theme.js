// Тема и акцентный цвет.
import { settings } from './store.js';

export const ACCENTS = {
  violet: { name: 'Фиолетовый', a: '#8b5cf6', b: '#ec4899' },
  sunset: { name: 'Закат', a: '#f97316', b: '#f43f5e' },
  ocean: { name: 'Океан', a: '#38bdf8', b: '#6366f1' },
  lime: { name: 'Лайм', a: '#84cc16', b: '#10b981' },
  rose: { name: 'Розовый', a: '#f472b6', b: '#a855f7' },
  gold: { name: 'Золото', a: '#f59e0b', b: '#ef4444' },
};

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  const ac = ACCENTS[settings.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', ac.a);
  root.style.setProperty('--accent-2', ac.b);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === 'light' ? '#f4f4f8' : '#09090d';
}
