// B站学习笔记助手 - 后台服务工作进程
// 职责：抓取B站视频CC字幕（含AI字幕）、打开/切换到豆包网页标签页、打开网页式入口页面。
// 所有网络请求放在这里执行，可绕开页面 CORS/CSP 限制。

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---------- B站 wbi 签名（与播放器一致，用于读取 AI 智能字幕） ----------

// MD5（RFC 1321）
function md5(input) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    return ((x >> 16) + (y >> 16) + (lsw >> 16) << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  const K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const bytes = unescape(encodeURIComponent(String(input)));
  const len = bytes.length;
  const n = ((len + 8) >> 6) + 1;
  const blocks = new Array(n * 16).fill(0);
  for (let i = 0; i < len; i++) blocks[i >> 2] |= bytes.charCodeAt(i) << ((i % 4) * 8);
  blocks[len >> 2] |= 0x80 << ((len % 4) * 8);
  blocks[n * 16 - 2] = len * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < blocks.length; i += 16) {
    const olda = a, oldb = b, oldc = c, oldd = d;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      const tmp = d;
      d = c; c = b;
      b = safeAdd(b, bitRotateLeft(safeAdd(safeAdd(a, f), safeAdd(blocks[i + g], K[j])), S[j]));
      a = tmp;
    }
    a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
  }
  return [a, b, c, d].map((w) => {
    w = w >>> 0;
    let s = '';
    for (let i = 0; i < 4; i++) s += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return s;
  }).join('');
}

const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
let wbiKey = null;
let wbiFetchedAt = 0;

// 获取 wbi 签名密钥（缓存 6 小时）
async function getWbiKey() {
  const now = Date.now();
  if (wbiKey && now - wbiFetchedAt < 6 * 3600 * 1000) return wbiKey;
  const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav');
  const wbi = nav.data && nav.data.wbi_img;
  if (!wbi || !wbi.img_url || !wbi.sub_url) throw new Error('获取B站签名密钥失败');
  const imgKey = wbi.img_url.split('/').pop().split('.')[0];
  const subKey = wbi.sub_url.split('/').pop().split('.')[0];
  const mixed = imgKey + subKey;
  let key = '';
  for (const i of MIXIN_TAB) key += mixed[i];
  wbiKey = key.slice(0, 32);
  wbiFetchedAt = now;
  return wbiKey;
}

