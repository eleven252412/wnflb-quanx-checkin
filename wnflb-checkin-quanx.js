const CONFIG = {
  domains: [
    'https://www.wnflb2023.com/',
    'https://www.wnflb00.com/',
    'https://www.wnflb99.com/'
  ],
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  timeout: 20000,
  cookieKey: 'wnflb_cookie',
  captureNotifyKey: 'wnflb_cookie_last_notify',
  captureDailySeenKey: 'wnflb_cookie_daily_seen',
  captureMissNotifyKey: 'wnflb_cookie_miss_daily_seen',
  captureNotifyCooldownMs: 15000,
  login: {
    username: '',
    password: '',
    questionid: '4',
    answer: ''
  }
};

function readCookieStore() {
  return ($prefs.valueForKey(CONFIG.cookieKey) || '').trim();
}

function saveCookieStore(cookie) {
  if (!cookie) return false;
  const current = readCookieStore();
  if (current === cookie) return false;
  return $prefs.setValueForKey(cookie, CONFIG.cookieKey);
}

function parseCookieString(cookie) {
  const jar = new Map();
  String(cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const idx = item.indexOf('=');
      if (idx <= 0) return;
      const name = item.slice(0, idx).trim();
      const value = item.slice(idx + 1).trim();
      if (name) jar.set(name, value);
    });
  return jar;
}

