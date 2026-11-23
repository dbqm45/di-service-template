import { readFileSync } from 'node:fs';

/**
 * The event envelope of the suite contract (`contract/event.schema.json`, the pinned copy in this repository):
 * id, type, occurred_at, source, contract_version, payload. This checks the envelope only; the payload of each type
 * is the service's business (validate it against `$defs` of the schema when the service handles that type).
 * The allowed types and sources come from the pinned contract, so a contract update needs no code change here.
 */
export interface Event {
  id: string;
  type: string;
  occurred_at: string;
  source: string;
  contract_version: string;
  payload: Record<string, unknown>;
}

export interface Vocabulary {
  types: string[];
  sources: string[];
  contractVersion: string;
}

const SCHEMA = new URL('../../contract/event.schema.json', import.meta.url);
const CONTRACT = new URL('../../contract/contract.json', import.meta.url);

/** Event types and sources the pinned contract allows. */
export function loadVocabulary(): Vocabulary {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { properties: { type: { enum: string[] }; source: { enum: string[] } } };
  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8')) as { version: string };
  return { types: schema.properties.type.enum, sources: schema.properties.source.enum, contractVersion: contract.version };
}

const FIELDS = ['id', 'type', 'occurred_at', 'source', 'contract_version', 'payload'];
const OCCURRED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Problems with the envelope; an empty list means it is a contract event. */
export function envelopeProblems(value: unknown, vocabulary: Vocabulary): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['the event is not a JSON object'];
  const e = value as Record<string, unknown>;
  const problems = FIELDS.filter((f) => !(f in e)).map((f) => `missing ${f}`);
  problems.push(...Object.keys(e).filter((k) => !FIELDS.includes(k)).map((k) => `unknown field ${k}`));
  if ('id' in e && (typeof e.id !== 'string' || !e.id || e.id.length > 200)) problems.push('id must be a non-empty string');
  if ('type' in e && !vocabulary.types.includes(e.type as string)) problems.push(`type ${String(e.type)} is not in the contract`);
  if ('source' in e && !vocabulary.sources.includes(e.source as string)) problems.push(`source ${String(e.source)} is not in the contract`);
  if ('occurred_at' in e && (typeof e.occurred_at !== 'string' || !OCCURRED_AT.test(e.occurred_at))) problems.push('occurred_at must be YYYY-MM-DDTHH:MM:SSZ');
  if ('contract_version' in e && (typeof e.contract_version !== 'string' || !VERSION.test(e.contract_version))) problems.push('contract_version must be X.Y.Z');
  if ('payload' in e && (typeof e.payload !== 'object' || e.payload === null || Array.isArray(e.payload))) problems.push('payload must be an object');
  return problems;
}
