import { describe, expect, it } from 'bun:test';
import {
  filterSlashCommands,
  resolveSlashCommandText,
  validateSlashCommandDrafts,
} from '../../../src/shared/slash-commands';

describe('validateSlashCommandDrafts', () => {
  it('rejects invalid names, duplicates, and empty prompts', () => {
    expect(validateSlashCommandDrafts([{ name: 'release notes', prompt: 'Summarize' }])).toBe(
      'Slash command names must be a single token using letters, numbers, hyphens, or underscores.',
    );

    expect(
      validateSlashCommandDrafts([
        { name: 'summarize', prompt: 'First prompt' },
        { name: 'Summarize', prompt: 'Second prompt' },
      ]),
    ).toBe('Slash command names must be unique.');

    expect(validateSlashCommandDrafts([{ name: 'summarize', prompt: '   ' }])).toBe(
      'Slash command prompts cannot be empty.',
    );
  });

  it('accepts valid command drafts', () => {
    expect(
      validateSlashCommandDrafts([
        { name: 'summarize', prompt: 'Summarize this.' },
        { name: '/rewrite', prompt: 'Rewrite:\n\n$ARGUMENTS' },
      ]),
    ).toBeNull();
  });
});

describe('resolveSlashCommandText', () => {
  const commands = [
    { name: 'summarize', prompt: 'Summarize this carefully:\n\n$ARGUMENTS' },
    { name: 'rewrite', prompt: 'Rewrite the following in a clearer way.' },
  ];

  it('replaces the arguments placeholder when present', () => {
    expect(resolveSlashCommandText('/summarize release notes', commands)).toMatchObject({
      displayText: '/summarize release notes',
      resolvedText: 'Summarize this carefully:\n\nrelease notes',
      argumentText: 'release notes',
      command: commands[0],
    });
  });

  it('appends arguments when the prompt does not use a placeholder', () => {
    expect(resolveSlashCommandText('/rewrite draft paragraph', commands)).toMatchObject({
      displayText: '/rewrite draft paragraph',
      resolvedText: 'Rewrite the following in a clearer way.\n\ndraft paragraph',
      argumentText: 'draft paragraph',
      command: commands[1],
    });
  });

  it('passes unknown slash commands through unchanged', () => {
    expect(resolveSlashCommandText('/unknown draft paragraph', commands)).toMatchObject({
      displayText: '/unknown draft paragraph',
      resolvedText: '/unknown draft paragraph',
    });
  });
});

describe('filterSlashCommands', () => {
  it('filters by case-insensitive prefix while preserving order', () => {
    const commands = [
      { name: 'summarize', prompt: 'Summarize' },
      { name: 'rewrite', prompt: 'Rewrite' },
      { name: 'reply', prompt: 'Reply' },
    ];

    expect(filterSlashCommands(commands, 're')).toEqual([
      { name: 'rewrite', prompt: 'Rewrite' },
      { name: 'reply', prompt: 'Reply' },
    ]);
    expect(filterSlashCommands(commands, 'SUM')).toEqual([
      { name: 'summarize', prompt: 'Summarize' },
    ]);
  });
});
