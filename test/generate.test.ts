import { describe, it, expect } from 'vitest';
import { parseHelp } from '../src/parser.js';
import { generateBash, generateZsh, generateFish } from '../src/generate.js';
import type { CommandNode } from '../src/model.js';

function node(name: string, help: string, subs: CommandNode[] = []): CommandNode {
  const p = parseHelp(help);
  return { name, description: '', options: p.options, subcommands: subs.length ? subs : p.subcommands.map(s => ({ name: s.name, description: s.description, options: [], subcommands: [] })) };
}

const GIT_LIKE = `usage: tool [options] <command>

Options:
  -v, --verbose        be chatty
  -o, --output <file>  write to file
  --dry-run            do nothing

Commands:
  add        Add files
  commit     Record changes
`;

describe('fish', () => {
  const out = generateFish(node('tool', GIT_LIKE));
  it('emits complete lines with long and short flags', () => {
    expect(out).toContain('complete -c tool');
    expect(out).toContain('-l verbose');
    expect(out).toContain('-s v');
  });
  it('marks value-taking flags with -r', () => {
    const line = out.split('\n').find(l => l.includes('-l output'))!;
    expect(line).toContain('-r');
  });
  it('offers subcommands', () => {
    expect(out).toContain('-a add');
    expect(out).toContain('-a commit');
  });
  it('escapes single quotes in descriptions', () => {
    const o = generateFish(node('x', `Options:\n  --f  it's fine\n`));
    expect(o).toContain("\\'");
  });
});

describe('zsh', () => {
  it('emits compdef and _arguments for a flat command', () => {
    const out = generateZsh(node('flat', `Options:\n  -a, --all  everything\n`));
    expect(out).toMatch(/^#compdef flat/);
    expect(out).toContain('_arguments');
    expect(out).toContain('--all[everything]');
  });
  it('emits a subcommand dispatcher with _describe', () => {
    const out = generateZsh(node('tool', GIT_LIKE));
    expect(out).toContain('_describe');
    expect(out).toContain("'add:Add files'");
    expect(out).toContain('->cmds');
  });
});

describe('bash', () => {
  const out = generateBash(node('tool', GIT_LIKE));
  it('registers a complete -F function', () => {
    expect(out).toContain('complete -F _tool_comptab tool');
  });
  it('includes global flags and subcommands', () => {
    expect(out).toContain('--verbose');
    expect(out).toContain('subcommands="add commit"');
  });
});

describe('nested subcommand flags', () => {
  it('carries per-subcommand options into all three shells', () => {
    const add = node('add', `Options:\n  -p, --patch  interactive\n`);
    add.name = 'add';
    const root: CommandNode = { name: 'tool', description: '', options: [], subcommands: [add] };
    expect(generateFish(root)).toContain('-l patch');
    expect(generateZsh(root)).toContain('--patch');
    expect(generateBash(root)).toContain('--patch');
  });
});

const SSH_LIKE = `unknown option -- -
usage: ssh [-46AaCfGg] [-B bind_interface] [-c cipher_spec]
           [-i identity_file] [-J destination] destination [command]
`;

describe('usage-synopsis fallback (BSD-style tools with no OPTIONS section)', () => {
  const p = parseHelp(SSH_LIKE);
  it('mines bundled boolean short flags from the synopsis cluster', () => {
    const flat = p.options.flatMap((o) => o.flags);
    for (const f of ['-4', '-6', '-A', '-a', '-C', '-f', '-G', '-g']) {
      expect(flat).toContain(f);
    }
  });
  it('marks synopsis flags that take an argument', () => {
    const B = p.options.find((o) => o.flags.includes('-B'));
    const c = p.options.find((o) => o.flags.includes('-c'));
    expect(B?.arg).toBeTruthy();
    expect(c?.arg).toBeTruthy();
  });
  it('does not treat the trailing operand as a flag', () => {
    const flat = p.options.flatMap((o) => o.flags);
    expect(flat).not.toContain('destination');
    expect(flat).not.toContain('command');
  });
  it('generates valid-looking completions for all shells', () => {
    const n = node('ssh', SSH_LIKE);
    expect(generateFish(n)).toContain('complete -c ssh -s B -r');
    expect(generateBash(n)).toContain('_ssh_comptab');
    expect(generateZsh(n)).toContain('#compdef ssh');
  });
  it('does NOT override a real OPTIONS section', () => {
    // GIT_LIKE has a real Options section → fallback must stay dormant.
    const g = parseHelp(GIT_LIKE);
    expect(g.options.some((o) => o.flags.includes('--verbose'))).toBe(true);
    expect(g.options.length).toBeLessThan(6);
  });
});
