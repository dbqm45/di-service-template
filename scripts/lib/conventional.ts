/**
 * Conventional Commits 1.0.0 and SemVer 2.0.0 helpers for check-commit-message.ts and release.ts. No dependencies;
 * the rules are spelled out in RELEASING.md. Ported from ShipScope's scripts/lib/conventional.js (which came from
 * ci_for_sdlc), with lowercase scopes and an English changelog only.
 */
export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'style', 'build', 'ci', 'chore', 'revert'];
const MAX_SUBJECT = 72;

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9._/-]*$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: \S/m;
// Messages git or GitHub write on their own; they never reach main as-is (squash merge) and are not linted.
const GENERATED = /^(Merge |Revert "|(fixup|squash|amend)! )/;

export type Bump = 'major' | 'minor' | 'patch';
interface Header {
  type: string;
  scope: string | undefined;
  breaking: boolean;
  subject: string;
}

const firstLine = (message: string): string => message.split('\n', 1)[0] ?? '';
const clean = (message: string): string => message.split('\n').filter((l) => !l.startsWith('#')).join('\n').replace(/^\s*\n/, '').trimEnd();

export function parseHeader(header: string): Header | null {
  const g = HEADER.exec(header.trim())?.groups;
  if (!g) return null;
  return { type: g.type ?? '', scope: g.scope, breaking: Boolean(g.bang), subject: g.subject ?? '' };
}

const isBreaking = (message: string): boolean => Boolean(parseHeader(firstLine(message))?.breaking) || BREAKING_FOOTER.test(message);

/** Problems with a commit message or PR title; an empty list means it follows Conventional Commits. */
export function lintMessage(raw: string): string[] {
  const message = clean(raw);
  if (!message) return ['the message is empty'];
  const header = firstLine(message);
  if (GENERATED.test(header)) return [];
  const parsed = parseHeader(header);
  if (!parsed) return [`"${header}" is not "<type>(<scope>)!: <description>" — e.g. "fix(api): reject an empty name"`];
  const problems: string[] = [];
  if (!TYPES.includes(parsed.type)) problems.push(`unknown type "${parsed.type}" — use one of: ${TYPES.join(', ')}`);
  if (parsed.scope !== undefined && !SCOPE.test(parsed.scope)) problems.push(`scope "${parsed.scope}" should be one lowercase word, e.g. api, db, deps`);
  const subject = parsed.subject.replace(/ \(#\d+\)$/, ''); // GitHub appends the PR number on squash merge
  if (!subject.trim()) problems.push('the description after ": " is empty');
  if (subject.length > MAX_SUBJECT) problems.push(`the description has ${subject.length} characters (max ${MAX_SUBJECT})`);
  if (/\.$/.test(subject)) problems.push('the description should not end with a period');
  const lines = message.split('\n');
  if (lines.length > 1 && lines[1]?.trim()) problems.push('leave an empty line between the header and the body');
  if (/^breaking[ -]change:/im.test(message) && !BREAKING_FOOTER.test(message)) problems.push('write the footer as "BREAKING CHANGE: <what and how to migrate>" (uppercase)');
  return problems;
}

/** The bump the commits call for: breaking → major, feat → minor, fix/perf → patch, otherwise none. */
export function bumpKind(messages: string[]): Bump | null {
  let kind: Bump | null = null;
  for (const message of messages) {
    if (isBreaking(message)) return 'major';
    const type = parseHeader(firstLine(message))?.type;
    if (type === 'feat') kind = 'minor';
    else if ((type === 'fix' || type === 'perf') && !kind) kind = 'patch';
  }
  return kind;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const isVersion = (v: string): boolean => VERSION.test(v);

export function bump(current: string, kind: Bump): string {
  const m = VERSION.exec(current);
  if (!m) throw new Error(`"${current}" is not a release version X.Y.Z`);
  const [major, minor, patch] = m.slice(1).map(Number) as [number, number, number];
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** In 0.y.z (SemVer rule 4) a breaking change bumps the minor, everything else the patch; 1.0.0 is never computed. */
export const nextVersion = (current: string, kind: Bump): string =>
  bump(current, current.startsWith('0.') ? (kind === 'major' ? 'minor' : 'patch') : kind);

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** A changelog entry built from the commits since the last tag. */
export function changelogEntry(version: string, date: string, messages: string[]): string {
  const sections: [string, (c: { message: string } & Partial<Header>) => boolean][] = [
    ['Breaking', (c) => isBreaking(c.message)],
    ['Added', (c) => c.type === 'feat'],
    ['Fixed', (c) => c.type === 'fix' || c.type === 'perf'],
  ];
  const commits = messages.map((message) => ({ message, ...parseHeader(firstLine(message)) }));
  const out = [`## [${version}] - ${date}`, ''];
  const used = new Set<object>();
  for (const [title, match] of sections) {
    const items = commits.filter((c) => c.type && !used.has(c) && match(c));
    if (!items.length) continue;
    items.forEach((c) => used.add(c));
    out.push(`### ${title}`, '', ...items.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject}`), '');
  }
  if (used.size === 0) out.push('No user-visible changes (documentation, tests, CI).', '');
  return out.join('\n');
}

/** Puts an entry above the first `## ` heading. */
export function insertEntry(changelog: string, entry: string): string {
  const first = changelog.search(/^## /m);
  if (first < 0) return `${changelog.trimEnd()}\n\n${entry}`;
  return `${changelog.slice(0, first)}${entry}\n${changelog.slice(first)}`;
}

/** The body of the changelog entry for `version`, or null. */
export function releaseNotes(changelog: string, version: string): string | null {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).filter((l) => !/^\[[^\]]+\]:\s/.test(l));
  return body.join('\n').trim() || null;
}
