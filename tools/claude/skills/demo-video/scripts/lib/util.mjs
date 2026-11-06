// util.mjs - small helpers shared by the engine modules.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pad2 = (n) => String(n).padStart(2, '0');
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clip';
export const mmss = (sec) => `${pad2(Math.floor(sec / 60))}:${pad2(Math.floor(sec % 60))}`;
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 300);

export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}


export const words = (t) => (String(t ?? '').match(/\S+/g) || []).length;

// Rejects if p does not settle within ms. Used for cosmetic page calls that must never hang a run.
export function within(ms, p) {
  let t;
  return Promise.race([p, new Promise((_r, rej) => { t = setTimeout(() => rej(new Error('timed out')), ms); })]).finally(() => clearTimeout(t));
}
