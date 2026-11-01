import crypto from 'node:crypto';
import fs from 'node:fs';

import { loadTokens, maskToken, normalizeUserToken, saveTokens } from '../auth.mjs';

const MAX_ADMIN_BODY_BYTES = 64 * 1024;

export function createAdminApi({ config, web, adminKey = '' }) {
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
      return mutateAccounts(body);
    }

    if (req.method === 'POST' && url.pathname === '/admin/accounts/check') {
      try {
        if (typeof web.checkLogin === 'function') {
          const result = await web.checkLogin();
          return sendJson(res, result.ok ? 200 : 422, { ...result, engine: web.status().engine, method: 'login_check' });
        }
        const result = await web.chat({
          prompt: '# MESSAGES:\\n## USER_ROLE_MESSAGES:\\n只回复：ok',
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
    const tokens = config.deepseek.tokens || [];
    const envManaged = Boolean(process.env.DEEPSEEK_USER_TOKENS || process.env.DEEPSEEK_USER_TOKEN);
    const accounts = Array.isArray(status.accounts)
      ? status.accounts
      : tokens.map((token, index) => ({
          index: index + 1,
          token: maskToken(token),
          available: true,
          cooldownMs: 0,
          requests: null,
          limited: null,
          errors: null,
          authFailed: false,
          statusUnavailable: true,
        }));
    return {
      engine: status.engine,
      envManaged,
      restartRequired: false,
      accounts,
    };
  }

  function mutateAccounts(body) {
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
      fs.writeFileSync(temp, `${JSON.stringify({ token: '', tokens: [], savedAt: new Date().toISOString() }, null, 2)}\\n`, { mode: 0o600 });
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
  const match = /^Bearer\\s+(.+)$/i.exec(String(req.headers.authorization || ''));
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
