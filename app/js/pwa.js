// Установка приложения на рабочий стол / домашний экран.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  notify();
});
addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const canInstall = () => !!deferred;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function install() {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
  deferred = null;
  notify();
  return r.outcome === 'accepted';
}

export function onInstallChange(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}