function stringifyCookieJar(jar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function mergeSetCookie(cookie, setCookieHeaders) {
  const jar = parseCookieString(cookie);
  const lines = normalizeSetCookie(setCookieHeaders);
  for (const line of lines) {
    const first = String(line || '').split(';')[0].trim();
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) continue;
    if (!value || /^(deleted)?$/i.test(value)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  return stringifyCookieJar(jar);
}

function normalizeSetCookie(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw
      .split(/\n|,(?=[^;]+?=)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function htmlDecode(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanText(text) {
  return htmlDecode(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(base, relative) {
  if (/^https?:\/\//i.test(relative)) return relative;
  const root = base.endsWith('/') ? base : `${base}/`;
  return new URL(relative, root).toString();
}

async function request({ url, method = 'GET', headers = {}, body = '', cookie = '' }) {
  const reqHeaders = Object.assign(
    {
      'User-Agent': CONFIG.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    headers
  );
  if (cookie) reqHeaders.Cookie = cookie;
  const opts = {
    url,
    method,
    headers: reqHeaders,
    body,
    opts: { redirection: true },
    timeout: CONFIG.timeout
  };
  const resp = await $task.fetch(opts);
  const nextCookie = mergeSetCookie(cookie, getHeader(resp.headers, 'set-cookie'));
  return {
    statusCode: resp.statusCode,
    headers: resp.headers || {},
    body: resp.body || '',
    cookie: nextCookie
  };
}

async function fetchText(state, url, headers = {}) {
  const resp = await request({ url, headers, cookie: state.cookie });
  state.cookie = resp.cookie;
  saveCookieStore(state.cookie);
  if (resp.statusCode < 200 || resp.statusCode >= 400) {
    throw new Error(`请求失败：${resp.statusCode} ${url}`);
  }
  return resp.body;
}

async function postForm(state, url, data, headers = {}) {
  const body = Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key] ?? '')}`)
    .join('&');
  const resp = await request({
    url,
    method: 'POST',
    headers: Object.assign(
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(url).origin,
        Referer: url
      },
      headers
    ),
    body,
    cookie: state.cookie
  });
  state.cookie = resp.cookie;
  saveCookieStore(state.cookie);
  if (resp.statusCode < 200 || resp.statusCode >= 400) {
    throw new Error(`提交失败：${resp.statusCode} ${url}`);
  }
  return resp.body;
}

function extractUsername(html) {
  const patterns = [
    /title=\"访问我的空间\">([\s\S]*?)<\/a>/i,
    /欢迎您回来，<strong class=\"vwmy\">([\s\S]*?)<\/strong>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return '';
}

function isLoggedIn(html, expectedUsername) {
  const uidMatch = html.match(/discuz_uid = '([0-9]+)'/i);
  const username = extractUsername(html);
  if (!uidMatch || uidMatch[1] === '0' || !username) return false;
  return !expectedUsername || username === expectedUsername;
}

function extractSignUrl(base, html) {
  const patterns = [
    /function fx_checkin\(\)\{if \(!fx_chk_menu\)\{showWindow\('fx_checkin', '([^']+)'\);\}\}/i,
    /href=\"(plugin\.php\?id=fx_checkin:checkin[^\"#]+)\"[^>]*>签到领奖</i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return absoluteUrl(base, htmlDecode(match[1]));
  }
  return '';
}

function classifyResult(html) {
  const text = cleanText(html);
  const checks = [
    ['already', ['今日已签到', '您今日已经签到', '已经签到', '已签到']],
    ['success', ['签到成功', '恭喜你签到成功', '您今天第', '已连续签到']],
    ['cookie_invalid', ['请先登录', '用户名/Email', '现在就登录', '登录后']]
  ];
  for (const [status, words] of checks) {
    if (words.some((word) => text.includes(word))) {
      return { status, detail: text.slice(0, 500) };
    }
  }
  return { status: 'unknown', detail: text.slice(0, 500) };
}

function extractCreditAndSignInfo(html) {
  const creditMatch = html.match(/<a[^>]*id=\"extcreditmenu\"[^>]*>([\s\S]*?)<\/a>/i);
  const signInfoMatch = html.match(/<div class=\"tip_c\">([\s\S]*?)<\/div>/i);
  return {
    credit: creditMatch ? cleanText(creditMatch[1]) : '',
    signInfo: signInfoMatch ? cleanText(signInfoMatch[1]) : ''
  };
}

function parseInputValue(html, name) {
  const regex = new RegExp(`name=[\"']${name}[\"'][^>]*value=[\"']([^\"']*)[\"']`, 'i');
  const match = html.match(regex);
  return match ? htmlDecode(match[1]) : '';
}

function buildNotifyText(status, username, base, credit, signInfo) {
  const lines = [];
  if (status === 'success') {
    lines.push(`签到成功：${username}`);
  } else if (status === 'already') {
    lines.push(`今天已签：${username}`);
  } else if (status === 'cookie_invalid') {
    lines.push(`签到失败（登录态失效）：${username}`);
  } else if (status === 'sign_url_not_found') {
    lines.push(`签到失败（入口变化）：${username}`);
  } else {
    lines.push(`签到状态异常：${username || 'unknown'} / ${status.toUpperCase()}`);
  }
  if (signInfo) lines.push(signInfo);
  if (credit) lines.push(`当前${credit}`);
  if (base) lines.push(base);
  return lines.join('\n');
}

function notify(title, subtitle, message) {
  $notify(title, subtitle || '', message || '');
}

function shouldNotifyCapture() {
  const now = Date.now();
  const last = Number($prefs.valueForKey(CONFIG.captureNotifyKey) || '0');
  if (now - last < CONFIG.captureNotifyCooldownMs) {
    return false;
  }
  $prefs.setValueForKey(String(now), CONFIG.captureNotifyKey);
  return true;
}

function shouldNotifyDailyCookieSeen() {
  const today = new Date().toISOString().slice(0, 10);
  const last = $prefs.valueForKey(CONFIG.captureDailySeenKey) || '';
  if (last === today) {
    return false;
  }
  $prefs.setValueForKey(today, CONFIG.captureDailySeenKey);
  return true;
}

function shouldNotifyDailyCaptureMiss() {
  const today = new Date().toISOString().slice(0, 10);
  const last = $prefs.valueForKey(CONFIG.captureMissNotifyKey) || '';
  if (last === today) {
    return false;
  }
  $prefs.setValueForKey(today, CONFIG.captureMissNotifyKey);
  return true;
}

function extractUsefulCookie(rawCookie) {
  const jar = parseCookieString(rawCookie);
  const picked = new Map();
  for (const [name, value] of jar.entries()) {
    if (!name || !value) continue;
    // 福利吧这里不再只保留少数几个 cookie，避免不同 Discuz 变种命名导致抓取静默失败
    picked.set(name, value);
  }
  return stringifyCookieJar(picked);
}

function hasLoginCookie(cookie) {
  const jar = parseCookieString(cookie);
  const names = Array.from(jar.keys()).map((x) => String(x).toLowerCase());
  return names.some((name) =>
    name.includes('auth') ||
    name.includes('login') ||
    name.includes('member') ||
    name.includes('uid') ||
    name.includes('user') ||
    name.includes('saltkey') ||
    name.includes('sid') ||
    /^s[0-9a-z]+_/.test(name)
  );
}

function captureCookieMode() {
  const req = typeof $request !== 'undefined' ? $request : null;
  if (!req || !req.headers) {
    return false;
  }
  const url = req.url || '';
  const host = url.match(/^https?:\/\/([^/]+)/i);
  if (!host || !/^(www\.)?wnflb(2023|00|99)\.com$/i.test(host[1])) {
    return false;
  }

  const path = url.replace(/^https?:\/\/[^/]+/i, '') || '/';
  const isCapturePage = (
    path === '/' ||
    path.startsWith('/forum.php') ||
    path.startsWith('/member.php') ||
    path.startsWith('/plugin.php') ||
    path.startsWith('/guide.php')
  );
  if (!isCapturePage) {
    return false;
  }

  const accept = String(getHeader(req.headers, 'accept') || '').toLowerCase();
  if (accept && !accept.includes('text/html') && !accept.includes('application/xhtml+xml')) {
    return false;
  }

  const rawCookie = getHeader(req.headers, 'cookie') || '';
  const usefulCookie = extractUsefulCookie(rawCookie);
  if (!usefulCookie || !hasLoginCookie(usefulCookie)) {
    if (shouldNotifyDailyCaptureMiss()) {
      notify('福利吧 Cookie 抓取', '未拿到完整登录态', '脚本已命中，但当前这个页面请求里没有识别到完整登录 cookie，请确认是在已登录状态下打开论坛页面');
    }
    $done({});
    return true;
  }
  const changed = saveCookieStore(usefulCookie);
  if (changed && shouldNotifyCapture()) {
    notify('福利吧 Cookie 抓取', '成功', '已保存到 QuanX 本地存档');
  } else if (!changed && shouldNotifyDailyCookieSeen()) {
    notify('福利吧 Cookie 状态', '仍有效', '本地 cookie 未变化，今天已确认仍可读取');
  }
  $done({});
  return true;
}

async function getWorkingBase(state) {
  for (const base of CONFIG.domains) {
    try {
      await fetchText(state, absoluteUrl(base, 'forum.php?mobile=no'));
      return base;
    } catch (e) {}
  }
  throw new Error('所有候选域名都不可用');
}

async function loginWithPassword(state, base) {
  if (!CONFIG.login.username || !CONFIG.login.password) {
    throw new Error('cookie 已失效，且未配置账号密码');
  }
  const loginPage = await fetchText(state, absoluteUrl(base, 'member.php?mod=logging&action=login'));
  const formhash = parseInputValue(loginPage, 'formhash');
  const referer = parseInputValue(loginPage, 'referer');
  const loginhashMatch = loginPage.match(/member\.php\?mod=logging&amp;action=login&amp;loginsubmit=yes&amp;loginhash=([A-Za-z0-9]+)/i);
  if (!formhash || !referer || !loginhashMatch) {
    throw new Error('登录页字段解析失败');
  }
  const loginUrl = absoluteUrl(
    base,
    `member.php?mod=logging&action=login&loginsubmit=yes&loginhash=${loginhashMatch[1]}`
  );
  await postForm(
    state,
    loginUrl,
    {
      formhash,
      referer,
      username: CONFIG.login.username,
      password: CONFIG.login.password,
      questionid: CONFIG.login.questionid || '0',
      answer: CONFIG.login.answer || '',
      cookietime: '2592000',
      loginsubmit: 'true'
    },
    { Referer: absoluteUrl(base, 'member.php?mod=logging&action=login') }
  );
  const forumHtml = await fetchText(state, absoluteUrl(base, 'forum.php?mobile=no'));
  if (!isLoggedIn(forumHtml, CONFIG.login.username)) {
    throw new Error('账号密码登录后仍未进入登录态，请检查账号/密码/安全问题答案');
  }
  return extractUsername(forumHtml) || CONFIG.login.username;
}

async function main() {
  if (typeof $request !== 'undefined') {
    captureCookieMode();
    return;
  }

  const storedCookie = readCookieStore();
  if (!storedCookie) {
    throw new Error('当前没有本地 cookie，请先在 QuanX 打开福利吧网页并抓取 cookie');
  }

  const state = { cookie: storedCookie };
  const base = await getWorkingBase(state);
  const pcForumUrl = absoluteUrl(base, 'forum.php?mobile=no');
  let forumHtml = await fetchText(state, pcForumUrl);
  let username = extractUsername(forumHtml);

  if (!isLoggedIn(forumHtml, CONFIG.login.username || '')) {
    username = await loginWithPassword(state, base);
    forumHtml = await fetchText(state, pcForumUrl);
  }

  const signUrl = extractSignUrl(base, forumHtml);
  if (!signUrl) {
    const message = buildNotifyText('sign_url_not_found', username, base, '', 'PC 页面未找到签到入口，可能网站改版');
    notify('福利吧签到', '失败', message);
    console.log('RESULT: SIGN_URL_NOT_FOUND');
    console.log(`BASE: ${base}`);
    console.log(`USERNAME: ${username}`);
    console.log('DETAIL: PC 页面里没找到 fx_checkin 签到入口，可能网站改版。');
    return;
  }

  const signHtml = await fetchText(state, signUrl, { Referer: pcForumUrl });
  const result = classifyResult(signHtml);
  const latestForumHtml = await fetchText(state, pcForumUrl);
  const info = extractCreditAndSignInfo(latestForumHtml);
  const resultUser = username || CONFIG.login.username || 'unknown';
  const summary = buildNotifyText(result.status, resultUser, base, info.credit, info.signInfo);
  const subtitle = result.status === 'success' ? '成功' : result.status === 'already' ? '已签到' : '异常';

  console.log(`RESULT: ${result.status.toUpperCase()}`);
  console.log(`BASE: ${base}`);
  console.log(`USERNAME: ${resultUser}`);
  console.log(`SIGN_URL: ${signUrl}`);
  console.log(`CREDIT: ${info.credit}`);
  console.log(`SIGN_INFO: ${info.signInfo}`);
  console.log(`DETAIL: ${result.detail}`);

  notify('福利吧签到', subtitle, summary);
}

main()
  .catch((error) => {
    const message = `签到异常：${error.message || error}`;
    console.log(`RESULT: ERROR`);
    console.log(`DETAIL: ${error.message || error}`);
    notify('福利吧签到', '异常', message);
  })
  .finally(() => {
    if (typeof $request === 'undefined') $done();
  });
