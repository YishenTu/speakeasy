import { describe, expect, test } from 'bun:test';
import { createMessageListAutoScrollState } from '../../../../../src/chatpanel/features/messages/scroll-follow-state';

describe('message list auto-scroll state', () => {
  test('starts enabled, pauses immediately on upward scroll, and resumes near bottom', () => {
    const state = createMessageListAutoScrollState({ bottomThresholdPx: 12 });

    expect(state.shouldAutoScroll()).toBe(true);

    state.updateFromScroll({
      scrollTop: 400,
      clientHeight: 100,
      scrollHeight: 500,
    });
    expect(state.shouldAutoScroll()).toBe(true);

    state.updateFromScroll({
      scrollTop: 392,
      clientHeight: 100,
      scrollHeight: 500,
    });
    expect(state.shouldAutoScroll()).toBe(false);

    state.updateFromScroll({
      scrollTop: 392,
      clientHeight: 100,
      scrollHeight: 500,
    });
    expect(state.shouldAutoScroll()).toBe(true);
  });

  test('keeps auto-follow enabled when content grows without an upward user scroll', () => {
    const state = createMessageListAutoScrollState({ bottomThresholdPx: 12 });

    state.updateFromScroll({
      scrollTop: 400,
      clientHeight: 100,
      scrollHeight: 500,
    });
    expect(state.shouldAutoScroll()).toBe(true);

    state.updateFromScroll({
      scrollTop: 400,
      clientHeight: 100,
      scrollHeight: 560,
    });
    expect(state.shouldAutoScroll()).toBe(true);

    state.updateFromScroll({
      scrollTop: 399,
      clientHeight: 100,
      scrollHeight: 560,
    });
    expect(state.shouldAutoScroll()).toBe(false);
  });

  test('resumeAutoScroll re-enables auto-follow after user override', () => {
    const state = createMessageListAutoScrollState();

    state.updateFromScroll({
      scrollTop: 120,
      clientHeight: 120,
      scrollHeight: 500,
    });

    state.updateFromScroll({
      scrollTop: 10,
      clientHeight: 120,
      scrollHeight: 500,
    });
    expect(state.shouldAutoScroll()).toBe(false);

    state.resumeAutoScroll();
    expect(state.shouldAutoScroll()).toBe(true);
  });

  test('treats non-scrollable content as already at bottom', () => {
    const state = createMessageListAutoScrollState();

    state.updateFromScroll({
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 300,
    });

    expect(state.shouldAutoScroll()).toBe(true);
  });
});
