// comptab — public library API.
// Use programmatically to generate completions without the CLI.

export { parseHelp } from './parser.js';
export type { CmdOption, Subcommand, ParsedHelp } from './parser.js';
export { getHelp, getMan } from './help.js';
export { buildTree } from './model.js';
export type { CommandNode, BuildOptions } from './model.js';
export { generate, generateBash, generateZsh, generateFish } from './generate.js';
export type { Shell } from './generate.js';
