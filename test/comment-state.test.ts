import { describe, expect, it } from 'vitest';
import {
  commentMarker,
  emptyState,
  failSuite,
  finishHead,
  finishSuite,
  parseState,
  renderComment,
  renderCommentWithinLimit,
  startHead,
  startSuite,
} from '../src/comment-state.js';
import { report } from './helpers.js';

const A = 'aaaa111111111111';
const B = 'bbbb222222222222';
const run = 'https://github.com/o/r/actions/runs/1';

describe('comment state', () => {
  it('shows a loading comment, then results', () => {
    const state = emptyState();
    startSuite(state, 'default', A, run);
    const loading = renderComment(state);
    expect(loading.startsWith(commentMarker)).toBe(true);
    expect(loading).toContain('⏳ Running benchmarks for `aaaa111`');
    expect(loading).toContain('### ⏳ Running…');

    expect(finishSuite(state, report(true, A), run)).toBe(true);
    const done = renderComment(state);
    expect(done).toContain('Results for `aaaa111`');
    expect(done).toContain('### 🔴 1 regression');
    expect(done).toContain('| 🔴 | slow |');
    expect(done).toContain('[View history](https://example.github.io/repo/)');
  });

  it('round-trips through the comment body', () => {
    const state = emptyState();
    startSuite(state, 'dart', A, run);
    finishSuite(state, report(true, A, 'dart'), run);
    expect(parseState(renderComment(state))).toEqual(state);
    expect(parseState('no state')).toEqual(emptyState());
    expect(parseState('<!-- benchmark-action:state:bm9wZQ== -->')).toEqual(emptyState());
  });

  it('rejects tampered state', () => {
    const state = emptyState();
    finishSuite(state, report(true, A), run);
    state.head!.runUrl = 'javascript:alert(1)';
    expect(parseState(renderComment(state))).toEqual(emptyState());
  });

  it('keeps one section per suite and shows the previous results while re-running', () => {
    const state = emptyState();
    finishSuite(state, report(true, A, 'dart'), run);
    finishSuite(state, report(true, A, 'node'), run);
    startSuite(state, 'dart', B, run);
    const body = renderComment(state);
    expect(body).toContain('⏳ Running benchmarks for `bbbb222`');
    expect(body).toContain('### **dart**: ⏳ Running…');
    // node has not started for the new commit yet, so it is running too.
    expect(body).toContain('### **node**: ⏳ Running…');
    expect(body.match(/Previous results for `aaaa111`/g)).toHaveLength(2);
  });

  it('ignores results for an outdated commit', () => {
    const state = emptyState();
    startSuite(state, 'default', B, run);
    expect(finishSuite(state, report(true, A), run)).toBe(false);
    expect(failSuite(state, 'default', A, 'boom')).toBe(false);
    expect(state.suites.default.status).toBe('running');
  });

  it('reports failures and suites that never reported', () => {
    const state = emptyState();
    startSuite(state, 'dart', A, run);
    startSuite(state, 'node', A, run);
    failSuite(state, 'dart', A, 'Benchmark command exited with code 1.', run);
    finishHead(state, A, 'failure', run);
    const body = renderComment(state);
    expect(body).toContain('### **dart**: ❌ Failed');
    expect(body).toContain('exited with code 1.');
    expect(body).toContain('### **node**: ❌ Failed');
    expect(body).toContain('ended \\(failure\\) without reporting results');
  });

  it('drops suites that were not part of the finished run', () => {
    const state = emptyState();
    finishSuite(state, report(true, A, 'node'), run);
    startSuite(state, 'node-instructions', B, run);
    expect(renderComment(state)).toContain('### **node**: ⏳ Running…');
    finishSuite(state, report(true, B, 'node-instructions'), run);
    finishHead(state, B, 'success', run);
    const body = renderComment(state);
    expect(body).not.toContain('**node**:');
    expect(body).toContain('### **node-instructions**:');
    expect(body).toContain('Results for `bbbb222`');
  });

  it('shows a generic loading message before any suite starts', () => {
    const state = emptyState();
    startHead(state, A, run);
    expect(renderComment(state)).toContain('⏳ Running benchmarks for `aaaa111`');
  });

  it('stays under the comment size limit', () => {
    const big = report(true, A);
    big.rows = Array.from({ length: 3000 }, (_, i) => ({
      name: `benchmark ${i}`,
      unit: 'us',
      lowerIsBetter: true,
      base: 1,
      current: 1,
      changePercent: 0,
      status: 'unchanged' as const,
    }));
    const state = emptyState();
    finishSuite(state, big, run);
    const body = renderCommentWithinLimit(state);
    expect(body.length).toBeLessThan(65536);
    expect(parseState(body).suites.default.status).toBe('done');
  });
});
