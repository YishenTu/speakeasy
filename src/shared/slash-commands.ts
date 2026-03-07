export interface SlashCommandDefinition {
  name: string;
  prompt: string;
}

export interface ResolvedSlashCommandText {
  rawText: string;
  displayText: string;
  resolvedText: string;
  command?: SlashCommandDefinition;
  argumentText?: string;
}

const SLASH_COMMAND_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const SLASH_COMMAND_ARGUMENTS_TOKEN = '$ARGUMENTS';

export function normalizeSlashCommandName(rawName: string): string {
  return rawName.trim().replace(/^\/+/, '');
}

export function isValidSlashCommandName(name: string): boolean {
  return SLASH_COMMAND_NAME_PATTERN.test(normalizeSlashCommandName(name));
}

export function sanitizeSlashCommands(value: unknown): SlashCommandDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands: SlashCommandDefinition[] = [];
  const seenNames = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = normalizeSlashCommandName(typeof record.name === 'string' ? record.name : '');
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
    if (!name || !prompt || !isValidSlashCommandName(name)) {
      continue;
    }

    const lookupName = name.toLowerCase();
    if (seenNames.has(lookupName)) {
      continue;
    }

    seenNames.add(lookupName);
    commands.push({ name, prompt });
  }

  return commands;
}

export function validateSlashCommandDrafts(
  drafts: ReadonlyArray<Pick<SlashCommandDefinition, 'name' | 'prompt'>>,
): string | null {
  const seenNames = new Set<string>();
  for (const draft of drafts) {
    const name = normalizeSlashCommandName(draft.name);
    const prompt = draft.prompt.trim();

    if (!name && !prompt) {
      continue;
    }

    if (!name) {
      return 'Slash command names are required.';
    }
    if (!isValidSlashCommandName(name)) {
      return 'Slash command names must be a single token using letters, numbers, hyphens, or underscores.';
    }
    if (!prompt) {
      return 'Slash command prompts cannot be empty.';
    }

    const lookupName = name.toLowerCase();
    if (seenNames.has(lookupName)) {
      return 'Slash command names must be unique.';
    }
    seenNames.add(lookupName);
  }

  return null;
}

export function filterSlashCommands(
  commands: readonly SlashCommandDefinition[],
  query: string,
): SlashCommandDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...commands];
  }

  return commands.filter((command) => command.name.toLowerCase().startsWith(normalizedQuery));
}

export function resolveSlashCommandText(
  rawText: string,
  commands: readonly SlashCommandDefinition[],
): ResolvedSlashCommandText {
  const normalizedRawText = rawText.trim();
  const invocation = parseSlashCommandInvocation(normalizedRawText);
  const command = invocation ? findSlashCommand(commands, invocation.name) : undefined;
  if (!invocation || !command) {
    return {
      rawText: normalizedRawText,
      displayText: normalizedRawText,
      resolvedText: normalizedRawText,
    };
  }

  const argumentText = invocation.argumentText;
  const resolvedText = command.prompt.includes(SLASH_COMMAND_ARGUMENTS_TOKEN)
    ? command.prompt.split(SLASH_COMMAND_ARGUMENTS_TOKEN).join(argumentText)
    : argumentText
      ? `${command.prompt}\n\n${argumentText}`
      : command.prompt;

  return {
    rawText: normalizedRawText,
    displayText: normalizedRawText,
    resolvedText,
    command,
    argumentText,
  };
}

function parseSlashCommandInvocation(
  rawText: string,
): { name: string; argumentText: string } | null {
  if (!rawText.startsWith('/')) {
    return null;
  }

  const remainder = rawText.slice(1);
  if (!remainder) {
    return null;
  }

  const whitespaceIndex = remainder.search(/\s/);
  const name =
    whitespaceIndex === -1
      ? normalizeSlashCommandName(remainder)
      : remainder.slice(0, whitespaceIndex).trim();
  if (!name) {
    return null;
  }

  const argumentText = whitespaceIndex === -1 ? '' : remainder.slice(whitespaceIndex).trim();
  return { name, argumentText };
}

function findSlashCommand(
  commands: readonly SlashCommandDefinition[],
  name: string,
): SlashCommandDefinition | undefined {
  const normalizedName = normalizeSlashCommandName(name).toLowerCase();
  return commands.find((command) => command.name.toLowerCase() === normalizedName);
}
