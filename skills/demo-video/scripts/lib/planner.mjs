// planner.mjs - plan mode: the same script runs against a stand-in page, nothing is recorded, storyboard.md is written.
import fs from 'node:fs';
import path from 'node:path';
import { mmss } from './util.mjs';
import { resolveScript, scriptHash } from './approval.mjs';

export function createPlanner(o, readMs) {
  const sp = o.scriptPath ? resolveScript(o.scriptPath) : null;
  const planDir = path.resolve(o.planDir || (sp ? path.dirname(sp) : '.'));
  const env = o.environment || 'unknown';
  const plan = { chapters: [], title: o.title };
  // A stand-in for the browser page: any call or property works and does nothing.
  const ghost = () => new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : ghost()),
    apply: () => ghost(),
  });
  const estimate = (steps) => {
    let sec = o.introMs / 1000;
    for (const s of steps) {
      sec += readMs(`${s.label} ${s.expect}`) / 1000 + 1.5 + Math.max(o.stepPause, readMs('RESULT: as expected - ' + s.expect)) / 1000;
    }
    return Math.round(sec);
  };
  const api = {
    mode: 'plan',
    async titleCard() { plan.hasTitle = true; },
    async closingCard() { plan.hasClosing = true; },
    async click() {}, async type() {},
    async chapter(title, optsOrFn, maybeFn) {
      const copts = typeof optsOrFn === 'function' ? {} : (optsOrFn || {});
      const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
      const ch = { title, actor: copts.actor || '', url: copts.url || '', fresh: !!copts.fresh, steps: [] };
      plan.chapters.push(ch);
      const step = async (label, expect, _action, _check, sopts = {}) => {
        ch.steps.push({ label, expect: expect || '', changesData: !!sopts.changesData, irreversible: !!sopts.irreversible });
      };
      await fn({ page: ghost(), step, rec: api, click: async () => {}, type: async () => {}, goto: async () => {}, settle: async () => {} });
    },
    async finish() {
      const md = storyboardMd(o, plan, env, estimate);
      fs.mkdirSync(planDir, { recursive: true });
      const file = path.join(planDir, 'storyboard.md');
      fs.writeFileSync(file, md);
      const total = plan.chapters.reduce((a, c) => a + estimate(c.steps), 0) + (plan.hasTitle ? o.cardMs / 1000 : 0) + (plan.hasClosing ? o.cardMs / 1000 : 0);
      api.result = { mode: 'plan', storyboard: file, scriptSha256: sp ? scriptHash(sp) : '', estimatedSeconds: Math.round(total), runDir: planDir, summary: { chapters: plan.chapters.length, steps: plan.chapters.reduce((a, c) => a + c.steps.length, 0) } };
      console.log(`Storyboard written: ${file}`);
      console.log(`Estimated length: about ${mmss(total)}. Nothing was recorded.`);
      return api.result;
    },
  };
  return api;
}

function storyboardMd(o, plan, env, estimate) {
  const mark = (s) => [s.irreversible ? 'IRREVERSIBLE' : '', s.changesData ? 'CHANGES DATA' : ''].filter(Boolean).join(', ');
  const total = plan.chapters.reduce((a, c) => a + estimate(c.steps), 0) + (plan.hasTitle ? o.cardMs / 1000 : 0) + (plan.hasClosing ? o.cardMs / 1000 : 0);
  const risky = plan.chapters.flatMap((c) => c.steps.filter((s) => s.changesData || s.irreversible).map((s) => ({ c: c.title, s })));
  const L = [
    `# Storyboard: ${o.title}`, '',
    'Nothing has been recorded yet. Please read this and say yes, or tell me what to change.', '',
    '## Where and how', '',
    `- Target URL: ${o.baseUrl || '(not set)'}`,
    `- Environment: ${env}${env === 'local' ? '' : '  (not local: needs your explicit OK)'}`,
    `- Reset command: ${o.resetCommand || 'none given'}`,
    `- Chapters: ${plan.chapters.length}, steps: ${plan.chapters.reduce((a, c) => a + c.steps.length, 0)}`,
    `- Estimated length: about ${mmss(total)} (${Math.round(total)} s)`, '',
    '## Steps that change data', '',
    ...(risky.length ? risky.map((r) => `- ${r.c} / ${r.s.label}: ${mark(r.s)}`) : ['None marked.']), '',
  ];
  plan.chapters.forEach((c, i) => {
    L.push(`## Chapter ${i + 1}: ${c.title}`, '',
      ...(c.actor ? [`- Acting as: ${c.actor}`] : []),
      `- Starts at: ${c.url || '(current page)'}${c.fresh ? ' (signed out first)' : ''}`,
      `- Estimated length: about ${estimate(c.steps)} s`, '',
      '| # | Action | Caption | You should see | Flag |', '|---|---|---|---|---|');
    c.steps.forEach((s, j) => {
      const cell = (t) => String(t).replace(/\|/g, '/').replace(/\n/g, ' ');
      L.push(`| ${j + 1} | ${cell(s.label)} | ${cell(s.label)} | ${cell(s.expect)} | ${mark(s) || '-'} |`);
    });
    L.push('');
  });
  L.push('## Open questions', '', ...((o.openQuestions && o.openQuestions.length) ? o.openQuestions.map((q) => `- ${q}`) : ['None.']), '');
  return L.join('\n');
}
