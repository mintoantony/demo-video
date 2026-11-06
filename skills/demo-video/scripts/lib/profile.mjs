// profile.mjs - the optional app profile (app.json): where the app runs, how to sign in and out, how to reset it.
// Convention: app.json sits NEXT TO THE WALKTHROUGH (or pass createRecorder({ profile: './app.json' })).
// Options given to createRecorder win over the profile. See app.example.json.
import fs from 'node:fs';
import path from 'node:path';
import { resolveScript } from './approval.mjs';

const ENVIRONMENTS = ['local', 'shared', 'production'];

export function profilePath(o) {
  if (o.profile === false) return null;
  if (o.profile) return path.resolve(o.profile);
  if (o.scriptPath) {
    try {
      const p = path.join(path.dirname(resolveScript(o.scriptPath)), 'app.json');
      if (fs.existsSync(p)) return p;
    } catch { /* no usable script path: no profile */ }
  }
  return null;
}

// Returns the options with the profile merged in, plus o.profileData / o.profileFile. Throws on a bad profile.
export function applyProfile(o) {
  const file = profilePath(o);
  if (!file) return o;
  let p;
  try { p = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`The app profile ${file} cannot be read: ${e.message}`); }
  if (p.environment && !ENVIRONMENTS.includes(p.environment)) {
    throw new Error(`The app profile ${file} has environment "${p.environment}"; use one of ${ENVIRONMENTS.join(', ')}.`);
  }
  const reset = p.reset && p.reset.command ? p.reset : null;
  return {
    ...o,
    profileData: p, profileFile: file,
    baseUrl: o.baseUrl || p.baseUrl || '',
    environment: o.environment || p.environment,
    resetCommand: o.resetCommand || (reset ? `${reset.command}${reset.cwd ? `  (run in ${reset.cwd})` : ''}${reset.limit ? `  (at most ${reset.limit} times)` : ''}` : undefined),
  };
}

const fill = (t, name) => String(t).replace(/\{name\}/g, name).replace(/\{env:(\w+)\}/g, (_m, v) => process.env[v] || '');

// Signs in with the profile's recipe. The page must already be on the sign-in page, unless the recipe gives a url.
export async function signInWith(profile, page, name, baseUrl) {
  const r = profile && profile.signIn;
  if (!r || !r.kind) throw new Error('rec.signIn needs a signIn recipe ("kind": "card" or "form") in the app profile (app.json).');
  if (r.url) await page.goto(/^https?:/i.test(r.url) || !baseUrl ? r.url : new URL(r.url, baseUrl).toString());
  if (r.kind === 'card') {
    await page.locator(fill(r.selector, name)).first().click({ timeout: 10000 });
  } else if (r.kind === 'form') {
    for (const [sel, val] of Object.entries(r.fields || {})) await page.locator(sel).first().fill(fill(val, name), { timeout: 10000 });
    await page.locator(r.submit).first().click({ timeout: 10000 });
  } else {
    throw new Error(`Unknown signIn kind "${r.kind}" in the app profile; use "card" or "form".`);
  }
  if (r.signedIn) await page.locator(r.signedIn).first().waitFor({ state: 'visible', timeout: 15000 });
}

export async function signOutWith(profile, page, baseUrl) {
  const r = profile && profile.signOut;
  if (!r || typeof r !== 'object' || !(r.selector || r.url)) throw new Error('rec.signOut needs a signOut recipe ({ "selector": ... } or { "url": ... }) in the app profile (app.json).');
  if (r.selector) await page.locator(r.selector).first().click({ timeout: 10000 });
  else await page.goto(/^https?:/i.test(r.url) || !baseUrl ? r.url : new URL(r.url, baseUrl).toString());
  if (r.signedOut) await page.locator(r.signedOut).first().waitFor({ state: 'visible', timeout: 15000 });
}

export const productionAllowed = () => process.env.DEMO_ALLOW_PRODUCTION === '1';
