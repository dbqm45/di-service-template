// Prepares a release: computes the next SemVer version from Conventional Commits since the last tag vX.Y.Z, sets it
// in package.json and package-lock.json and adds a CHANGELOG.md entry. It does not commit, tag or push: on main the
// Release workflow runs it with --ci after every merge (RELEASING.md). Run from the repository root.
//   npm run release                    # version from the commits
//   npm run release -- minor           # override: major | minor | patch | X.Y.Z (1.0.0 is always explicit)
//   npm run release -- --dry-run       # only print what would happen
//   npm run release -- --ci            # Release workflow: nothing to release is not an error
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { bump, bumpKind, changelogEntry, compareVersions, insertEntry, isVersion, nextVersion } from './lib/conventional.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ci = args.includes('--ci');
const wanted = args.find((a) => !a.startsWith('--'));

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { version: string };
const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

if (!dryRun && git('status', '--porcelain')) fail('the working tree has uncommitted changes — commit or stash them first');

const current = readJson('package.json').version;
const tags = git('tag', '--list', 'v*').split('\n').map((t) => t.slice(1)).filter(isVersion).sort(compareVersions);
const last = tags.at(-1);
if (!last) fail(`no tag vX.Y.Z yet — the first one (v${current}) is created on main by the Release workflow`);
if (last !== current) fail(`package.json has ${current}, the last tag is v${last} — release v${current} first (merge its PR)`);

const messages = git('log', '--format=%B%x00', `v${last}..HEAD`).split('\0').map((m) => m.trim()).filter(Boolean);
const kind = bumpKind(messages);

let version: string;
if (!wanted) {
  if (!kind && ci) {
    console.log(`No feat/fix/perf or breaking change since v${last} — nothing to release`);
    process.exit(0);
  }
  if (!kind) fail(`no feat/fix/perf or breaking change since v${last} — nothing to release (pass a version to force one)`);
  version = nextVersion(current, kind!);
} else if (wanted === 'major' || wanted === 'minor' || wanted === 'patch') {
  version = bump(current, wanted);
} else if (isVersion(wanted)) {
  version = wanted;
} else {
  version = fail(`"${wanted}" is neither major/minor/patch nor X.Y.Z`);
}
if (compareVersions(version, current) <= 0) fail(`${version} is not newer than ${current}`);

const entry = changelogEntry(version, new Date().toISOString().slice(0, 10), messages);
console.log(`${messages.length} commit(s) since v${last}${kind ? ` call for a ${kind} change` : ''} → ${version}\n\n${entry}`);
if (dryRun) process.exit(0);

writeJson('package.json', { ...readJson('package.json'), version });
const lock = readJson('package-lock.json') as { version: string; packages?: Record<string, { version?: string }> };
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
writeJson('package-lock.json', lock);
writeFileSync('CHANGELOG.md', insertEntry(readFileSync('CHANGELOG.md', 'utf8'), entry));
console.log(ci ? `✓ Version ${version} is set` : `✓ Version ${version} is set. Review CHANGELOG.md, commit "chore(release): ${version}" on a branch and open a PR.`);
