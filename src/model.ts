// comptab — command model + builder.
// Turns a command into a (possibly nested) tree of options and subcommands by
// running its own `--help` (falling back to its man page), then recursing into
// each subcommand's `--help` up to a bounded depth. No curated spec, no LLM.

import { getHelp } from './help.js';
import { parseHelp, type CmdOption, type ParsedHelp } from './parser.js';

export interface CommandNode {
  /** Leaf token the user types, e.g. "git" at the root or "commit" for a sub. */
  name: string;
  /** One-line description (empty for the root). */
  description: string;
  options: CmdOption[];
  subcommands: CommandNode[];
}

export interface BuildOptions {
  /** How many levels of subcommands to descend. 0 = top-level only. Default 1. */
  depth?: number;
  /** Called with a human note for each command probed (for --verbose). */
  onProbe?: (path: string[], source: string) => void;
  /** Subcommand names to never probe (e.g. destructive verbs). */
  skip?: Set<string>;
}

// Subcommand names that are noise or that we must never execute to read help.
const DEFAULT_SKIP = new Set([
  'help',
  'completion',
  'completions',
]);

function dedupeSubs(subs: ParsedHelp['subcommands']): ParsedHelp['subcommands'] {
  const seen = new Set<string>();
  const out: ParsedHelp['subcommands'] = [];
  for (const s of subs) {
    if (!s.name || seen.has(s.name)) continue;
    // Ignore obvious non-command tokens the parser may have picked up.
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(s.name)) continue;
    seen.add(s.name);
    out.push(s);
  }
  return out;
}

/** Build the command tree for `cmd`, probing `--help` recursively. */
export async function buildTree(cmd: string, opts: BuildOptions = {}): Promise<CommandNode> {
  const depth = opts.depth ?? 1;
  const skip = opts.skip ?? DEFAULT_SKIP;

  async function probe(argv: string[], name: string, desc: string, level: number): Promise<CommandNode> {
    const extra = argv.slice(1);
    let parsed: ParsedHelp = { usage: [], options: [], subcommands: [] };
    try {
      const help = await getHelp(argv[0], extra);
      parsed = parseHelp(help.text);
      opts.onProbe?.(argv, help.source ?? 'help');
    } catch (e) {
      opts.onProbe?.(argv, 'unavailable');
    }

    const node: CommandNode = {
      name,
      description: desc,
      options: parsed.options,
      subcommands: [],
    };

    if (level < depth) {
      for (const sub of dedupeSubs(parsed.subcommands)) {
        if (skip.has(sub.name)) {
          node.subcommands.push({ name: sub.name, description: sub.description, options: [], subcommands: [] });
          continue;
        }
        const child = await probe([...argv, sub.name], sub.name, sub.description, level + 1);
        node.subcommands.push(child);
      }
    } else {
      // At max depth we still record subcommand names (for the leaf completion)
      // but do not descend into their flags.
      for (const sub of dedupeSubs(parsed.subcommands)) {
        node.subcommands.push({ name: sub.name, description: sub.description, options: [], subcommands: [] });
      }
    }
    return node;
  }

  return probe([cmd], cmd, '', 0);
}
