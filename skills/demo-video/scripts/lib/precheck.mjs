// precheck.mjs - scripted preconditions. rec.precheck(name, async ({ page }) => ({ ok, seen })) runs BEFORE
// the title card, in a separate context that is not recorded. By convention a precheck only reads.
// If any precheck fails, recording is refused before anything is recorded (no run folder is left behind).
import fs from 'node:fs';
import { firstLine } from './util.mjs';
import { signInWith, signOutWith } from './profile.mjs';

export async function runPrecheck(S, name, fn) {
  if (S.refused) return S.prechecks[S.prechecks.length - 1];
  if (S.chapters.length || S.clips.length || S.cur || S.curSeg) {
    throw new Error(`rec.precheck("${name}") must be called before the title card and the first chapter. Not recording.`);
  }
  const { o } = S;
  const ctx = await S.browser.newContext({ viewport: o.viewport, baseURL: o.baseUrl || undefined });
  const page = await ctx.newPage();
  const t0 = Date.now();
  let res;
  try {
    const r = await Promise.race([
      fn({
        page, rec: S.api,
        goto: (u) => page.goto(S.url(u)),
        signIn: (who) => signInWith(o.profileData, page, who, o.baseUrl),
        signOut: () => signOutWith(o.profileData, page, o.baseUrl),
      }),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('the precheck took more than 30 s')), 30000)),
    ]);
    res = { name, ok: !!(r && r.ok), seen: String((r && r.seen) ?? '') };
  } catch (e) {
    res = { name, ok: false, seen: `could not check: ${firstLine(e.message)}` };
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
  res.ms = Date.now() - t0;
  S.prechecks.push(res);
  S.log(`precheck ${res.ok ? 'OK' : 'FAILED'}: ${name} | ${res.seen}`);
  return res;
}

// Called at the first titleCard / chapter. Refuses (throws) when any precheck failed.
export async function gatePrechecks(S) {
  if (S.refused) throw S.refused;
  const bad = S.prechecks.filter((p) => !p.ok);
  if (!bad.length) return;
  const reset = S.o.resetCommand && !/^none/i.test(S.o.resetCommand) ? ` To put the data back, run the reset command: ${S.o.resetCommand}` : '';
  const err = new Error(`Precheck failed, so nothing was recorded. ${bad.map((p) => `"${p.name}": ${p.seen}`).join(' | ')}.${reset}`);
  err.prechecks = S.prechecks;
  S.refused = err;
  S.finished = true;
  try { await S.browser.close(); } catch { /* ignore */ }
  try { fs.rmSync(S.runDir, { recursive: true, force: true }); } catch { /* own folder only */ }
  throw err;
}
