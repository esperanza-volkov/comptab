// comptab — help-text parser (shared with cmdpeek, same author, MIT).
// Turns a command's --help output into a structured model of options and
// subcommands. Empirically tuned against GNU/BSD getopt, Python argparse,
// Rust clap, Go cobra/pflag, and Node commander/yargs help formats.

export interface CmdOption {
  /** Every flag alias for this option, e.g. ["-a", "--all"]. */
  flags: string[];
  /** Argument placeholder if the option takes a value, e.g. "<file>" or "N". */
  arg: string | null;
  /** How the value attaches: "space" → `--flag val`; "equals" → `--flag=val`. */
  argStyle?: 'space' | 'equals';
  /** Human description (may be joined from continuation lines). */
  description: string;
}

export interface Subcommand {
  name: string;
  description: string;
}

export interface ParsedHelp {
  usage: string[];
  options: CmdOption[];
  subcommands: Subcommand[];
}

// An option line begins with 1..10 leading spaces then a dash-flag.
// Handles:  "-x, --xxx  desc" | "--xxx=VAL  desc" | "-x VAL  desc" | "--xxx <val>  desc"
const OPT_RE =
  /^(\s{1,10})(-[-A-Za-z0-9][^\s,]*(?:(?:,\s*|\s+)-[-A-Za-z0-9][^\s,]*)*)(.*)$/;
// Same but allows column-0 flags (used only inside a detected options section,
// e.g. Python argparse-less tools that print "-b     : desc" at column 0).
const OPT_RE0 =
  /^(\s{0,10})(-[-A-Za-z0-9][^\s,]*(?:(?:,\s*|\s+)-[-A-Za-z0-9][^\s,]*)*)(.*)$/;

const SECTION_OPTIONS =
  /^(options|flags|optional arguments|positional arguments|arguments|global flags|general options)\b/i;
const SECTION_COMMANDS =
  /^(commands|subcommands|available commands|management commands|core commands)\b/i;
const SECTION_USAGE = /^(usage|synopsis)\b/i;

function splitFlagsAndDesc(rest: string): { flagPart: string; desc: string } {
  // `rest` is the flags blob + arg hint + description mixed together.
  // Separate on the first run of >=2 spaces (the classic help column gap).
  const gap = rest.search(/\s{2,}/);
  let flagPart: string;
  let desc: string;
  if (gap !== -1) {
    flagPart = rest.slice(0, gap).trim();
    desc = rest.slice(gap).trim();
  } else {
    // No column gap. Some tools (Python) use "-c cmd : description" with only
    // single spaces — fall back to splitting on a " : " separator.
    const colon = rest.search(/\s:\s/);
    if (colon !== -1) { flagPart = rest.slice(0, colon).trim(); desc = rest.slice(colon + 2).trim(); }
    else { flagPart = rest.trim(); desc = ''; }
  }
  // Strip a leading colon left over from "-b     : description" style.
  desc = desc.replace(/^:\s*/, '');
  return { flagPart, desc };
}

function extractFlags(flagBlob: string): {
  flags: string[];
  arg: string | null;
  argStyle: 'space' | 'equals';
} {
  const flags: string[] = [];
  let arg: string | null = null;
  let argStyle: 'space' | 'equals' = 'space';
  // Tokenise on commas and whitespace but keep <..> and [..] together.
  const tokens = flagBlob.match(/<[^>]+>|\[[^\]]+\]|[^\s,]+/g) || [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;
    if (/^[-]{1,2}/.test(tok)) {
      // Forms: "--name", "-n", "--name=VALUE", "--name[=VALUE]", "--name[=WHEN]".
      const eq = tok.match(
        /^(-{1,2}[A-Za-z0-9?][A-Za-z0-9?-]*)(\[=[^\]]*\]|=\S*|[=\s].*)?$/,
      );
      if (eq) {
        flags.push(eq[1]);
        if (eq[2]) {
          const rawArg = eq[2];
          // "=VAL" or "[=VAL]" → equals-attached; " VAL" → space-attached.
          if (/^\[?=/.test(rawArg)) argStyle = 'equals';
          const a = rawArg
            .replace(/^\[?=?\s*/, '')
            .replace(/\]$/, '')
            .trim();
          if (a) arg = a;
        }
      }
    } else if (!tok.startsWith(':')) {
      // Any non-flag token left in the flags column is the value placeholder
      // (e.g. <file>, [DIR], FILE, cmd, mod). Description was already split off.
      arg = tok;
    }
  }
  return { flags, arg, argStyle };
}

