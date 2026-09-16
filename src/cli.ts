#!/usr/bin/env node
// comptab — generate bash/zsh/fish tab-completions for ANY CLI from its own
// `--help` (man-page fallback). Deterministic, dependency-free, offline.

import { readFileSync } from 'node:fs';
import { buildTree, type CommandNode } from './model.js';
import { parseHelp } from './parser.js';
import { generate, type Shell } from './generate.js';

const VERSION = '0.1.0';

const USAGE = `comptab v${VERSION} — tab-completions for any CLI, generated from its own --help

USAGE
  comptab <command> [--shell bash|zsh|fish] [--depth N]
  <command> --help | comptab --stdin --name <command> [--shell ...]

OPTIONS
  --shell <s>    bash | zsh | fish   (default: detected from $SHELL)
  --depth <N>    levels of subcommands to descend (default: 1, 0 = flags only)
  --stdin        read help text from stdin instead of running the command
  --name <cmd>   command name to use with --stdin
  --verbose      print which commands were probed (to stderr)
  -h, --help     show this help
  -v, --version  print version

EXAMPLES
  comptab git > ~/.config/fish/completions/git.fish
  comptab kubectl --shell zsh > ~/.zsh/completions/_kubectl
  eval "$(comptab docker --shell bash)"
  ./my-script.sh --help | comptab --stdin --name my-script.sh --shell bash

comptab is built and maintained by Esperanza Volkov, an autonomous AI agent.
Docs: https://github.com/esperanza-volkov/comptab`;

function detectShell(): Shell {
  const s = process.env.SHELL || '';
  if (s.includes('fish')) return 'fish';
  if (s.includes('zsh')) return 'zsh';
  return 'bash';
}

interface Args {
  command?: string;
  shell?: Shell;
  depth?: number;
  stdin?: boolean;
  name?: string;
  verbose?: boolean;
}

function parseArgs(argv: string[]): Args | 'help' | 'version' {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-h' || t === '--help') return 'help';
    if (t === '-v' || t === '--version') return 'version';
    else if (t === '--shell') a.shell = argv[++i] as Shell;
    else if (t === '--depth') a.depth = parseInt(argv[++i], 10);
    else if (t === '--stdin') a.stdin = true;
    else if (t === '--name') a.name = argv[++i];
    else if (t === '--verbose') a.verbose = true;
    else if (!t.startsWith('-') && !a.command) a.command = t;
  }
  return a;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') { console.log(USAGE); return; }
  if (parsed === 'version') { console.log(VERSION); return; }
  const args = parsed;

  const shell = args.shell ?? detectShell();
  if (!['bash', 'zsh', 'fish'].includes(shell)) {
    console.error(`comptab: unknown shell "${shell}" (expected bash, zsh, or fish)`);
    process.exit(2);
  }

  let root: CommandNode;

  if (args.stdin) {
    if (!args.name) {
      console.error('comptab: --stdin requires --name <command>');
      process.exit(2);
    }
    const text = readFileSync(0, 'utf8');
    const p = parseHelp(text);
    root = {
      name: args.name,
      description: '',
      options: p.options,
      subcommands: p.subcommands.map((s) => ({ name: s.name, description: s.description, options: [], subcommands: [] })),
    };
  } else {
    if (!args.command) { console.log(USAGE); return; }
    try {
      root = await buildTree(args.command, {
        depth: Number.isFinite(args.depth as number) ? args.depth : 1,
        onProbe: args.verbose ? (path, src) => console.error(`  probed: ${path.join(' ')}  (${src})`) : undefined,
      });
    } catch (e: any) {
      console.error(`comptab: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  if (!root.options.length && !root.subcommands.length) {
    console.error(`comptab: no options or subcommands found for "${root.name}". ` +
      `Its --help may be empty or in an unusual format.`);
    process.exit(1);
  }

  process.stdout.write(generate(root, shell));
}

main();
