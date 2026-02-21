import { describe, expect, it } from 'bun:test';
import { escapeUnicodeNoncharacters } from '../../scripts/build';

describe('build unicode sanitizer', () => {
  it('escapes basic multilingual plane noncharacters', () => {
    const input = `const payload = "start\uFDD0end";`;
    const rendered = escapeUnicodeNoncharacters(input);
    expect(rendered).toContain('\\uFDD0');
    expect(rendered).not.toContain('\uFDD0');
  });

  it('escapes supplementary-plane noncharacters', () => {
    const nonBmp = String.fromCodePoint(0x1fffe);
    const input = `const payload = "start${nonBmp}end";`;
    const rendered = escapeUnicodeNoncharacters(input);
    expect(rendered).toContain('\\uD83F\\uDFFE');
    expect(rendered).not.toContain(nonBmp);
  });
});
