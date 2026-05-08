/*
 * GLaDOS / Railgun Quantumult X 自动签到脚本
 *
 * 模式：
 * 1) 抓取模式：打开 glados.cloud / railgun.info 登录后页面，自动保存 cookie
 * 2) 定时模式：读取本地 cookie，调用官方 API 执行签到、查剩余天数、查积分、按阈值自动兑换
 */

const CONFIG = {
  name: 'GLaDOS / Railgun 签到',
  domains: ['glados.cloud', 'railgun.info'],
  requestTimeout: 20000,
  captureKey: 'glados_railgun_cookie_store_v1',
  resultKey: 'glados_railgun_last_result_v1',
  notifyTsKey: 'glados_railgun_notify_ts_v1',
  notifyCooldownMs: 15000,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  autoExchange: true,
  exchangePlan: 'plan500',
  exchangeThresholds: {
    plan100: 100,
    plan200: 200,
    plan500: 500
  },
  manualAccounts: [
    // 可选：手动补充多账号。公开版默认留空。
    // { domain: 'railgun.info', cookie: 'koa:sess=...; koa:sess.sig=...', name: '账号1' }
  ]
};

function now() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }
function safeJsonParse(text, fallback) { try { return JSON.parse(text); } catch (_) { return fallback; } }
function readJSON(key, fallback) { return safeJsonParse($prefs.valueForKey(key) || '', fallback); }
function writeJSON(key, value) { return $prefs.setValueForKey(JSON.stringify(value), key); }
function done(value) { $done(value || {}); }
function notify(title, subtitle, body) { $notify(title, subtitle || '', body || ''); }

function shouldNotify() {
  const last = Number($prefs.valueForKey(CONFIG.notifyTsKey) || 0);
  if (now() - last < CONFIG.notifyCooldownMs) return false;
  $prefs.setValueForKey(String(now()), CONFIG.notifyTsKey);
  return true;
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function setHeader(headers, name, value) {
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (String(key).toLowerCase() === lower) {
      headers[key] = value;
      return;
    }
  }
  headers[name] = value;
}

function deleteHeader(headers, name) {
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (String(key).toLowerCase() === lower) delete headers[key];
  }
}

function normalizeSetCookie(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(/\n|,(?=[^;]+?=)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCookie(cookie) {
  const jar = new Map();
  String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return;
      jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    });
  return jar;
}

function stringifyCookie(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function mergeSetCookie(cookie, setCookie) {
  const jar = parseCookie(cookie);
  normalizeSetCookie(setCookie).forEach((line) => {
    const first = String(line || '').split(';')[0].trim();
    const idx = first.indexOf('=');
    if (idx <= 0) return;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) return;
    if (!value || /^(deleted|null|undefined)$/i.test(value)) jar.delete(name);
    else jar.set(name, value);
  });
  return stringifyCookie(jar);
}

function normalizeDomain(input) {
  return String(input || '').trim().toLowerCase();
}

function isSupportedDomain(domain) {
  return CONFIG.domains.includes(normalizeDomain(domain));
}

function hasSessionCookie(cookie) {
  const jar = parseCookie(cookie);
  return jar.has('koa:sess') && jar.has('koa:sess.sig');
}

function loadStore() {
  return readJSON(CONFIG.captureKey, {});
}

function saveStore(store) {
  return writeJSON(CONFIG.captureKey, store || {});
}

function saveDomainCookie(domain, cookie, meta) {
  if (!isSupportedDomain(domain) || !hasSessionCookie(cookie)) return { changed: false, store: loadStore() };
  const store = loadStore();
  const prev = store[domain] || {};
  const next = {
    domain,
    cookie,
    updatedAt: isoNow(),
    source: meta && meta.source ? meta.source : 'request',
    url: meta && meta.url ? meta.url : ''
  };
  const changed = prev.cookie !== cookie;
  store[domain] = next;
  saveStore(store);
  return { changed, store, item: next };
}

