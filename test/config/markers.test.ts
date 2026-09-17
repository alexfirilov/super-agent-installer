import { describe, it, expect } from 'vitest';
import { setMarkerBlock, removeMarkerBlock, MarkerError, MARKER_STYLES } from '../../src/config/markers.js';
describe('marker blocks', () => {
  it('appends a block to text without one', () => {
    const out = setMarkerBlock('user line\n', 'managed', 'html');
    expect(out).toBe(`user line\n\n${MARKER_STYLES.html.start}\nmanaged\n${MARKER_STYLES.html.end}\n`);
  });
  it('replaces an existing block and keeps surrounding text', () => {
    const t = `a\n${MARKER_STYLES.hash.start}\nold\n${MARKER_STYLES.hash.end}\nb\n`;
    expect(setMarkerBlock(t, 'new', 'hash')).toBe(`a\n${MARKER_STYLES.hash.start}\nnew\n${MARKER_STYLES.hash.end}\nb\n`);
    expect(setMarkerBlock(setMarkerBlock(t, 'new', 'hash'), 'new', 'hash')).toBe(setMarkerBlock(t, 'new', 'hash'));
  });
  it('removes a block', () => { expect(removeMarkerBlock(`a\n${MARKER_STYLES.hash.start}\nx\n${MARKER_STYLES.hash.end}\nb\n`, 'hash')).toBe('a\nb\n'); });
  it('throws on half markers', () => { expect(() => setMarkerBlock(`${MARKER_STYLES.hash.start}\nx\n`, 'y', 'hash')).toThrow(MarkerError); });
  it('handles CRLF input by normalizing to LF', () => { expect(setMarkerBlock('a\r\n', 'x', 'html')).not.toContain('\r'); });
});
