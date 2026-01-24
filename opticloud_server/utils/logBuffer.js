/**
 * In-memory log buffer - captures console.log/error/warn for Admin logs UI.
 * Keeps last MAX_ENTRIES lines.
 */

import util from 'util';

const MAX_ENTRIES = 1000;
const entries = [];

function formatArgs(args) {
  return args.map((a) => {
    if (typeof a === 'object' && a !== null) {
      try {
        return util.inspect(a, { depth: 3, colors: false });
      } catch {
        return String(a);
      }
    }
    return String(a);
  }).join(' ');
}

function push(level, ...args) {
  const ts = new Date().toISOString();
  const text = formatArgs(args);
  entries.push({ ts, level, text });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function getLogs() {
  return [...entries];
}

export function install() {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = function (...args) {
    push('log', ...args);
    origLog.apply(console, args);
  };
  console.error = function (...args) {
    push('error', ...args);
    origError.apply(console, args);
  };
  console.warn = function (...args) {
    push('warn', ...args);
    origWarn.apply(console, args);
  };
}
