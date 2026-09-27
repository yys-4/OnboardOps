/**
 * Stack trace parser.
 * Extracts suspect file, function, line number, and error type from
 * raw Node.js / Python stack traces.
 */

export interface ParsedFrame {
  file: string;
  fn: string;
  line: number;
  col: number;
  raw: string;
}

export interface ParsedStackTrace {
  error_class: string;
  error_message: string;
  frames: ParsedFrame[];
  /** First non-node_modules app frame */
  primary_frame: ParsedFrame | null;
  detected_patterns: string[];
}

// ── Pattern library ────────────────────────────────────────────────────────

const ERROR_CLASS_PATTERNS: Array<{ re: RegExp; pattern: string }> = [
  { re: /race condition|oversell|stock went negative|concurrent/i, pattern: 'race_condition' },
  { re: /cannot read propert|typeerror.*null|typeerror.*undefined|nullpointer/i, pattern: 'null_pointer' },
  { re: /timeout|timed out|etimedout|pool.*full|waiting.*connection/i, pattern: 'payment_timeout' },
  { re: /deadlock|lock wait timeout/i, pattern: 'deadlock' },
  { re: /out of memory|oomkilled|heap.*growing/i, pattern: 'oom' },
  { re: /n\+1|executed \d{2,} queries/i, pattern: 'n_plus_one' },
  { re: /unhandledpromiserejection/i, pattern: 'unhandled_rejection' },
];

// Node.js frame: "    at fnName (/path/to/file.ts:LINE:COL)" or ":LINE)" without col
const NODE_FRAME_RE = /^\s+at (?:(.+?) \()?(.+?):(\d+)(?::(\d+))?\)?/;
// Python frame: "  File "/path/to/file.py", line LINE, in fnName"
const PYTHON_FRAME_RE = /^\s+File "(.+?)", line (\d+), in (.+)/;

/**
 * Parse a raw stack trace string into structured frame data.
 */
export function parseStackTrace(raw: string): ParsedStackTrace {
  const lines = raw.split('\n');
  const firstLine = lines[0] ?? '';

  // Split "ErrorClass: message" or just "message"
  const colonIdx = firstLine.indexOf(':');
  const error_class =
    colonIdx > 0 && !firstLine.slice(0, colonIdx).includes(' ')
      ? firstLine.slice(0, colonIdx).trim()
      : 'Error';
  const error_message =
    colonIdx > 0 ? firstLine.slice(colonIdx + 1).trim() : firstLine.trim();

  const frames: ParsedFrame[] = [];

  // Also matches bare "at /path/file.ts:LINE:COL" (no function name)
  const NODE_BARE_RE = /^\s+at (\/[^\s(]+):(\d+):(\d+)/;

  for (const line of lines.slice(1)) {
    // Try Node frame with function name: "at fn (file:line:col)"
    const nodeMatch = NODE_FRAME_RE.exec(line);
    if (nodeMatch) {
      const [, fn, file, lineStr, colStr] = nodeMatch;
      frames.push({
        fn: fn?.trim() ?? '<anonymous>',
        file: file.trim(),
        line: Number(lineStr),
        col: colStr ? Number(colStr) : 0,
        raw: line.trim(),
      });
      continue;
    }
    // Try bare "at /absolute/path.ts:LINE:COL" (no function name)
    const bareMatch = NODE_BARE_RE.exec(line);
    if (bareMatch) {
      const [, file, lineStr, colStr] = bareMatch;
      frames.push({
        fn: '<anonymous>',
        file: file.trim(),
        line: Number(lineStr),
        col: colStr ? Number(colStr) : 0,
        raw: line.trim(),
      });
      continue;
    }

    // Try Python frame
    const pyMatch = PYTHON_FRAME_RE.exec(line);
    if (pyMatch) {
      const [, file, lineStr, fn] = pyMatch;
      frames.push({
        fn: fn.trim(),
        file: file.trim(),
        line: Number(lineStr),
        col: 0,
        raw: line.trim(),
      });
    }
  }

  // Primary frame = first app frame (skip node_modules, node internals)
  const primary_frame =
    frames.find(
      (f) =>
        !f.file.includes('node_modules') &&
        !f.file.startsWith('node:') &&
        !f.file.includes('site-packages') &&
        !f.file.includes('/lib/router/'),
    ) ?? frames[0] ?? null;

  // Detect patterns from the full trace text
  const detected_patterns = ERROR_CLASS_PATTERNS.filter(({ re }) =>
    re.test(raw),
  ).map(({ pattern }) => pattern);

  return { error_class, error_message, frames, primary_frame, detected_patterns };
}

/**
 * Given a parsed stack trace, return suggested suspect files
 * ordered by app-code relevance.
 */
export function extractSuspectFiles(parsed: ParsedStackTrace): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const frame of parsed.frames) {
    if (
      !frame.file.includes('node_modules') &&
      !frame.file.startsWith('node:') &&
      !frame.file.includes('site-packages') &&
      !frame.file.includes('/lib/router/') &&
      !seen.has(frame.file)
    ) {
      seen.add(frame.file);
      result.push(frame.file);
    }
  }
  return result;
}