function buildAccounts() {
  const accounts = [];
  const seen = new Set();
  const store = loadStore();

  CONFIG.manualAccounts.forEach((item, idx) => {
    if (!item || !item.cookie) return;
    const domain = normalizeDomain(item.domain || '');
    if (!isSupportedDomain(domain) || !hasSessionCookie(item.cookie)) return;
    const id = `manual:${idx}:${domain}:${item.cookie}`;
    if (seen.has(id)) return;
    seen.add(id);
    accounts.push({
      domain,
      cookie: item.cookie,
      source: 'manual',
      name: item.name || `手动账号${idx + 1}`
    });
  });

  Object.keys(store).forEach((domain) => {
    const item = store[domain] || {};
    const norm = normalizeDomain(domain);
    if (!isSupportedDomain(norm) || !hasSessionCookie(item.cookie || '')) return;
    const id = `store:${norm}:${item.cookie}`;
    if (seen.has(id)) return;
    seen.add(id);
    accounts.push({
      domain: norm,
      cookie: item.cookie,
      source: item.source || 'capture',
      name: item.name || norm
    });
  });

  return accounts;
}

function shortText(input) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 240) : '(空响应)';
}

function responseJson(resp) {
  const text = resp && typeof resp.body === 'string' ? resp.body : '';
  return safeJsonParse(text, null);
}

