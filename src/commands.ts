export interface CommandSpec {
  name: string;
  description: string;
  args?: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: "login", description: "Log in with your API key" },
  { name: "logout", description: "Remove the saved API key" },
  { name: "model", description: "Choose a model", args: "[id]" },
  { name: "api", description: "Show API endpoint, key and connection status" },
  { name: "clear", description: "Clear the conversation and screen" },
  { name: "help", description: "Show commands and keyboard shortcuts" },
  { name: "exit", description: "Quit Unjailed" },
];

/** Commands matching what's typed after "/", prefix matches first. */
export function filterCommands(query: string): CommandSpec[] {
  const q = query.toLowerCase();
  if (!q) return COMMANDS;
  const prefix = COMMANDS.filter((c) => c.name.startsWith(q));
  const rest = COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q));
  return [...prefix, ...rest];
}

/** "/model glm" → { name: "model", arg: "glm" }; null if not a slash command. */
export function parseCommand(input: string): { name: string; arg: string } | null {
  const m = input.trim().match(/^\/(\S*)\s*([\s\S]*)$/);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), arg: m[2]!.trim() };
}
