import { describe, expect, it } from 'bun:test';
import {
  getYouTubeUrlForPrompt,
  isYouTubeHostname,
} from '../../../../src/chatpanel/core/youtube-url';

describe('chatpanel youtube url helpers', () => {
  it('detects supported YouTube hostnames', () => {
    expect(isYouTubeHostname('youtube.com')).toBe(true);
    expect(isYouTubeHostname('www.youtube.com')).toBe(true);
    expect(isYouTubeHostname('m.youtube.com')).toBe(true);
    expect(isYouTubeHostname('music.youtube.com')).toBe(true);
    expect(isYouTubeHostname('youtu.be')).toBe(true);
    expect(isYouTubeHostname('example.com')).toBe(false);
  });

  it('normalizes YouTube URLs for prompt attachment and rejects other URLs', () => {
    expect(getYouTubeUrlForPrompt(' https://www.youtube.com/watch?v=abc123&t=9 ')).toBe(
      'https://www.youtube.com/watch?v=abc123&t=9',
    );
    expect(getYouTubeUrlForPrompt('https://youtu.be/abc123')).toBe('https://youtu.be/abc123');
    expect(getYouTubeUrlForPrompt('https://www.youtube.com/shorts/abc123')).toBe(
      'https://www.youtube.com/shorts/abc123',
    );
    expect(getYouTubeUrlForPrompt('https://www.youtube.com/live/abc123')).toBe(
      'https://www.youtube.com/live/abc123',
    );
    expect(getYouTubeUrlForPrompt('https://www.youtube.com/watch')).toBeNull();
    expect(
      getYouTubeUrlForPrompt('https://www.youtube.com/results?search_query=abc123'),
    ).toBeNull();
    expect(getYouTubeUrlForPrompt('https://www.youtube.com/@creator')).toBeNull();
    expect(getYouTubeUrlForPrompt('https://youtu.be/')).toBeNull();
    expect(getYouTubeUrlForPrompt('https://example.com/path')).toBeNull();
    expect(getYouTubeUrlForPrompt('')).toBeNull();
  });
});
