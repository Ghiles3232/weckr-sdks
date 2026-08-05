#!/usr/bin/env node
/**
 * Weekly price watcher (multi-target).
 *
 * Every hand-maintained price table in the codebase is a "target". The watcher
 * parses each one, diffs it against current published prices, and if anything
 * drifted it edits only the changed numbers and reports it. The GitHub Actions
 * workflow then opens a PR for a human to approve. Nothing is committed to a
 * price table without review.
 *
 * Reference prices come from a public, deterministic pricing dataset (LiteLLM's
 * model_prices_and_context_window.json): plain JSON, no API key, no model in the
 * loop, so no hallucinated numbers.
 *
 * Targets are described in a JSON config passed with --targets, e.g.
 *   [{ "file": "lib/caps.ts", "format": "caps-ts", "label": "billing" }]
 * Supported formats: caps-ts, sdk-ts, sdk-py, md-table.
 *
 * Single-file dry run (no network): supply reference prices from a file.
 *   node check.mjs --file /tmp/x.ts --format sdk-ts --source ref.json
 *
 * Reference-price JSON shape (normalized, USD per million tokens):
 *   { "gpt-5.4-mini": { "input": 0.75, "output": 4.5, "cachedInput": 0.075 } }
 * Only fields present are compared; models absent from the reference are left
 * untouched. Exit 0 always; the workflow keys off the `changed` GITHUB_OUTPUT.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const EPSILON = 1e-9;
const FIELDS = ['input', 'output', 'cachedInput', 'cacheWrite'];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TARGETS_FILE = arg('targets', null);
const SINGLE_FILE = arg('file', null);
const SINGLE_FORMAT = arg('format', 'caps-ts');
const SOURCE_FILE = arg('source', null);
const REPORT_FILE = arg('report', null);

// --------------------------------------------------------------------------
// Format adapters. Each exposes parse(text) -> { model: { field: number } } and
// edit(text, model, field, value) -> newText | null (null if it cannot safely
// locate the cell, which is then reported for manual handling).
// --------------------------------------------------------------------------

// Object-literal tables in TS/JS/PY. `keyQuote` is the quote char around model
// keys; `fieldNames` maps a normalized field to the file's actual field name;
// `endToken` closes the PRICING block so we never read a neighbouring object.
function objectAdapter({ keyQuote, fieldNames, endToken }) {
  const q = keyQuote;
  const modelRe = new RegExp(`${q}([^${q}]+)${q}:\\s*\\{([^}]*)\\}`, 'g');
  const fieldRe = (fname) =>
    keyQuote === '"'
      ? new RegExp(`"${fname}":\\s*([\\d.]+)`)
      : new RegExp(`\\b${fname}:\\s*([\\d.]+)`);

  function block(text) {
    const start = text.indexOf('PRICING');
    if (start === -1) return text;
    const open = text.indexOf('{', start);
    const end = text.indexOf(endToken, open);
    return end === -1 ? text.slice(open) : text.slice(open, end);
  }

  return {
    parse(text) {
      const out = {};
      const blk = block(text);
      let m;
      modelRe.lastIndex = 0;
      while ((m = modelRe.exec(blk))) {
        const [, model, body] = m;
        const entry = {};
        for (const f of FIELDS) {
          const fm = fieldRe(fieldNames[f]).exec(body);
          if (fm) entry[f] = Number(fm[1]);
        }
        out[model] = entry;
      }
      return out;
    },
    edit(text, model, field, value) {
      const lines = text.split('\n');
      const keyStr = `${q}${model}${q}:`;
      const fre = fieldRe(fieldNames[field]);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(keyStr) && fre.test(lines[i])) {
          lines[i] = lines[i].replace(fre, (mm, num) => mm.replace(num, String(value)));
          return lines.join('\n');
        }
      }
      return null;
    },
  };
}

// Markdown pipe tables. Header cells decide which column is which field; a row's
// first cell is the model. Values may carry a leading $.
function mdAdapter() {
  const fieldOfHeader = (h) => {
    const s = h.toLowerCase();
    if (s.includes('write')) return 'cacheWrite';
    if (s.includes('cache') || s.includes('cached')) return 'cachedInput';
    if (s.includes('output')) return 'output';
    if (s.includes('input')) return 'input';
    if (s.includes('model')) return 'model';
    return null;
  };
  const cells = (line) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());
  const num = (s) => {
    const v = Number(s.replace(/\$/g, '').trim());
    return Number.isFinite(v) ? v : undefined;
  };

  // Walk tables, returning [{ headerFields, rows: [{model, lineIndex, cellIndex{field}}] }]
  function tables(text) {
    const lines = text.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i])) continue;
      const header = cells(lines[i]).map(fieldOfHeader);
      if (!header.includes('model')) continue;
      // next line should be the --- separator
      if (!/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) continue;
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
        const c = cells(lines[j]);
        const modelIdx = header.indexOf('model');
        const model = c[modelIdx];
        if (!model) continue;
        rows.push({ model, lineIndex: j, cellsRaw: c });
      }
      result.push({ headerFields: header, rows });
      i = j;
    }
    return result;
  }

  return {
    parse(text) {
      const out = {};
      for (const t of tables(text)) {
        for (const row of t.rows) {
          const entry = {};
          t.headerFields.forEach((field, idx) => {
            if (!field || field === 'model') return;
            const v = num(row.cellsRaw[idx]);
            if (v !== undefined) entry[field] = v;
          });
          if (Object.keys(entry).length) out[row.model] = entry;
        }
      }
      return out;
    },
    edit(text, model, field, value) {
      const lines = text.split('\n');
      for (const t of tables(text)) {
        const idx = t.headerFields.indexOf(field);
        if (idx === -1) continue;
        for (const row of t.rows) {
          if (row.model !== model) continue;
          const line = lines[row.lineIndex];
          const c = cells(line);
          const oldStr = c[idx];
          const decimals = (oldStr.replace(/\$/g, '').split('.')[1] || '').length;
          const hasDollar = oldStr.includes('$');
          const formatted =
            (hasDollar ? '$' : '') + Number(value).toFixed(Math.max(decimals, decimals ? decimals : 2));
          // rebuild the row line preserving the leading/trailing pipe style
          const rebuilt = '| ' + c.map((cell, k) => (k === idx ? formatted : cell)).join(' | ') + ' |';
          lines[row.lineIndex] = rebuilt;
          return lines.join('\n');
        }
      }
      return null;
    },
  };
}

const ADAPTERS = {
  'caps-ts': objectAdapter({
    keyQuote: "'",
    endToken: '\n};',
    fieldNames: { input: 'input', output: 'output', cachedInput: 'cachedInput', cacheWrite: 'cacheWrite' },
  }),
  'sdk-ts': objectAdapter({
    keyQuote: "'",
    endToken: '\n};',
    fieldNames: {
      input: 'inputPerMillion',
      output: 'outputPerMillion',
      cachedInput: 'cachedInputPerMillion',
      cacheWrite: 'cacheWritePerMillion',
    },
  }),
  'sdk-py': objectAdapter({
    keyQuote: '"',
    endToken: '\n}',
    fieldNames: { input: 'input', output: 'output', cachedInput: 'cached_input', cacheWrite: 'cache_write' },
  }),
  'md-table': mdAdapter(),
};

// --------------------------------------------------------------------------
// Reference prices (deterministic dataset).
// --------------------------------------------------------------------------

const DATASET_URL =
  process.env.WECKR_PRICING_DATASET_URL ||
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

let referenceCache = null;
async function getReferencePrices(modelNames) {
  if (SOURCE_FILE) return JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
  if (referenceCache) return referenceCache;
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`pricing dataset fetch ${res.status}: ${DATASET_URL}`);
  const data = await res.json();
  const perM = (v) => (typeof v === 'number' ? Math.round(v * 1e6 * 1e6) / 1e6 : undefined);
  const out = {};
  for (const model of modelNames) {
    const key = [model, `moonshot/${model}`, `gemini/${model}`, `openai/${model}`].find((k) => data[k]);
    if (!key) continue;
    const e = data[key];
    const entry = {};
    const input = perM(e.input_cost_per_token);
    const output = perM(e.output_cost_per_token);
    const cachedInput = perM(e.cache_read_input_token_cost);
    const cacheWrite = perM(e.cache_creation_input_token_cost);
    if (input !== undefined) entry.input = input;
    if (output !== undefined) entry.output = output;
    if (cachedInput !== undefined) entry.cachedInput = cachedInput;
    if (cacheWrite !== undefined) entry.cacheWrite = cacheWrite;
    out[model] = entry;
  }
  referenceCache = out;
  return out;
}

// --------------------------------------------------------------------------
// Diff + apply per target.
// --------------------------------------------------------------------------

async function runTarget({ file, format, label }) {
  const adapter = ADAPTERS[format];
  if (!adapter) throw new Error(`unknown format: ${format}`);
  let text = readFileSync(file, 'utf8');
  const current = adapter.parse(text);
  const reference = await getReferencePrices(Object.keys(current));

  const changes = [];
  const skipped = [];
  for (const [model, refEntry] of Object.entries(reference)) {
    const cur = current[model];
    if (!cur) continue;
    if (model.endsWith('-latest')) continue; // alias pointer, not a canonical price
    for (const f of FIELDS) {
      // Only Anthropic has a cache-write premium Weckr models; ignore the
      // dataset's cache-write for other providers (some files carry a
      // placeholder that is not part of their cost math).
      if (f === 'cacheWrite' && !model.startsWith('claude')) continue;
      if (refEntry[f] === undefined || cur[f] === undefined) continue;
      if (Math.abs(refEntry[f] - cur[f]) <= EPSILON) continue;
      if (refEntry[f] === 0) continue; // dataset hole, never zero a price
      const next = adapter.edit(text, model, f, refEntry[f]);
      if (next === null) {
        skipped.push({ model, field: f, from: cur[f], to: refEntry[f] });
        continue;
      }
      text = next;
      changes.push({ model, field: f, from: cur[f], to: refEntry[f] });
    }
  }
  if (changes.length) writeFileSync(file, text);
  return { file, label: label || file, changes, skipped };
}

async function main() {
  const targets = TARGETS_FILE
    ? JSON.parse(readFileSync(TARGETS_FILE, 'utf8'))
    : [{ file: SINGLE_FILE || new URL('../../lib/caps.ts', import.meta.url).pathname, format: SINGLE_FORMAT, label: 'caps.ts' }];

  const results = [];
  for (const t of targets) results.push(await runTarget(t));

  const totalChanges = results.reduce((n, r) => n + r.changes.length, 0);
  const totalSkipped = results.reduce((n, r) => n + r.skipped.length, 0);
  const changed = totalChanges > 0;

  let report = '';
  for (const r of results) {
    if (!r.changes.length && !r.skipped.length) continue;
    report += `## ${r.label}\n\n`;
    if (r.changes.length) {
      report += '| Model | Field | Old | New |\n| --- | --- | --- | --- |\n';
      for (const c of r.changes) report += `| ${c.model} | ${c.field} | ${c.from} | ${c.to} |\n`;
    }
    if (r.skipped.length) {
      report += '\n_Could not auto-apply (handle manually):_\n';
      for (const s of r.skipped) report += `- ${s.model} ${s.field}: ${s.from} -> ${s.to}\n`;
    }
    report += '\n';
  }
  if (report) {
    report +=
      '> Auto-detected by the weekly price watcher from the public pricing dataset. ' +
      '**Confirm each number against the provider before merging** (the dataset can lag or err).\n';
  }
  if (REPORT_FILE && report) writeFileSync(REPORT_FILE, report);

  console.log(changed ? `Detected ${totalChanges} price change(s) across ${results.length} target(s).` : 'No price changes detected.');
  if (totalSkipped) console.log(`${totalSkipped} change(s) could not be auto-applied.`);
  if (report) console.log('\n' + report);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
}

main().catch((err) => {
  console.error('pricing-watch failed:', err.message);
  process.exit(1);
});