// Split a line into balanced top-level bracket groups: "[-a] [-b <v>]" → ["-a","-b <v>"].
function bracketGroups(line: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of line) {
    if (ch === '[') { if (depth === 0) { buf = ''; } else { buf += ch; } depth++; continue; }
    if (ch === ']') { depth--; if (depth === 0) { groups.push(buf); } else if (depth > 0) { buf += ch; } continue; }
    if (depth >= 1) buf += ch;
  }
  return groups;
}

// A synopsis-brackets line (npm per-command help): the whole line is bracket
// groups and at least one group holds a flag, e.g.
//   [-S|--save|--no-save] [--cpu <cpu>] [-w|--workspace <name> [-w ...]]
function parseSynopsisBrackets(line: string): CmdOption[] {
  const out: CmdOption[] = [];
  const groups = bracketGroups(line);
  for (const g of groups) {
    // Take the leading flag portion; a nested "[-w ...]" repeat lives inside g
    // but bracketGroups already stripped one level, so g may still contain '['.
    const head = g.split('[')[0].trim();
    if (!/^-/.test(head)) continue;
    // Pull an arg placeholder "<...>" (may contain pipes: <a|b|c>).
    const argM = head.match(/<[^>]+>/);
    const arg = argM ? argM[0] : null;
    const flagsPart = head.replace(/<[^>]+>/g, ' ');
    for (const tok of flagsPart.split(/[|\s]+/)) {
      const t = tok.trim();
      if (/^-{1,2}[A-Za-z0-9]/.test(t)) {
        out.push({ flags: [t], arg, argStyle: 'space', description: '' });
      }
    }
  }
  return out;
}

// Fallback: mine flags from a bracketed usage synopsis when a tool prints no
// OPTIONS section at all — classic BSD-style tools (ssh, scp, sftp, and many
// getopt programs) emit only:
//   usage: ssh [-46AaCfGg...] [-B bind_interface] [-c cipher_spec] ...
// From those brackets we recover:
//   [-46Aa...]          → boolean short flags -4 -6 -A -a ...
//   [-B bind_interface] → -B takes an argument
//   [--long value]      → --long takes an argument (or --long=VAL)
export function mineUsageFlags(usageLines: string[]): CmdOption[] {
  const out: CmdOption[] = [];
  const seen = new Set<string>();
  const add = (flag: string, arg: string | null, argStyle: 'space' | 'equals' = 'space') => {
    if (seen.has(flag)) return;
    seen.add(flag);
    out.push({ flags: [flag], arg, argStyle, description: '' });
  };
  for (const line of usageLines) {
    for (const g of bracketGroups(line)) {
      const grp = g.trim();
      if (!grp.startsWith('-')) continue;
      const tokens = grp.split(/\s+/);
      const head = tokens[0];
      const rest = tokens.slice(1).join(' ').trim();
      if (head.startsWith('--')) {
        const eq = head.match(/^(--[A-Za-z0-9][A-Za-z0-9-]*)(=(\S*))?$/);
        if (!eq) continue;
        if (eq[2] != null) add(eq[1], eq[3] || 'VALUE', 'equals');
        else add(eq[1], rest || null);
      } else if (/^-[A-Za-z0-9]{2,}$/.test(head) && tokens.length === 1) {
        // Cluster of boolean short flags, e.g. "-46AaCfGg".
        for (const ch of head.slice(1)) add('-' + ch, null);
      } else if (/^-[A-Za-z0-9]$/.test(head)) {
        // Single short flag, optionally with an argument placeholder.
        add(head, rest || null);
      }
    }
  }
  return out;
}

