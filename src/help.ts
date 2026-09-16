import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

/** Candidate help invocations, tried in order until one yields option-looking text. */
const HELP_ARGS: string[][] = [['--help'], ['-h'], ['help']];

export interface HelpResult {
  text: string;
  invocation: string;
  /** Where the text came from: the command's own --help, or its man page. */
  source?: 'help' | 'man';
}

export function looksLikeHelp(t: string): boolean {
  return /(^|\n)\s*-{1,2}[A-Za-z]/.test(t) || /usage:/i.test(t) || /commands?:/i.test(t);
}

/**
 * Strip roff overstrike formatting that `man` emits for bold/underline —
 * sequences of `X\bX` (bold) and `_\bX` (underline). Removing every
 * "char + backspace" pair leaves the final visible character. Also drops the
 * `<BS>` and carriage returns some pagers add. Cleaning already-clean text is
 * a no-op, so this is always safe to run.
 */
export function cleanManOutput(text: string): string {
  return text
    .replace(/.\x08/g, '')
    .replace(/\r/g, '')
    // Rejoin words that nroff split across a line break with a soft hyphen
    // (U+2010), e.g. "Dis‐\n   ables" → "Disables". Only the typographic soft
    // hyphen is touched, never an ASCII "-", so real compounds are preserved.
    .replace(/\u2010\n[ \t]*/g, '');
}

const MAN_ENV = {
  ...process.env,
  // Force non-interactive, wide, plain output regardless of the user's setup.
  PAGER: 'cat',
  MANPAGER: 'cat',
  MANWIDTH: '100',
  MAN_KEEP_FORMATTING: '',
};

/**
 * Fallback source: parse a command's man page when its `--help` is missing or
 * uninformative (common for classic Unix tools like find, tar, ssh, xargs).
 * Only used for a top-level command (man has no reliable subcommand model).
 */
export async function getMan(cmd: string): Promise<HelpResult | null> {
  try {
    const { stdout, stderr } = await pexec('man', [cmd], {
      encoding: 'utf8',
      timeout: 6000,
      maxBuffer: 8 * 1024 * 1024,
      env: MAN_ENV,
    });
    const text = cleanManOutput((stdout || '') + (stderr || ''));
    if (looksLikeHelp(text)) return { text, invocation: `man ${cmd}`, source: 'man' };
  } catch {
    // no man page / man not installed → caller stays with --help error
  }
  return null;
}

/**
 * Synchronous variant of {@link getHelp}, used for interactive subcommand
 * drill-down inside the TUI keypress loop. Returns null when no help-looking
 * text could be obtained (caller keeps the current view and shows a status).
 */
export function getHelpSync(cmd: string, extra: string[] = []): HelpResult | null {
  for (const args of HELP_ARGS) {
    const full = [...extra, ...args];
    const r = spawnSync(cmd, full, {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const text = (r.stdout || '') + (r.stderr || '');
    if (looksLikeHelp(text)) return { text, invocation: `${cmd} ${full.join(' ')}`.trim() };
  }
  return null;
}

/** Run `<cmd> <helpflag>` and return the best help text we can obtain. */
export async function getHelp(cmd: string, extra: string[] = []): Promise<HelpResult> {
  let firstErr: unknown = null;
  for (const args of HELP_ARGS) {
    const full = [...extra, ...args];
    try {
      const { stdout, stderr } = await pexec(cmd, full, {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = (stdout || '') + (stderr || '');
      if (looksLikeHelp(text)) return { text, invocation: `${cmd} ${full.join(' ')}`.trim(), source: 'help' };
    } catch (e: any) {
      // Many CLIs print help to stderr and exit non-zero.
      const text = (e?.stdout || '') + (e?.stderr || '');
      if (looksLikeHelp(text)) return { text, invocation: `${cmd} ${full.join(' ')}`.trim(), source: 'help' };
      firstErr = firstErr ?? e;
    }
  }
  // --- Fallback: the command's man page ---------------------------------
  // Only for a top-level command (extra empty); man has no subcommand model.
  if (extra.length === 0) {
    const man = await getMan(cmd);
    if (man) return man;
  }
  throw new Error(
    `comptab: could not get help text from "${cmd}". ` +
      `Tried --help, -h, help${extra.length === 0 ? ', man' : ''}. ` +
      `${firstErr instanceof Error ? '(' + firstErr.message + ')' : ''}`,
  );
}