function messageFromResponse(resp) {
  const obj = responseJson(resp);
  if (obj) {
    const msg = obj.message || obj.msg || obj.resultDesc || obj.retMsg || obj.error || '';
    if (msg) return String(msg);
    if (obj.code !== undefined) return `code=${obj.code}`;
  }
  return shortText(resp && resp.body);
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchApi({ domain, path, method, cookie, body }) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: `https://${domain}`,
    Referer: `https://${domain}/`,
    'User-Agent': CONFIG.userAgent,
    Cookie: cookie
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8';
  const opts = {
    url: `https://${domain}${path}`,
    method: method || 'GET',
    headers,
    timeout: CONFIG.requestTimeout
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await $task.fetch(opts);
  const nextCookie = mergeSetCookie(cookie, getHeader(resp.headers || {}, 'set-cookie'));
  return {
    statusCode: resp.statusCode,
    headers: resp.headers || {},
    body: resp.body || '',
    cookie: nextCookie
  };
}

function classifyAuth(resp) {
  const obj = responseJson(resp);
  const msg = String((obj && (obj.message || obj.msg || obj.resultDesc || obj.retMsg)) || '').toLowerCase();
  const code = obj && obj.code;
  if (code === -2) return 'invalid';
  if (/no permission|没有权限|未登录|登录|过期|失效|forbidden|unauthorized/.test(msg)) return 'invalid';
  return 'ok';
}

function shouldRunExchange(points) {
  if (!CONFIG.autoExchange) return false;
  const threshold = CONFIG.exchangeThresholds[CONFIG.exchangePlan];
  if (!threshold) return false;
  return Number(points) >= threshold;
}

async function getStatus(domain, cookie) {
  const resp = await fetchApi({ domain, path: '/api/user/status', method: 'GET', cookie });
  const obj = responseJson(resp) || {};
  const leftDaysRaw = obj.data && obj.data.leftDays;
  const leftDays = leftDaysRaw !== undefined && leftDaysRaw !== null ? `${parseInt(Number(leftDaysRaw), 10)} 天` : '未知';
  return {
    resp,
    valid: classifyAuth(resp) === 'ok',
    leftDays,
    code: obj.code,
    message: messageFromResponse(resp)
  };
}

async function checkin(domain, cookie) {
  const resp = await fetchApi({ domain, path: '/api/user/checkin', method: 'POST', cookie, body: { token: domain } });
  const obj = responseJson(resp) || {};
  const code = obj.code;
  const message = String(obj.message || obj.msg || '');
  const gainedPoints = parseNumber(obj.points, 0);
  let status = '签到失败';
  if (code === 0 || /success|签到成功/i.test(message)) status = '签到成功';
  else if (code === 1 || /already|重复|已签到|已经签到/i.test(message)) status = '今日已签';
  else if (classifyAuth(resp) === 'invalid') status = '登录失效';
  return {
    resp,
    code,
    valid: classifyAuth(resp) === 'ok',
    status,
    gainedPoints,
    message: message || messageFromResponse(resp)
  };
}

async function getPoints(domain, cookie) {
  const resp = await fetchApi({ domain, path: '/api/user/points', method: 'GET', cookie });
  const obj = responseJson(resp) || {};
  return {
    resp,
    valid: classifyAuth(resp) === 'ok',
    totalPoints: parseNumber(obj.points, 0),
    code: obj.code,
    message: messageFromResponse(resp)
  };
}

async function exchange(domain, cookie) {
  const resp = await fetchApi({ domain, path: '/api/user/exchange', method: 'POST', cookie, body: { planType: CONFIG.exchangePlan } });
  const obj = responseJson(resp) || {};
  const code = obj.code;
  const message = String(obj.message || obj.msg || messageFromResponse(resp));
  return {
    resp,
    valid: classifyAuth(resp) === 'ok',
    ok: code === 0,
    message
  };
}

function summarizeEntry(result) {
  const parts = [result.domain, result.status];
  if (result.gainedPoints > 0) parts.push(`+${result.gainedPoints}`);
  if (result.leftDays) parts.push(`剩余 ${result.leftDays}`);
  if (Number.isFinite(result.totalPoints)) parts.push(`总积分 ${result.totalPoints}`);
  if (result.exchange) parts.push(result.exchange);
  return parts.join(' | ');
}

function captureFromRequest() {
  const req = $request || {};
  let url;
  try { url = new URL(req.url); } catch (_) { return done({}); }
  const domain = normalizeDomain(url.hostname);
  if (!isSupportedDomain(domain)) return done({});
  const cookie = getHeader(req.headers || {}, 'Cookie') || '';
  if (!hasSessionCookie(cookie)) return done({});
  const saved = saveDomainCookie(domain, cookie, { source: 'request', url: req.url });
  if (saved.changed && shouldNotify()) {
    notify('✅ GLaDOS / Railgun', `已保存 ${domain} Cookie`, '本地签到会话已更新，可直接启用定时任务');
  }
  return done({});
}

function captureFromResponse() {
  const req = $request || {};
  const resp = $response || {};
  let url;
  try { url = new URL(req.url); } catch (_) { return done({}); }
  const domain = normalizeDomain(url.hostname);
  if (!isSupportedDomain(domain)) return done({});
  const setCookie = getHeader(resp.headers || {}, 'set-cookie');
  if (!setCookie) return done({});
  const currentStore = loadStore();
  const currentCookie = (currentStore[domain] && currentStore[domain].cookie) || getHeader(req.headers || {}, 'Cookie') || '';
  const merged = mergeSetCookie(currentCookie, setCookie);
  if (!hasSessionCookie(merged)) return done({});
  const saved = saveDomainCookie(domain, merged, { source: 'response', url: req.url });
  if (saved.changed && shouldNotify()) {
    notify('✅ GLaDOS / Railgun', `已刷新 ${domain} Cookie`, '已保存服务端回写的新会话');
  }
  return done({});
}

async function runTask() {
  const accounts = buildAccounts();
  if (!accounts.length) {
    const msg = '当前没有可用 Cookie。请先在 Quantumult X 打开 glados.cloud 或 railgun.info 的登录后页面抓取一次。';
    writeJSON(CONFIG.resultKey, { ok: false, at: isoNow(), message: msg });
    notify('❌ GLaDOS / Railgun 签到', '未找到本地 Cookie', msg);
    return done({});
  }

  const results = [];
  let successCount = 0;
  let invalidCount = 0;
  let failCount = 0;

  for (const account of accounts) {
    let workingCookie = account.cookie;
    const item = {
      domain: account.domain,
      source: account.source,
      status: '签到失败',
      gainedPoints: 0,
      leftDays: '未知',
      totalPoints: NaN,
      exchange: '未兑换',
      detail: ''
    };

    try {
      const beforeStatus = await getStatus(account.domain, workingCookie);
      workingCookie = beforeStatus.resp.cookie || workingCookie;
      if (hasSessionCookie(workingCookie)) saveDomainCookie(account.domain, workingCookie, { source: 'task-status-before', url: '/api/user/status' });
      item.leftDays = beforeStatus.leftDays;

      const sign = await checkin(account.domain, workingCookie);
      workingCookie = sign.resp.cookie || workingCookie;
      if (hasSessionCookie(workingCookie)) saveDomainCookie(account.domain, workingCookie, { source: 'task-checkin', url: '/api/user/checkin' });
      item.status = sign.status;
      item.gainedPoints = sign.gainedPoints;
      item.detail = sign.message;

      if (sign.status === '登录失效' || (!sign.valid && classifyAuth(sign.resp) === 'invalid')) {
        invalidCount += 1;
        item.exchange = '需重新抓 Cookie';
        results.push(item);
        continue;
      }

      const points = await getPoints(account.domain, workingCookie);
      workingCookie = points.resp.cookie || workingCookie;
      if (hasSessionCookie(workingCookie)) saveDomainCookie(account.domain, workingCookie, { source: 'task-points', url: '/api/user/points' });
      item.totalPoints = points.totalPoints;

      const afterStatus = await getStatus(account.domain, workingCookie);
      workingCookie = afterStatus.resp.cookie || workingCookie;
      if (hasSessionCookie(workingCookie)) saveDomainCookie(account.domain, workingCookie, { source: 'task-status-after', url: '/api/user/status' });
      if (afterStatus.leftDays && afterStatus.leftDays !== '未知') item.leftDays = afterStatus.leftDays;

      if (shouldRunExchange(item.totalPoints)) {
        const ex = await exchange(account.domain, workingCookie);
        workingCookie = ex.resp.cookie || workingCookie;
        if (hasSessionCookie(workingCookie)) saveDomainCookie(account.domain, workingCookie, { source: 'task-exchange', url: '/api/user/exchange' });
        item.exchange = ex.ok ? `兑换成功 ${CONFIG.exchangePlan}` : `兑换失败: ${ex.message}`;
      } else if (CONFIG.autoExchange) {
        const threshold = CONFIG.exchangeThresholds[CONFIG.exchangePlan] || 0;
        item.exchange = `积分不足 ${threshold}`;
      }

      if (item.status === '签到成功' || item.status === '今日已签') successCount += 1;
      else failCount += 1;
    } catch (err) {
      item.status = '运行异常';
      item.exchange = '未兑换';
      item.detail = String(err && err.message ? err.message : err);
      failCount += 1;
    }

    results.push(item);
  }

  const title = `GLaDOS / Railgun 签到：成功 ${successCount}，失效 ${invalidCount}，失败 ${failCount}`;
  const lines = results.map((item, idx) => `#${idx + 1} ${summarizeEntry(item)}${item.detail ? `\n${item.detail}` : ''}`);
  const body = lines.join('\n\n');
  writeJSON(CONFIG.resultKey, { ok: true, at: isoNow(), results });
  notify(title, 'Quantumult X 定时任务完成', body);
  return done({});
}

(async () => {
  if (typeof $request !== 'undefined' && typeof $response === 'undefined') {
    return captureFromRequest();
  }
  if (typeof $request !== 'undefined' && typeof $response !== 'undefined') {
    return captureFromResponse();
  }
  return runTask();
})().catch((err) => {
  const msg = String(err && err.message ? err.message : err);
  writeJSON(CONFIG.resultKey, { ok: false, at: isoNow(), message: msg });
  notify('❌ GLaDOS / Railgun 签到', '脚本执行异常', msg);
  done({});
});
