import { describe, it, expect } from 'vitest';
import { isAgentEvent } from '../src/events';

const VALID = [
  { type: 'run_started', runId: 'r1', agent: 'scout', task: 'find leads' },
  { type: 'progress', runId: 'r1', agent: 'scout', text: 'searching', done: 3, total: 10 },
  { type: 'draft_submitted', runId: 'r1', agent: 'quill', draftId: 'd1', kind: 'email', summary: 'First email' },
  { type: 'sentinel_result', draftId: 'd1', pass: false, reasons: ['no opt-out'] },
  { type: 'awaiting_approval', draftId: 'd1', agent: 'quill' },
  { type: 'approved', draftId: 'd1', mode: 'item' },
  { type: 'rejected', draftId: 'd1' },
  { type: 'sent', draftId: 'd1', channel: 'email' },
  { type: 'run_finished', runId: 'r1', agent: 'scout', status: 'ok', costUsd: 0.12 },
];

describe('isAgentEvent', () => {
  it.each(VALID)('accepts a valid $type', (e) => {
    expect(isAgentEvent(e)).toBe(true);
  });

  it('accepts progress without optional counters', () => {
    expect(isAgentEvent({ type: 'progress', runId: 'r1', agent: 'echo', text: 'reading' })).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(isAgentEvent({ type: 'exploded', runId: 'r1', agent: 'scout' })).toBe(false);
  });

  it('rejects an unknown agent', () => {
    expect(isAgentEvent({ type: 'run_started', runId: 'r1', agent: 'bob', task: 't' })).toBe(false);
  });

  it('rejects a missing draftId', () => {
    expect(isAgentEvent({ type: 'awaiting_approval', agent: 'quill' })).toBe(false);
    expect(isAgentEvent({ type: 'rejected' })).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    expect(isAgentEvent({ type: 'sent', draftId: 'd1', channel: 'fax' })).toBe(false);
  });

  it('rejects null, a string and other non-objects', () => {
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent('run_started')).toBe(false);
    expect(isAgentEvent(undefined)).toBe(false);
    expect(isAgentEvent(42)).toBe(false);
  });
});
