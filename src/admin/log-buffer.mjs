const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const SECRET_FIELD = /token|authorization|api[_-]?key|cookie|secret|password/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi;
const TOKEN_ASSIGNMENT = /\b(userToken|access[_-]?token|api[_-]?key|authorization|cookie|secret|password)\s*([:=])\s*([^,\s;]+)/gi;

export function createLogBuffer({ maxEntries = 500, maxMessageChars = 4000, secrets = [] } = {}) {
  const entries = [];
  const listeners = new Set();
  const knownSecrets = secrets.filter((value) => typeof value === 'string' && value.length >= 8);
  let nextId = 1;

  function append(level, scope, args) {
    const message = formatArgs(args, knownSecrets).slice(0, maxMessageChars);
    const entry = { id: nextId++, timestamp: new Date().toISOString(), level, scope, message };
    entries.push(entry);
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    for (const listener of listeners) {
      try { listener(entry); } catch {}
    }
    return entry;
  }

  function list({ after = 0, limit = 100, level = 'all' } = {}) {
    const filtered = entries.filter((entry) => entry.id > after && (level === 'all' || entry.level === level));
    return filtered.slice(-Math.max(1, Math.min(200, limit)));
  }

  return {
    append,
    list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createBufferedLogger(logger, buffer) {
  function wrap(target, scope = '') {
    const wrapped = { level: target.level };
    const threshold = LEVEL_ORDER[target.level] ?? LEVEL_ORDER.info;
    for (const level of ['error', 'warn', 'info', 'debug', 'trace']) {
      wrapped[level] = (...args) => {
        if ((LEVEL_ORDER[level] ?? 99) <= threshold) buffer.append(level, scope, args);
        return target[level](...args);
      };
    }
    wrapped.child = (name) => wrap(target.child(name), scope ? scope + ':' + name : String(name));
    return wrapped;
  }
  return wrap(logger);
}

function formatArgs(args, secrets) {
  return args.map((value) => {
    if (value instanceof Error) {
      return redactText(value.name + ': ' + value.message + (value.stack ? '\n' + value.stack : ''), secrets);
    }
    if (typeof value === 'string') return redactText(value, secrets);
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(sanitizeValue(value, '', secrets, new WeakSet()));
    } catch {
      return redactText(String(value), secrets);
    }
  }).join(' ');
}

function sanitizeValue(value, key, secrets, seen) {
  if (SECRET_FIELD.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return '[Buffer ' + value.length + ' bytes]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, '', secrets, seen));
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = sanitizeValue(childValue, childKey, secrets, seen);
  }
  return out;
}

function redactText(input, secrets) {
  let value = String(input);
  for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
  return value
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(TOKEN_ASSIGNMENT, '$1$2[REDACTED]');
}
