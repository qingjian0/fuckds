import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadTokens, maskToken, normalizeUserToken, saveTokens } from '../auth.mjs';

const MAX_ADMIN_BODY_BYTES = 64 * 1024;

export function createAdminApi({ config, web, adminKey = '' }) {
  let restartRequired = false;
  let configOverrides = {};
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/admin/')) return false;

    if (!isLoopbackRequest(req)) {
      return sendJson(res, 403, { error: { code: 'admin_loopback_only', message: '管理接口仅允许本机访问' } });
    }
    if (!isAllowedOrigin(req)) {
      return sendJson(res, 403, { error: { code: 'admin_origin_rejected', message: '管理接口来源校验失败' } });
    }
    if (!adminKey || Buffer.byteLength(adminKey) < 32) {
      return sendJson(res, 503, { error: { code: 'admin_not_configured', message: '尚未配置至少 32 字节的 ADMIN_API_KEY' } });
    }
    if (!hasValidBearer(req, adminKey)) {
      return sendJson(res, 401, { error: { code: 'admin_unauthorized', message: '管理密钥无效' } });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (req.method === 'GET' && url.pathname === '/admin/status') {
      return sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        uptime_s: Math.round(process.uptime()),
        ...web.status(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/admin/config') {
      return sendJson(res, 200, {
        values: { ...readConfigValues(config), ...configOverrides },
        restartRequired: Object.keys(configOverrides).length > 0,
      });
    }

    if (req.method === 'PATCH' && url.pathname === '/admin/config') {
      let body;
      try {
        body = await readJson(req);
        const updates = normalizeConfigUpdates(body?.values ?? body);
        writeEnvPatch(config.rootDir, updates);
        configOverrides = { ...configOverrides, ...updates };
        return sendJson(res, 200, {
          ok: true,
          restartRequired: true,
          message: '配置已保存到 .env；重启服务后生效',
          values: { ...readConfigValues(config), ...configOverrides },
        });
      } catch (err) {
        return sendJson(res, err.status || 400, { error: { code: err.code || 'invalid_config', message: err.message } });
      }
    }

    if (req.method === 'GET' && url.pathname === '/admin/accounts') {
      return sendJson(res, 200, accountPayload());
    }

    if (req.method === 'POST' && url.pathname === '/admin/accounts') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return sendJson(res, err.status || 400, { error: { code: 'invalid_body', message: err.message } });
      }
      return mutateAccounts(body, res);
    }

    if (req.method === 'POST' && url.pathname === '/admin/accounts/check') {
      try {
        if (typeof web.checkLogin === 'function') {
          const result = await web.checkLogin();
          return sendJson(res, result.ok ? 200 : 422, { ...result, engine: web.status().engine, method: 'login_check' });
        }
        const result = await web.chat({
          prompt: '# MESSAGES:\n## USER_ROLE_MESSAGES:\n只回复：ok',
          thinking: false,
          search: false,
        });
        return sendJson(res, 200, {
          ok: true,
          engine: web.status().engine,
          method: 'chat_probe',
          message: String(result?.text || '').slice(0, 80),
        });
      } catch {
        return sendJson(res, 502, { error: { code: 'account_check_failed', message: '账号池校验失败，请查看服务日志' } });
      }
    }

    return sendJson(res, 404, { error: { code: 'admin_not_found', message: '未知管理接口' } });
  }

  function accountPayload() {
    const status = web.status();
    const envManaged = Boolean(process.env.DEEPSEEK_USER_TOKENS || process.env.DEEPSEEK_USER_TOKEN);
    const tokens = envManaged ? (config.deepseek.tokens || []) : loadTokens(config);
    const runtimeByIndex = new Map((status.accounts || []).map((account) => [account.index, account]));
    const accounts = tokens.map((token, index) => ({
      index: index + 1,
      token: maskToken(token),
      ...(restartRequired ? {} : (runtimeByIndex.get(index + 1) || {})),
      statusUnavailable: restartRequired || !runtimeByIndex.has(index + 1),
    }));
    return {
      engine: status.engine,
      envManaged,
      restartRequired,
      accounts,
    };
  }

  function mutateAccounts(body, res) {
    const envManaged = Boolean(process.env.DEEPSEEK_USER_TOKENS || process.env.DEEPSEEK_USER_TOKEN);
    if (envManaged) {
      return sendJson(res, 409, { error: { code: 'accounts_env_managed', message: '账号由环境变量管理，请在原配置来源修改' } });
    }
    let current = loadTokens(config);
    try {
      if (body?.action === 'add') {
        const incoming = normalizeTokenList(body.tokens ?? body.token);
        current = [...new Set([...current, ...incoming])];
      } else if (body?.action === 'replace') {
        current = [...new Set(normalizeTokenList(body.tokens ?? body.token))];
      } else if (body?.action === 'remove') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 1 || index > current.length) {
          return sendJson(res, 400, { error: { code: 'invalid_account_index', message: '账号序号无效' } });
        }
        current.splice(index - 1, 1);
      } else {
        return sendJson(res, 400, { error: { code: 'invalid_account_action', message: 'action 必须是 add、replace 或 remove' } });
      }
      persistTokens(current);
      return sendJson(res, 200, {
        ok: true,
        restartRequired: true,
        message: '账号配置已保存；当前运行中的引擎需要重启后加载',
        accounts: current.map((token, index) => ({ index: index + 1, token: maskToken(token) })),
      });
    } catch (err) {
      return sendJson(res, 400, { error: { code: 'invalid_account_data', message: err.message } });
    }
  }

  function normalizeTokenList(value) {
    const values = Array.isArray(value) ? value : [value];
    const tokens = values.filter((item) => item !== undefined && item !== null && String(item).trim() !== '');
    if (!tokens.length) throw new Error('至少提供一个 userToken');
    return tokens.map((token) => normalizeUserToken(String(token)));
  }

  function persistTokens(tokens) {
    if (tokens.length) {
      saveTokens(config, tokens);
      fs.chmodSync(config.authFile, 0o600);
      return;
    }
    const temp = `${config.authFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ token: '', tokens: [], savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, config.authFile);
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch {}
    }
  }

  return { handle };
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  return isLocalHostHeader(req.headers.host);
}

function isLocalHostHeader(hostHeader = '') {
  const host = String(hostHeader).toLowerCase();
  let hostname = host;
  if (host.startsWith('[')) hostname = host.slice(1, host.indexOf(']'));
  else if (host.includes(':')) hostname = host.slice(0, host.lastIndexOf(':'));
  return ['127.0.0.1', 'localhost', '::1'].includes(hostname);
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && isLocalHostHeader(parsed.host)
      && parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function hasValidBearer(req, expectedValue) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!match) return false;
  const expected = Buffer.from(expectedValue);
  const actual = Buffer.from(match[1]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_ADMIN_BODY_BYTES) {
      const err = new Error('管理请求体超过 64 KB');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是有效 JSON');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const CONFIG_FIELDS = {
  engine: { env: 'ENGINE', type: 'enum', values: ['direct', 'browser', 'auto'] },
  thinking: { env: 'DEEPSEEK_THINKING', type: 'enum', values: ['always', 'auto', 'never'] },
  search: { env: 'DEEPSEEK_SEARCH', type: 'boolean' },
  defaultModel: { env: 'DEFAULT_MODEL', type: 'model' },
  concurrency: { env: 'CONCURRENCY', type: 'number', min: 1, max: 16 },
  queueLimit: { env: 'QUEUE_LIMIT', type: 'number', min: 0, max: 1024 },
  requestTimeoutMs: { env: 'REQUEST_TIMEOUT_MS', type: 'number', min: 1000, max: 600000 },
  firstTokenTimeoutMs: { env: 'FIRST_TOKEN_TIMEOUT_MS', type: 'number', min: 1000, max: 180000 },
  pollIntervalMs: { env: 'POLL_INTERVAL_MS', type: 'number', min: 20, max: 2000 },
  settleMs: { env: 'SETTLE_MS', type: 'number', min: 100, max: 10000 },
  sendIntervalMs: { env: 'SEND_INTERVAL_MS', type: 'number', min: 0, max: 60000 },
  directSendIntervalMs: { env: 'DIRECT_SEND_INTERVAL_MS', type: 'number', min: 0, max: 60000 },
  accountCooldownMs: { env: 'ACCOUNT_COOLDOWN_MS', type: 'number', min: 1000, max: 3600000 },
  maxCooldownWaitMs: { env: 'MAX_COOLDOWN_WAIT_MS', type: 'number', min: 0, max: 60000 },
  reasoningHoldMs: { env: 'REASONING_HOLD_MS', type: 'number', min: 0, max: 10000 },
  rateLimitBackoffMs: { env: 'RATE_LIMIT_BACKOFF_MS', type: 'number', min: 500, max: 60000 },
  idleShutdownMs: { env: 'IDLE_SHUTDOWN_MS', type: 'number', min: 0, max: 86400000 },
  warmup: { env: 'WARMUP', type: 'boolean' },
  browserCapture: { env: 'BROWSER_CAPTURE', type: 'boolean' },
  browserCaptureWaitMs: { env: 'BROWSER_CAPTURE_WAIT_MS', type: 'number', min: 0, max: 120000 },
  maxPromptChars: { env: 'MAX_PROMPT_CHARS', type: 'number', min: 1000, max: 500000 },
  maxAttachmentChars: { env: 'MAX_ATTACHMENT_CHARS', type: 'number', min: 1000, max: 10000000 },
  overflowToAttachment: { env: 'OVERFLOW_TO_ATTACHMENT', type: 'boolean' },
  retryOnFabrication: { env: 'RETRY_ON_FABRICATION', type: 'boolean' },
  abortOnFabrication: { env: 'ABORT_ON_FABRICATION', type: 'boolean' },
  browserHeadless: { env: 'BROWSER_HEADLESS', type: 'boolean' },
  browserWidth: { env: 'BROWSER_WIDTH', type: 'number', min: 320, max: 4096 },
  browserHeight: { env: 'BROWSER_HEIGHT', type: 'number', min: 320, max: 4096 },
  browserLocale: { env: 'BROWSER_LOCALE', type: 'locale' },
};

function readConfigValues(config) {
  return {
    engine: config.engine,
    thinking: config.deepseek.thinking,
    search: config.deepseek.search,
    defaultModel: config.deepseek.defaultModel,
    concurrency: config.runtime.concurrency,
    queueLimit: config.runtime.queueLimit,
    requestTimeoutMs: config.runtime.requestTimeoutMs,
    firstTokenTimeoutMs: config.runtime.firstTokenTimeoutMs,
    pollIntervalMs: config.runtime.pollIntervalMs,
    settleMs: config.runtime.settleMs,
    sendIntervalMs: config.runtime.sendIntervalMs,
    directSendIntervalMs: config.runtime.directSendIntervalMs,
    accountCooldownMs: config.runtime.accountCooldownMs,
    maxCooldownWaitMs: config.runtime.maxCooldownWaitMs,
    reasoningHoldMs: config.runtime.reasoningHoldMs,
    rateLimitBackoffMs: config.runtime.rateLimitBackoffMs,
    idleShutdownMs: config.runtime.idleShutdownMs,
    warmup: config.runtime.warmup,
    browserCapture: config.runtime.browserCapture,
    browserCaptureWaitMs: config.runtime.browserCaptureWaitMs,
    maxPromptChars: config.runtime.maxPromptChars,
    maxAttachmentChars: config.runtime.maxAttachmentChars,
    overflowToAttachment: config.runtime.overflowToAttachment,
    retryOnFabrication: config.runtime.retryOnFabrication,
    abortOnFabrication: config.runtime.abortOnFabrication,
    browserHeadless: config.browser.headless,
    browserWidth: config.browser.viewport.width,
    browserHeight: config.browser.viewport.height,
    browserLocale: config.browser.locale,
  };
}

function normalizeConfigUpdates(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是 JSON 对象');
  const entries = Object.entries(input);
  if (!entries.length) throw new Error('至少提供一个配置项');
  const updates = {};
  for (const [name, value] of entries) {
    const field = CONFIG_FIELDS[name];
    if (!field) throw new Error(`不允许修改配置项：${name}`);
    if (field.type === 'enum') {
      if (!field.values.includes(value)) throw new Error(`${name} 只能是：${field.values.join(' / ')}`);
      updates[name] = value;
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${name} 必须是布尔值`);
      updates[name] = value;
    } else if (field.type === 'number') {
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        throw new Error(`${name} 必须是 ${field.min}–${field.max} 范围内的整数`);
      }
      updates[name] = value;
    } else if (field.type === 'model') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)) {
        throw new Error('defaultModel 格式无效');
      }
      updates[name] = value;
    } else if (field.type === 'locale') {
      if (typeof value !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
        throw new Error('browserLocale 格式无效');
      }
      updates[name] = value;
    }
  }
  return updates;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return { text: '', values: {} };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('.env 必须是普通文件');
  if (stat.size > 1024 * 1024) throw new Error('.env 文件超过 1 MB');
  const text = fs.readFileSync(file, 'utf8');
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[line.slice(0, eq).trim()] = value;
  }
  return { text, values };
}

function writeEnvPatch(rootDir, updates) {
  const file = path.join(rootDir, '.env');
  const { text, values } = readEnvFile(file);
  const envUpdates = {};
  for (const [name, value] of Object.entries(updates)) {
    const envName = CONFIG_FIELDS[name].env;
    if (process.env[envName] !== undefined && (values[envName] === undefined || process.env[envName] !== values[envName])) {
      const err = new Error(`${name} 由外部环境变量覆盖，请修改启动环境`);
      err.status = 409;
      err.code = 'config_env_override';
      throw err;
    }
    envUpdates[envName] = String(value);
  }
  const lines = text ? text.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(envUpdates)) {
    const index = lines.findIndex(line => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  const output = `${lines.join('\n').replace(/\n*$/, '')}\n`;
  fs.mkdirSync(rootDir, { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, output, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}