export function parseHelp(text: string): ParsedHelp {
  const lines = text.split(/\r?\n/);
  const options: CmdOption[] = [];
  const usage: string[] = [];
  const subcommands: Subcommand[] = [];
  let section: 'usage' | 'options' | 'commands' | null = null;
  let last: CmdOption | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // --- Section headers -------------------------------------------------
    if (SECTION_USAGE.test(trimmed)) {
      section = 'usage';
      last = null;
      const rest = trimmed.replace(/^(usage|synopsis):?/i, '').trim();
      if (rest) usage.push(rest);
      continue;
    }
    const headerish = trimmed.length < 60 && (trimmed.endsWith(':') || trimmed.length < 40);
    if (headerish && SECTION_OPTIONS.test(trimmed)) {
      section = 'options';
      last = null;
      continue;
    }
    // Command sections: the anchored known headers, OR any short header line
    // that ends in a colon and mentions "command(s)" — this catches the many
    // real-world variants (git "These are common Git commands ...:", npm
    // "All commands:", apt "Most used commands:", systemctl "Unit Commands:").
    if (
      headerish &&
      (SECTION_COMMANDS.test(trimmed) ||
        (trimmed.endsWith(':') && /\bcommands?\b/i.test(trimmed) && !OPT_RE.test(line)))
    ) {
      section = 'commands';
      last = null;
      continue;
    }

    // --- Usage block continuation ---------------------------------------
    if (section === 'usage') {
      if (trimmed === '') { section = null; continue; }
      // Usage lines are typically indented; a non-indented line ends the block.
      // But an option line (starts with dash after indent) also ends it so we
      // don't swallow the OPTIONS list that follows without a blank line (curl).
      if (/^\S/.test(line) || OPT_RE.test(line)) {
        section = null;
        // fall through to option handling below
      } else {
        usage.push(trimmed);
        continue;
      }
    }

    // --- Synopsis-brackets options (npm per-command help) ----------------
    // Inside an options section, a line that is entirely bracket groups and
    // carries a flag: "[-S|--save] [--cpu <cpu>]". Guarded so descriptive
    // option rows (handled below) and prose never reach here.
    if (section === 'options' && /^\s*\[/.test(line) && /\[\s*-/.test(line)) {
      const syn = parseSynopsisBrackets(line);
      if (syn.length) { for (const o of syn) options.push(o); last = null; continue; }
    }

    // --- Option lines ----------------------------------------------------
    // Inside a detected options section, also accept column-0 flags (Python).
    const m = line.match(OPT_RE) || (section === 'options' ? line.match(OPT_RE0) : null);
    if (m) {
      const combined = m[2] + m[3];
      const { flagPart, desc } = splitFlagsAndDesc(combined);
      const { flags, arg, argStyle } = extractFlags(flagPart);
      if (flags.length) {
        last = { flags, arg, argStyle, description: desc };
        options.push(last);
        continue;
      }
    }

    // --- Continuation of previous option description --------------------
    if (last && /^\s{4,}\S/.test(line) && trimmed && !OPT_RE.test(line)) {
      last.description = (last.description + ' ' + trimmed).trim();
      continue;
    }

    // --- Subcommand rows -------------------------------------------------
    if (section === 'commands') {
      // Two common row shapes:
      //   "  clone      Clone a repository"   (name, 2+ spaces, description)
      //   "  install - install packages"      (name, " - ", description; apt/dpkg)
      const cm =
        line.match(/^\s{1,6}([A-Za-z][A-Za-z0-9:_-]*)\s{2,}(.+)$/) ||
        line.match(/^\s{1,6}([A-Za-z][A-Za-z0-9:_-]*)\s+-\s+(.+)$/);
      if (cm) { subcommands.push({ name: cm[1], description: cm[2].trim() }); continue; }

      // Comma-flowing bare-command list (npm "All commands:"): an indented row
      // that is purely comma-separated identifiers with no descriptions, often
      // wrapped across several lines and ending in a trailing comma. Strictly
      // "ident(, ident)*,?" so prose (which has space-separated words) can't match.
      if (
        /^\s{2,}/.test(line) &&
        /^[A-Za-z][A-Za-z0-9:_-]*(\s*,\s*[A-Za-z][A-Za-z0-9:_-]*)*,?$/.test(trimmed)
      ) {
        for (const name of trimmed.split(',')) {
          const n = name.trim();
          if (n) subcommands.push({ name: n, description: '' });
        }
        continue;
      }
    }
  }

  // De-dupe options that share the exact same flag set (some tools repeat).
  const seen = new Set<string>();
  const deduped = options.filter((o) => {
    const k = o.flags.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Fallback: if no OPTIONS section yielded anything, mine flags from the
  // bracketed usage synopsis (ssh/scp/sftp and other synopsis-only tools).
  const finalOptions =
    deduped.length === 0 && usage.length ? mineUsageFlags(usage) : deduped;

  return { usage, options: finalOptions, subcommands };
}