// 生成带 wbi 签名的播放器接口 URL（与 B 站网页播放器一致）
async function wbiPlayerApi(aid, cid) {
  const key = await getWbiKey();
  const params = { aid: String(aid), cid: String(cid), wts: String(Math.floor(Date.now() / 1000)) };
  const sorted = Object.keys(params).sort()
    .map((k) => k + '=' + encodeURIComponent(params[k].replace(/[!'()*]/g, '')))
    .join('&');
  const w_rid = md5(sorted + key);
  return 'https://api.bilibili.com/x/player/wbi/v2?' + sorted + '&w_rid=' + w_rid;
}

// 把字幕 body 数组转成带时间戳的行
function toLines(body) {
  const lines = (Array.isArray(body) ? body : [])
    .map((x) => ({
      t: Number(x.from) || 0,
      text: String(x.content || '').trim()
    }))
    .filter((x) => x.text);
  if (!lines.length) throw new Error('字幕内容为空');
  return lines;
}

// 给定 aid+cid 查询播放器字幕列表并抓取（优先中文，含 AI 中文）
async function getSubtitleByAidCid(aid, cid) {
  let subs = [];
  // 1) 与 B 站播放器一致的 wbi 签名请求（读取 AI 智能字幕）
  try {
    const api = await wbiPlayerApi(aid, cid);
    const player = await fetchJson(api);
    subs = (player.data && player.data.subtitle && player.data.subtitle.subtitles) || [];
  } catch (e) { /* 继续兜底 */ }
  // 2) 兜底：无签名 v2 接口
  if (!subs.length) {
    try {
      const player = await fetchJson('https://api.bilibili.com/x/player/v2?aid=' + aid + '&cid=' + cid);
      subs = (player.data && player.data.subtitle && player.data.subtitle.subtitles) || [];
    } catch (e) { /* 忽略 */ }
  }
  if (!subs.length) throw new Error('没有读到字幕：该视频/分P 可能未生成AI字幕，或 Edge 未登录 B 站账号（AI智能字幕需登录才能读取）。请确认已登录，或换有字幕的视频');

  const score = (s) => {
    const lan = (s.lan || '').toLowerCase();
    const doc = (s.lan_doc || '').toLowerCase();
    if (lan === 'zh-cn' || lan === 'zh-hans' || lan === 'zh-hant') return 5;
    if (lan === 'ai-zh') return 4;
    if (lan.indexOf('zh') === 0) return 3;
    if (doc.indexOf('中文') >= 0 || doc.indexOf('简体') >= 0 || doc.indexOf('繁体') >= 0) return 3;
    if (lan.indexOf('ai') === 0) return 2;
    return 1;
  };
  subs.sort((a, b) => score(b) - score(a));
  // 优先选择字幕地址中含当前 cid 的条目（B站偶发把其他分P/视频的字幕混入列表）
  const cidStr = String(cid);
  const matched = subs.filter((s) => s.subtitle_url && String(s.subtitle_url).indexOf(cidStr) >= 0);
  const ordered = matched.length ? matched : subs;
  // 参照 Bili Clipper 的做法：按优先级逐个尝试下载字幕文件。
  // CC 字幕（UP 上传，lan=zh-CN）无需登录即可下载；AI 字幕未登录会 403，跳过继续试下一个。
  let lastErr = null;
  for (const s of ordered) {
    const raw = s.subtitle_url || '';
    const url = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
    if (url.indexOf('http') !== 0) continue;
    try {
      const data = await fetchJson(url);
      const lines = toLines(data.body);
      if (lines.length) return { lines, source: s.lan_doc || s.lan || '字幕' };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  if (lastErr) throw new Error('字幕文件下载失败（' + lastErr.message + '）。若为 403：AI 智能字幕需登录 B 站才能读取，可尝试有 CC 字幕的视频或先登录 B 站');
  throw new Error('没有读到可用的字幕：该视频/分P 可能未生成字幕，或仅 AI 字幕且 Edge 未登录 B 站');
}

// 从 B 站页面内抓字幕（当前分P，播放器已加载字幕优先）
async function fetchSubtitle(msg) {
  const { bvid, aid, cid, candidateUrl } = msg || {};

  if (candidateUrl && /^https:\/\//.test(candidateUrl)) {
    try {
      const data = await fetchJson(candidateUrl);
      return { lines: toLines(data.body), source: '播放器已加载字幕' };
    } catch (e) { /* 继续尝试接口 */ }
  }

  let realAid = aid, realCid = cid;
  if (!realAid || !realCid) {
    if (!bvid) throw new Error('缺少视频ID');
    const view = await fetchJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
    if (view.code !== 0 || !view.data) throw new Error('获取视频信息失败：' + (view.message || 'code=' + view.code));
    realAid = view.data.aid;
    realCid = view.data.cid;
  }
  const sub = await getSubtitleByAidCid(realAid, realCid);
  return { lines: sub.lines, source: sub.source };
}

// 从任意 B 站链接抓字幕（网页入口使用；支持 ?p=N 指定分P）
async function fetchSubtitleByUrl(msg) {
  const { url, p } = msg || {};
  const m = String(url || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (!m) throw new Error('链接中未找到 BV 号，请粘贴形如 https://www.bilibili.com/video/BVxxxx 的链接');
  const bvid = m[1];
  const view = await fetchJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
  if (view.code !== 0 || !view.data) throw new Error('获取视频信息失败：' + (view.message || 'code=' + view.code));
  const d = view.data;
  const pages = d.pages || [];
  const pi = Math.max(0, (parseInt(p, 10) || 1) - 1);
  const target = pages[pi] || pages[0];
  const aid = d.aid;
  const cid = target ? target.cid : d.cid;
  // v3.7.40：多P合集优先用分P小标题（pages[i].part）作为笔记标题
  let title = d.title;
  if (pages.length > 1 && target && target.part) {
    const part = String(target.part).trim();
    if (part && !/^(第\s*\d+\s*集?|P\s*\d+|\d+)$/i.test(part)) title = part;
    else title = d.title + '（P' + (pi + 1) + '/' + pages.length + '）';
  }
  const sub = await getSubtitleByAidCid(aid, cid);
  return { lines: sub.lines, source: sub.source, title, bvid, aid, cid, totalPages: pages.length };
}

// 从已打开的 B 站视频页"页面上下文"直接抓字幕（fetch 自动带页面 cookie = 复用 Edge 登录态，
// 不依赖 background service worker 的 cookie 传递；用户已打开视频页时优先走这条路）
const MIXIN_TAB_ARR = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

async function fetchSubtitleFromOpenTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
  if (!tabs.length) throw new Error('未找到已打开的 B 站视频页面：请先在 Edge 里打开这个视频（就是你现在的视频页），再点「抓取字幕」');
  const tab = tabs[tabs.length - 1];
  if (tab.id == null) throw new Error('B 站标签页无效');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (MIXIN_TAB_ARR) => {
      // 页面上下文执行：fetch 自动带页面 cookie（登录态）。注意：不能使用 eval（B站 CSP 禁止），MD5 直接写函数体。
      function md5(input) {
        function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return ((x >> 16) + (y >> 16) + (lsw >> 16) << 16) | (lsw & 0xffff); }
        function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
        const K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
        const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
        const bytes = unescape(encodeURIComponent(String(input)));
        const len = bytes.length;
        const n = ((len + 8) >> 6) + 1;
        const blocks = new Array(n * 16).fill(0);
        for (let i = 0; i < len; i++) blocks[i >> 2] |= bytes.charCodeAt(i) << ((i % 4) * 8);
        blocks[len >> 2] |= 0x80 << ((len % 4) * 8);
        blocks[n * 16 - 2] = len * 8;
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < blocks.length; i += 16) {
          const olda = a, oldb = b, oldc = c, oldd = d;
          for (let j = 0; j < 64; j++) {
            let f, g;
            if (j < 16) { f = (b & c) | (~b & d); g = j; }
            else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
            else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
            else { f = c ^ (b | ~d); g = (7 * j) % 16; }
            const tmp = d;
            d = c; c = b;
            b = safeAdd(b, bitRotateLeft(safeAdd(safeAdd(a, f), safeAdd(blocks[i + g], K[j])), S[j]));
            a = tmp;
          }
          a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
        }
        return [a, b, c, d].map((w) => {
          w = w >>> 0;
          let s = '';
          for (let i = 0; i < 4; i++) s += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
          return s;
        }).join('');
      }
      const toLines = (body) => (Array.isArray(body) ? body : [])
        .map((x) => ({ t: Number(x.from) || 0, text: String(x.content || '').trim() }))
        .filter((x) => x.text);
      return (async () => {
        const bvid = (location.href.match(/\/video\/(BV[0-9A-Za-z]+)/) || [])[1] || '';
        if (!bvid) return { ok: false, error: '页面未找到 BV 号' };
        let pi = parseInt((new URL(location.href)).searchParams.get('p') || '1', 10) || 1;
        const view = await (await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { credentials: 'include' })).json();
        if (!view || view.code !== 0 || !view.data) return { ok: false, error: '获取视频信息失败：' + ((view && view.message) || 'code=' + (view && view.code)) };
        const d = view.data;
        const aid = d.aid;
        const pages = d.pages || [];
        const target = pages[pi - 1] || pages[0];
        const cid = target ? target.cid : d.cid;
        // v3.7.40：多P合集优先用分P小标题（pages[i].part）作为笔记标题
        let title = d.title;
        if (pages.length > 1 && target && target.part) {
          const part = String(target.part).trim();
          if (part && !/^(第\s*\d+\s*集?|P\s*\d+|\d+)$/i.test(part)) title = part;
          else title = d.title + '（P' + pi + '/' + pages.length + '）';
        }
        let subs = [];
        // 1) v2 接口（页面上下文带 cookie，登录态直接可用）
        try {
          const player = await (await fetch('https://api.bilibili.com/x/player/v2?aid=' + aid + '&cid=' + cid, { credentials: 'include' })).json();
          subs = (player && player.data && player.data.subtitle && player.data.subtitle.subtitles) || [];
        } catch (e) { /* 继续 */ }
        // 2) 兜底：wbi 签名播放器接口（与播放器一致）
        if (!subs.length) {
          try {
            const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })).json();
            const wi = nav.data && nav.data.wbi_img;
            if (wi && wi.img_url && wi.sub_url) {
              const mixinKey = (orig) => { let s = ''; for (const i of MIXIN_TAB_ARR) s += orig[i]; return s.slice(0, 32); };
              const imgKey = wi.img_url.split('/').pop().split('.')[0];
              const subKey = wi.sub_url.split('/').pop().split('.')[0];
              const key = mixinKey(imgKey + subKey);
              const params = { aid: String(aid), cid: String(cid), wts: String(Math.floor(Date.now() / 1000)) };
              const sorted = Object.keys(params).sort().map((k) => k + '=' + encodeURIComponent(params[k].replace(/[!'()*]/g, ''))).join('&');
              const player = await (await fetch('https://api.bilibili.com/x/player/wbi/v2?' + sorted + '&w_rid=' + md5(sorted + key), { credentials: 'include' })).json();
              subs = (player && player.data && player.data.subtitle && player.data.subtitle.subtitles) || [];
            }
          } catch (e) { /* 忽略 */ }
        }
        if (!subs.length) return { ok: false, error: '没读到字幕：该分P可能没有AI字幕，或页面登录态失效。请确认视频播放器里能显示「字幕」' };
        const score = (s) => {
          const lan = (s.lan || '').toLowerCase();
          const doc = (s.lan_doc || '').toLowerCase();
          if (lan === 'zh-cn' || lan === 'zh-hans' || lan === 'zh-hant') return 5;
          if (lan === 'ai-zh') return 4;
          if (lan.indexOf('zh') === 0) return 3;
          if (doc.indexOf('中文') >= 0 || doc.indexOf('简体') >= 0 || doc.indexOf('繁体') >= 0) return 3;
          if (lan.indexOf('ai') === 0) return 2;
          return 1;
        };
        subs.sort((a, b) => score(b) - score(a));
        const cidStr = String(cid);
        const matched = subs.filter((s) => s.subtitle_url && String(s.subtitle_url).indexOf(cidStr) >= 0);
        const ordered = matched.length ? matched : subs;
        // 参照 Bili Clipper：逐个尝试下载（CC 字幕免登录；AI 字幕未登录 403 则跳过）
        let lastErr = null;
        for (const s of ordered) {
          let raw = s.subtitle_url || '';
          const url = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
          if (url.indexOf('http') !== 0) continue;
          try {
            const data = await (await fetch(url, { credentials: 'include' })).json();
            const lines = toLines(data.body);
            if (lines.length) return { ok: true, lines, source: s.lan_doc || s.lan || '字幕', title, bvid, aid, cid, totalPages: pages.length };
          } catch (e) { lastErr = e; continue; }
        }
        if (lastErr) return { ok: false, error: '字幕文件下载失败（' + lastErr.message + '）。AI 字幕需登录 B 站，可尝试有 CC 字幕的视频' };
        return { ok: false, error: '没有读到可用字幕：该分P可能无字幕，或仅 AI 字幕且页面未登录' };
      })();
    },
    args: [MIXIN_TAB_ARR]
  });
  const r = results && results[0] && results[0].result;
  if (!r) throw new Error('在 B 站页面执行抓取失败');
  if (!r.ok) throw new Error(r.error);
  return { lines: r.lines, source: r.source, title: r.title, bvid: r.bvid, aid: r.aid, cid: r.cid, totalPages: r.totalPages };
}

// 通过 Obsidian 的 Local REST API 插件把笔记写入笔记库（vault）
async function saveNoteToObsidian({ title, content }) {
  const items = await chrome.storage.local.get(['bn_obsidian_cfg']);
  const c = items.bn_obsidian_cfg || {};
  const base = (c.apiUrl || 'http://127.0.0.1:27123').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) {
    throw new Error('API 地址格式错误：' + base + '（应以 http:// 或 https:// 开头，如 http://127.0.0.1:27123）。请在扩展页「Obsidian 自动保存设置」里重新填写并保存设置。');
  }
  const key = c.apiKey || '';
  if (!key) throw new Error('__NOT_CONFIGURED__'); // 未配置 Obsidian，内容脚本会静默处理
  let dir = (c.dir || '').replace(/^\/+|\/+$/g, '');
  // 兼容 Windows 绝对路径：自动转为 vault 内相对路径（取最后一段）
  if (/[\\:]/.test(dir) && /[\\]/.test(dir)) {
    const seg = dir.replace(/\\/g, '/').split('/').filter(Boolean);
    dir = seg.length > 0 ? seg[seg.length - 1] : '';
  }
  const safe = String(title || 'B站笔记').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'B站笔记';
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = safe + '-' + ts + '.md';
  const path = dir ? dir + '/' + filename : filename;
  let res;
  try {
    // content 前加 BOM（\uFEFF）：保证文件是 UTF-8 with BOM，
    // Windows 记事本/各类编辑器都能正确识别，避免"无 BOM UTF-8 被按 GBK 显示成乱码"
    res = await fetch(base + '/vault/' + encodeURI(path), {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'text/markdown; charset=utf-8' },
      body: '\uFEFF' + content
    });
  } catch (err) {
    throw new Error('连接 Obsidian 失败（' + (err && err.name ? err.name : '未知错误') + '）：' + (err && err.message ? err.message : '') + '｜API地址=' + base + '｜目录=' + dir + '｜Key已配置=' + (key ? '是' : '否') + '（可复制此提示发回排查）');
  }
  if (!res.ok) {
    throw new Error('Obsidian 写入失败 HTTP ' + res.status + '：请确认 Obsidian 已打开、Local REST API 插件已启用，且上方 API 地址与 Key 填写正确');
  }
  return path;
}

