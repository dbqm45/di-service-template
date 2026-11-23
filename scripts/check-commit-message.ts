// Checks a commit message or a PR title against Conventional Commits (RELEASING.md).
//   node scripts/check-commit-message.ts "feat(api): add the change list"     # a title
//   node scripts/check-commit-message.ts --file .git/COMMIT_EDITMSG           # the commit-msg hook
import { readFileSync } from 'node:fs';
import { TYPES, lintMessage } from './lib/conventional.ts';

const args = process.argv.slice(2);
const fileAt = args.indexOf('--file');
const message = fileAt >= 0 ? readFileSync(args[fileAt + 1] ?? '', 'utf8') : args.join(' ');
const problems = lintMessage(message);
if (problems.length) {
  console.error(`✗ Not a Conventional Commit:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  console.error(`\n  Format: <type>(<scope>)!: <description>   types: ${TYPES.join(', ')}`);
  process.exit(1);
}
console.log('✓ Conventional Commit');
