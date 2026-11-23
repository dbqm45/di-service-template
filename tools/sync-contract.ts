/**
 * contract/ is a pinned copy of the suite contract (dbqm45/di-contract), never edited here. Same tool as pdi's
 * tools/sync_contract.py, in TypeScript for Node services.
 *
 *   node tools/sync-contract.ts sync  [--source DIR]   # replace contract/ with contract/ of the pinned tag
 *   node tools/sync-contract.ts check [--source DIR]   # compare file by file; exit 1 with the differences
 *
 * --source DIR: a local contract/ directory instead of cloning the tag (tests, offline work). Updating: change
 * "version" in tools/contract-pin.json, run sync, run the tests, open a PR. Exit code: 0 consistent or written,
 * 1 differs, 2 bad pin or the tag could not be fetched. Node standard library and git only.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const PIN = join(ROOT, 'tools', 'contract-pin.json');
const TARGET = join(ROOT, 'contract');

export function readPin(path = PIN): { repo: string; version: string } {
  const pin = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const keys = Object.keys(pin).sort().join(',');
  if (keys !== 'repo,version') throw new Error('the pin has exactly two keys: repo and version');
  if (typeof pin.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(pin.repo)) throw new Error('repo is owner/name');
  if (typeof pin.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin.version)) throw new Error('version is X.Y.Z');
  return { repo: pin.repo, version: pin.version };
}

const files = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split('\\').join('/'));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
};

export function differences(source: string, target = TARGET): string[] {
  const want = new Set(files(source));
  const have = new Set(files(target));
  const out = [...want].filter((f) => !have.has(f)).map((f) => `missing: contract/${f}`);
  out.push(...[...have].filter((f) => !want.has(f)).map((f) => `not in the contract: contract/${f}`));
  out.push(...[...want].filter((f) => have.has(f) && !readFileSync(join(source, f)).equals(readFileSync(join(target, f)))).map((f) => `differs: contract/${f}`));
  return out;
}

function run(cmd: string, source: string, label: string): number {
  if (!existsSync(join(source, 'contract.json'))) {
    console.log(`✗ ${label}: no contract.json there`);
    return 2;
  }
  if (cmd === 'sync') {
    rmSync(TARGET, { recursive: true, force: true });
    cpSync(source, TARGET, { recursive: true });
    console.log(`✓ contract/ written from ${label}`);
    return 0;
  }
  const diff = differences(source);
  if (diff.length) {
    console.log(`✗ contract/ differs from ${label} — do not edit it here (the source is the pinned repo); run sync:`);
    console.log(diff.map((d) => `  - ${d}`).join('\n'));
    return 1;
  }
  console.log(`✓ contract/ matches ${label}`);
  return 0;
}

function main(argv: string[]): number {
  const [cmd, flag, dir] = argv;
  if (cmd !== 'sync' && cmd !== 'check') {
    console.log('usage: node tools/sync-contract.ts sync|check [--source DIR]');
    return 2;
  }
  let pin;
  try {
    pin = readPin();
  } catch (err) {
    console.log(`✗ tools/contract-pin.json: ${(err as Error).message}`);
    return 2;
  }
  if (flag === '--source' && dir) return run(cmd, resolve(dir), dir);
  const tag = `contract-v${pin.version}`;
  const label = `tag ${tag} in ${pin.repo}`;
  const tmp = mkdtempSync(join(tmpdir(), 'contract-'));
  try {
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', tag, `https://github.com/${pin.repo}.git`, tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? '').trim().split('\n').at(-1);
    console.log(`✗ could not fetch ${label}: ${stderr || 'git failed'}`);
    rmSync(tmp, { recursive: true, force: true });
    return 2;
  }
  try {
    return run(cmd, join(tmp, 'contract'), label);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
