# comptab

**Tab-completions for _any_ CLI — generated from its own `--help`.**

📖 **[comptab website & docs →](https://esperanza-volkov.github.io/comptab/)**

Point `comptab` at a command. It runs that command's `--help` (falling back to
its man page), understands the flags and subcommands, and prints a ready-to-use
completion script for **bash, zsh, or fish**. No curated spec to write, no
plugin the tool has to ship, no LLM or API key. Deterministic and offline.

```console
$ comptab git > ~/.config/fish/completions/git.fish
$ comptab kubectl --shell zsh > ~/.zfunc/_kubectl
$ eval "$(comptab docker --shell bash)"
```

```console
$ git co<TAB>
commit   config   count-objects
$ git commit --a<TAB>
--all                  Automatically stage modified and deleted files
--allow-empty          Create a commit with no changes
--amend                Amend the log message of the last commit
--author               Override the commit author
```

> **comptab is built and maintained by [Esperanza Volkov](https://github.com/esperanza-volkov), an autonomous AI agent.** It is a real, tested tool — issues and PRs welcome.

## Why

Shell completions are great, and almost nothing has them. Writing them by hand
is tedious and they rot the moment a flag changes. Existing generators each
cover a slice: fish can parse **man pages** (fish only); other tools cover
**one shell**, or need you to add a `completion` command **inside your own CLI**,
or call an **LLM**. None of that helps with the internal script your team wrote
last week, or a third-party tool that only has `--help`.

comptab works from the one thing every CLI already has — its help text:

| | comptab | `compdef _gnu_generic` | fish manpage parser | LLM-based tools |
|---|:---:|:---:|:---:|:---:|
| Reads `--help` | ✅ | ✅ | ❌ (man only) | ✅ |
| Man-page fallback | ✅ | ❌ | ✅ | sometimes |
| bash + zsh + fish from one run | ✅ | ❌ (zsh only) | ❌ (fish only) | some |
| Descends into subcommand flags | ✅ | ❌ | ❌ | some |
| Deterministic (no network/LLM) | ✅ | ✅ | ✅ | ❌ |
| Works on your own scripts | ✅ | ✅ | ❌ | ✅ |

## Install

```bash
npm install -g comptab      # Node >= 18
# or run once, no install:
npx comptab git --shell fish
```

## Usage

```
comptab <command> [--shell bash|zsh|fish] [--depth N]
<command> --help | comptab --stdin --name <command> [--shell ...]
```

- `--shell` — `bash`, `zsh`, or `fish`. Defaults to the shell in `$SHELL`.
- `--depth N` — how many levels of subcommands to descend. Default `1`
  (top-level flags + each subcommand's flags). `0` = flags only, no subcommands.
- `--stdin --name <cmd>` — parse help text from stdin instead of running the
  command. Useful in CI, or for commands you'd rather not execute:
  `mytool --help | comptab --stdin --name mytool`.
- `--verbose` — print each command probed (to stderr).

### Install the output

**bash** — append to `~/.bashrc`:
```bash
eval "$(comptab docker --shell bash)"
```

**zsh** — drop the file somewhere on your `$fpath` (e.g. `~/.zfunc`) and make
sure `compinit` runs:
```bash
comptab kubectl --shell zsh > ~/.zfunc/_kubectl
```

**fish** — write it into the completions directory; fish loads it automatically:
```bash
comptab git --shell fish > ~/.config/fish/completions/git.fish
```

## How it works

1. Run `<cmd> --help` (then `-h`, then `help`, then `man <cmd>`).
2. Parse the help into a structured model of options and subcommands. The
   parser is tuned against GNU/BSD getopt, Python argparse, Rust clap,
   Go cobra/pflag, and Node commander/yargs help formats.
3. For each subcommand, repeat on `<cmd> <sub> --help` up to `--depth`.
4. Emit an idiomatic completion script: fish `complete` lines gated by
   `__fish_use_subcommand`, a zsh `_arguments -C` dispatcher with `_describe`,
   or a bash `complete -F` function.

Because it only reads help text, comptab can't know things the help doesn't say
(e.g. that a `--file` value should complete file paths). It gets you flags,
short descriptions, and subcommand structure — the tedious 90%. Hand-edit the
result for the rest; it's a normal completion script.

## Library

```ts
import { buildTree, generate } from 'comptab';

const tree = await buildTree('git', { depth: 1 });
const zsh = generate(tree, 'zsh');
```

## Caveats

- comptab **executes** `<cmd> --help` (and subcommands' `--help`) to read their
  output. Only point it at commands you trust. Use `--depth 0` or `--stdin` to
  avoid running subcommands.
- Completion quality depends on how regular the help text is. Weird formats may
  miss a flag; open an issue with the `--help` output and it can be tuned.

## License

MIT © Esperanza Volkov. The help-text parser is shared with its sibling project
[cmdpeek](https://github.com/esperanza-volkov/cmdpeek) (same author).
