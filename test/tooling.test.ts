import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bumpKind, changelogEntry, insertEntry, lintMessage, nextVersion, releaseNotes } from '../scripts/lib/conventional.ts';
import { readPin } from '../tools/sync-contract.ts';

test('Conventional Commits titles', () => {
  assert.deepEqual(lintMessage('feat(api): add the change list'), []);
  assert.deepEqual(lintMessage('fix: reject an empty name (#12)'), []);
  assert.match(lintMessage('Add stuff')[0] ?? '', /not "<type>/);
  assert.match(lintMessage('feat: end with a period.').join(), /period/);
  assert.match(lintMessage('feat(API): x').join(), /lowercase/);
  assert.match(lintMessage(`feat: ${'x'.repeat(73)}`).join(), /max 72/);
});

test('version bumps in 0.y.z and after 1.0.0', () => {
  assert.equal(bumpKind(['docs: x', 'fix: y']), 'patch');
  assert.equal(bumpKind(['feat: x', 'fix: y']), 'minor');
  assert.equal(bumpKind(['fix!: x']), 'major');
  assert.equal(bumpKind(['chore: x']), null);
  assert.equal(nextVersion('0.1.0', 'major'), '0.2.0');
  assert.equal(nextVersion('0.1.0', 'minor'), '0.1.1');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
});

test('changelog entry and release notes', () => {
  const entry = changelogEntry('0.2.0', '2026-11-23', ['feat(api): add x', 'fix: y', 'docs: z']);
  const changelog = insertEntry(readFileSync('CHANGELOG.md', 'utf8'), entry);
  assert.match(releaseNotes(changelog, '0.2.0') ?? '', /### Added\n\n- \*\*api:\*\* add x\n\n### Fixed\n\n- y/);
  assert.ok(releaseNotes(changelog, '0.1.0'));
});

test('the contract pin names di-contract and a version', () => {
  assert.deepEqual(readPin(), { repo: 'dbqm45/di-contract', version: '0.16.0' });
  const { version } = JSON.parse(readFileSync('contract/contract.json', 'utf8')) as { version: string };
  assert.equal(version, readPin().version);
});