// 用 CDP（chrome.debugger）向豆包页发送真实回车（合成键盘事件 React 不响应，此事件 isTrusted=true）
async function pressEnterReal() {
  const tabs = await chrome.tabs.query({ url: 'https://www.doubao.com/*' });
  const tab = tabs.find((t) => !t.pinned);
  if (!tab || tab.id == null) return { ok: false, error: '未找到豆包标签页' };
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    // CDP 回车前先聚焦输入框（tab 刚激活/欢迎页切换时焦点可能不在输入框，回车会落空）
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
        expression: "(function(){var el=document.querySelector('textarea,[contenteditable],[role=\"textbox\"]');if(el){el.focus();try{el.click();}catch(e){}}return true;})()"
      });
    } catch (e1) { /* 聚焦失败不阻断，继续尝试回车 */ }
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await chrome.debugger.detach({ tabId: tab.id });
    return { ok: true };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId: tab.id }); } catch (e2) { /* 忽略 */ }
    return { ok: false, error: e.message };
  }
}

// 打开或切换到豆包网页（已打开则聚焦，未打开则新建标签页）
async function openDoubaoTab() {
  const url = 'https://www.doubao.com/chat/';
  const tabs = await chrome.tabs.query({ url: 'https://www.doubao.com/*' });
  const hit = tabs.find((t) => !t.pinned);
  if (hit && hit.id != null) {
    // 优先直接向已打开的豆包页注入脚本（无需刷新页面，不丢聊天记录、可连续发送）。
    // 页面已有脚本时脚本内部会跳过初始化并直接触发一次发送检查。
    try {
      await chrome.scripting.executeScript({
        target: { tabId: hit.id },
        files: ['content-doubao.js']
      });
    } catch (e) {
      // 注入失败（极少见）：退回刷新页面，确保脚本生效
      try { await chrome.tabs.reload(hit.id); } catch (e2) { /* 忽略 */ }
    }
    await chrome.tabs.update(hit.id, { active: true });
    if (hit.windowId != null) await chrome.windows.update(hit.windowId, { focused: true });
    return { alreadyOpen: true };
  }
  const created = await chrome.tabs.create({ url, active: true });
  return { alreadyOpen: false, tabId: created.id };
}

// 打开网页式入口（可携带 B 站链接参数）
function openApp(url) {
  const base = chrome.runtime.getURL('app.html');
  const target = url ? base + '?url=' + encodeURIComponent(url) : base;
  return chrome.tabs.create({ url: target, active: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'fetchSubtitle':
        return await fetchSubtitle(msg);
      case 'fetchSubtitleByUrl':
        return await fetchSubtitleByUrl(msg);
      case 'fetchSubtitleFromOpenTab':
        return await fetchSubtitleFromOpenTab();
      case 'openDoubao':
        return await openDoubaoTab();
      case 'pressEnterReal':
        return await pressEnterReal();
      case 'saveNoteToObsidian':
        return await saveNoteToObsidian({ title: msg.title, content: msg.content });
      case 'openUri':
        // 用浏览器打开自定义协议 URI（如 obsidian://new?...），触发 Obsidian 等本地应用处理
        await chrome.tabs.create({ url: msg.uri, active: false });
        return { opened: true };
      case 'openApp':
        return await openApp(msg.url);
      default:
        throw new Error('未知消息类型');
    }
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
  return true; // 保持消息通道开放以支持异步响应
});

// 点击工具栏图标 → 打开网页式入口
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html'), active: true });
});
