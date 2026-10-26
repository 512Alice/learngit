// B站学习笔记助手 - 网页式入口
// 输入 B 站链接 → 抓字幕 → 一键发送豆包整理（思维导图 + 核心要点 + 关键节点）→ 可选自动存入 Obsidian。

(() => {
  const PENDING_KEY = 'bn_pending_submit';
  const OB_CFG_KEY = 'bn_obsidian_cfg';
  const $ = (sel) => document.querySelector(sel);

  // 环境检测：页面必须通过扩展加载（chrome-extension://）才能调用扩展 API。
  // 直接双击 app.html（file://）打开时 chrome API 不存在，给出明确引导。
  const hasExtApi = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.sendMessage;
  if (!hasExtApi) {
    const statusEl = document.querySelector('#bn-status');
    if (statusEl) {
      statusEl.textContent = '当前页面是用文件方式直接打开的，无法工作。请按下面步骤使用：\n' +
        '① 在 Edge 地址栏输入 edge://extensions，打开左下角「开发人员模式」；\n' +
        '② 点「加载解压缩的扩展」，选择 bilibili-note-extension 文件夹；\n' +
        '③ 点浏览器工具栏的蓝色「B」图标打开本页面（或在 B 站视频页点右下角「笔记」按钮）。';
    }
    const startBtn = document.querySelector('#bn-start');
    const sendBtn = document.querySelector('#bn-send');
    if (startBtn) startBtn.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  const state = {
    lines: null,
    title: '',
    raw: ''
  };

  function sendToBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  function setStatus(text) {
    const el = $('#bn-status');
    el.textContent = text;
    el.classList.remove('err');
  }

  function setFail(text) {
    const el = $('#bn-status');
    el.textContent = text;
    el.classList.add('err');
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function linesToRaw(lines) {
    return lines.map((ln) => '[' + fmtTime(ln.t) + '] ' + ln.text).join('\n');
  }

  function getP(url) {
    const m = String(url || '').match(/[?&]p=(\d+)/);
    return m ? m[1] : '';
  }

  // ---------- 抓字幕 ----------

  async function onStart() {
    const url = $('#bn-url').value.trim();
    if (!url) { setStatus('请先粘贴 B 站视频链接'); return; }
    if (!/bilibili\.com\/video\//.test(url)) { setStatus('链接格式不对：需要 bilibili.com/video/... 形式的视频页链接'); return; }

    const btn = $('#bn-start');
    btn.disabled = true;
    btn.textContent = '抓取中…';

    // 清空上一次的字幕，避免旧内容残留被误用
    state.lines = null;
    state.title = '';
    state.raw = '';
    $('#bn-video-title').textContent = '—';
    $('#bn-count').textContent = '0';
    $('#bn-subtitle').textContent = '正在抓取…';
    $('#bn-send').disabled = true;

    try {
      setStatus('正在抓取字幕…');
      // 优先从已打开的 B 站视频页内抓（复用页面登录态，最可靠）；失败再走纯接口
      let r = null;
      try {
        r = await sendToBg({ type: 'fetchSubtitleFromOpenTab' });
      } catch (e0) { /* 无已打开页面，走接口 */ }
      if (!r || !r.ok) {
        r = await sendToBg({ type: 'fetchSubtitleByUrl', url, p: getP(url) });
      }
      if (!r.ok) {
        setFail('抓取失败：' + r.error + '（请确认已打开该视频页面并登录 B 站；或该视频确实没生成字幕，换一个视频试试）');
        return;
      }

      state.lines = r.data.lines;
      state.title = r.data.title;
      state.raw = linesToRaw(r.data.lines);
      $('#bn-video-title').textContent = r.data.title;
      $('#bn-count').textContent = state.lines.length;
      $('#bn-subtitle').textContent = state.raw;
      $('#bn-send').disabled = false;
      setStatus('已获取 ' + state.lines.length + ' 条字幕（约 ' + (state.raw.length / 1000).toFixed(1) + 'k 字，来源：' + r.data.source + '）。请先核对下方字幕开头确实属于该视频，再发送。');
    } catch (e) {
      setFail('抓取失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '抓取字幕';
    }
  }

  // ---------- 发送到豆包 ----------

  async function onSend() {
    if (!state.raw) { setStatus('请先抓取字幕'); return; }

    // 发送前核对字幕开头，避免误发（B站个别视频的接口可能返回与分P不符的字幕）
    const head = state.raw.split('\n').slice(0, 3).join('\n');
    if (!confirm('请先核对字幕开头是否与视频内容一致：\n\n' + head + '\n\n确认发送到豆包整理？')) return;

    const btn = $('#bn-send');
    btn.disabled = true;
    btn.textContent = '正在打开豆包并发送…';
    try {
      const prompt =
        '你是学习笔记助手。请把下面这段 B 站视频字幕整理成一份结构清晰、内容充实的 Markdown 学习笔记，' +
        '直接输出笔记正文（Markdown 格式），不要输出任何多余的解释或标记。笔记结构如下：\n\n' +
        '# 《' + (state.title || '未识别') + '》\n\n' +
        '## 核心要点\n' +
        '按主题分成若干小节（用 ### 小标题区分），每个小节用条目列出知识点。要求：\n' +
        '- 覆盖字幕的全部主要内容，重要概念、公式、结论、原理展开讲清楚，不要只列关键词；\n' +
        '- 涉及公式、参数、电路、代码的地方完整保留；所有公式一律用标准 LaTeX 写在 ```latex 代码块内（如 I_D=I_S(e^{U_D/U_T}-1)、r_d=U_T/I_DQ），不要用普通文字描述公式；\n' +
        '- 正文中提及的所有物理量符号（如反向饱和电流 I_S、热电压 U_T、二极管电压 U_D、静态电流 I_DQ、动态电阻 r_d、开启电压 U_ON、击穿电压 U_BR、最大整流电流 I_F、最高反向工作电压 U_R、最高工作频率 f_M、静态工作点 Q、电源电压 V、电阻 R、电容 C、电感 L 等）一律写成行内公式形式 $...$（如 $I_S$、$U_T$、$r_d$、$U_{ON}$、$Q$），不要用纯文本字母；\n' +
        '- 条目按逻辑顺序组织，层次分明。\n\n' +
        '## 思维导图（点击可展开）\n' +
        '用可折叠的知识树呈现整段内容：每个核心板块一个可展开/收起的折叠块，点击标题即可展开该板块的详细解释。用 Obsidian callout 语法（渲染后是带标题的可折叠块）：\n' +
        '- 结构：3~5 个板块，覆盖视频全部核心内容；板块标题 2~6 字（如 半导体类型、PN结特性、二极管参数）；\n' +
        '- 每块展开内容为该板块的详细解释（2~4 条要点，每条把概念/原理/公式讲清楚，不要只列关键词）；\n' +
        '- 格式示例如下（内容按本视频实际主题替换）：\n' +
        '> [!note]- 半导体类型\n' +
        '> - N型半导体：掺入磷原子，失电子成固定正离子，多子是电子\n' +
        '> - P型半导体：掺入硼原子，俘获电子成固定负离子，多子是空穴\n' +
        '> - 多子与少子：多子是主要载流子，少子数量极少\n' +
        '（以上仅为格式示例，请按本视频实际内容生成）\n\n' +
        '## 关键节点\n' +
        '根据字幕中的 [mm:ss] 时间戳，整理视频的关键节点：重要概念、结论、公式、示例出现的时间点及该节点的一句话内容，' +
        '格式为 [mm:ss] 内容，按时间顺序排列，覆盖全部重要节点，不要只列开头结尾。\n\n' +
        '字幕内容：\n' + state.raw;

      await chrome.storage.local.set({ [PENDING_KEY]: { text: prompt, title: state.title, ts: Date.now() } });
      const r = await sendToBg({ type: 'openDoubao' });
      if (!r.ok) {
        setStatus('打开豆包失败：' + r.error + '。字幕已保存，请手动打开豆包粘贴发送。');
        return;
      }
      setStatus(r.data.alreadyOpen
        ? '已刷新豆包标签页，正在自动发送…（若未登录，请先登录后手动发送）'
        : '已打开豆包网页，正在自动发送…（若未登录，请先登录后手动发送）');
      btn.textContent = '已发送，去豆包查看（如未发送可再点一次）';
      btn.disabled = false;
    } catch (e) {
      setStatus('发送失败：' + e.message);
      btn.disabled = false;
      btn.textContent = '发送到豆包整理（思维导图 + 要点）';
    }
  }

  // ---------- 调试：内置测试字幕（不依赖 B 站登录） ----------

  const TEST_TITLE = 'PN结的形成与半导体二极管（调试字幕）';
  const TEST_SUBTITLE = [
    '[00:00] 接下来看 PN 结',
    '[00:04] 首先要知道 N 型半导体还有 P 型半导体',
    '[00:09] 回顾 N 型半导体掺入的是磷原子',
    '[00:13] 每掺入一个磷原子这个磷原子就会丢失一个电子',
    '[00:25] 失去一个电子它就变成了正离子',
    '[00:36] 正离子在简图中表示为一个圆圈加一个大写的正号',
    '[00:43] N 型半导体里面的多子是电子',
    '[00:53] 简图画出来N型半导体里面有很多正离子',
    '[01:07] 同时里面还有很多电子用实心黑点表示',
    '[01:24] N型半导体虽然多子是电子但是还有少量空穴',
    '[01:35] 空穴用空心圈表示',
    '[01:46] 这就是N型半导体的简图',
    '[01:52] P型半导体中掺入的是硼原子',
    '[01:57] 每掺入一个硼原子他就会从旁边抢一个电子过来',
    '[02:12] 硼原子得到一个电子就变成了硼负离子',
    '[02:48] 硼负离子的表示法就是一个圆圈里面加一个负号',
    '[02:57] P型半导体里面的多子是空穴',
    '[03:04] 简图表示为很多的硼负离子和很多的空穴',
    '[03:34] P型半导体多子是空穴但还有少数自由电子',
    '[04:29] PN结：同一块硅片上制作P型和N型半导体拼接形成',
    '[04:49] 扩散本质：载流子从高浓度向低浓度运动',
    '[05:01] 固定离子不能移动只有电子和空穴可以运动',
    '[06:13] 扩散相遇的电子与空穴发生复合湮灭',
    '[06:41] 复合后形成空间电荷区又称耗尽层',
    '[06:52] 内建电场方向由N区指向P区',
    '[08:41] 内建电场阻碍多子的扩散运动',
    '[10:20] 漂移运动定义载流子在电场力作用下的运动',
    '[12:50] 动态平衡条件扩散多子数目等于漂移少子数目',
    '[16:45] 伏安特性定义改变PN结电压测量电流得到V-I关系',
    '[18:05] 正向电压定义P区电位高于N区电位',
    '[18:55] 正向外加电场削弱内建电场',
    '[22:26] 反向电压定义N区电位高于P区电位',
    '[24:05] 反向电压下外电场使空间电荷区变宽加强内建电场',
    '[27:51] 反向饱和电流反向电压足够大后电流基本保持不变',
    '[28:22] 反向击穿反向电压达到击穿电压时发生击穿击穿后可稳压',
    '[29:57] PN结电流公式 I=I_S(e^(V/U_T)-1)',
    '[30:51] 参数说明 I_S反向饱和电流 U_T常温约26mV',
    '[34:19] 击穿分类齐纳击穿和雪崩击穿',
    '[36:54] PN结核心结论具有单向导电性',
    '[37:03] 二极管定义PN结封装外壳并引出电极引线',
    '[38:21] 二极管电极P端为阳极N端为阴极',
    '[42:00] 开启电压硅管约0.5V锗管约0.1V',
    '[44:14] 导通压降硅二极管0.7V锗二极管0.2V',
    '[45:52] 温度特性温度每升高10度反向饱和电流增大一倍',
    '[50:15] 二极管参数反向饱和电流越小单向导电性越好',
    '[53:28] 二极管等效电路恒压降模型和理想二极管模型',
    '[54:09] 恒压降模型硅管导通压降取0.7V反向截止电流为0',
    '[55:10] 理想二极管模型导通压降视为0等效导线'
  ].join('\n');

  async function onDebug() {
    state.title = TEST_TITLE;
    state.raw = TEST_SUBTITLE;
    state.lines = TEST_SUBTITLE.split('\n').map((ln) => ({ text: ln }));
    $('#bn-video-title').textContent = state.title;
    $('#bn-count').textContent = state.lines.length;
    $('#bn-subtitle').textContent = state.raw;
    $('#bn-send').disabled = false;
    setStatus('已载入内置测试字幕（' + state.lines.length + ' 条），开始发送到豆包…');
    onSend();
  }

  // ---------- Obsidian 设置 ----------

  async function loadObCfg() {
    try {
      const items = await new Promise((resolve) => chrome.storage.local.get([OB_CFG_KEY], resolve));
      const c = items[OB_CFG_KEY] || {};
      $('#ob-api').value = c.apiUrl || 'http://127.0.0.1:27123';
      $('#ob-key').value = c.apiKey || '';
      $('#ob-dir').value = c.dir || '';
    } catch (e) { /* 忽略 */ }
  }

  async function saveObCfg() {
    const dir = $('#ob-dir').value.trim();
    // 校验：保存目录必须是 vault 内的相对路径，不能是 C:\ 这类绝对路径
    if (/[\\:]/.test(dir)) {
      const st = $('#ob-status');
      st.textContent = '注意：保存目录应填 vault 内的相对路径（如 mynote 或 学习笔记/），不要带盘符和反斜杠（C:\\...）。当前值已按原样保存，可能写入失败。';
      st.classList.add('err');
    }
    const url = $('#ob-api').value.trim();
    let apiUrl = url || 'http://127.0.0.1:27123';
    // 校验：API 地址必须以 http:// 或 https:// 开头（曾出现误填扩展页自身地址导致 Failed to fetch）
    if (!/^https?:\/\//.test(apiUrl)) {
      const st = $('#ob-status');
      st.textContent = '注意：API 地址必须以 http:// 或 https:// 开头（如 http://127.0.0.1:27123），当前值 ' + apiUrl + ' 无效，已自动改用默认地址。';
      st.classList.add('err');
      apiUrl = 'http://127.0.0.1:27123';
    }
    const cfg = {
      apiUrl: apiUrl,
      apiKey: $('#ob-key').value.trim(),
      dir: dir
    };
    try {
      await chrome.storage.local.set({ [OB_CFG_KEY]: cfg });
      const st = $('#ob-status');
      st.textContent = '已保存。整理完成后的笔记会自动写入 Obsidian。';
      st.classList.remove('err');
    } catch (e) {
      const st = $('#ob-status');
      st.textContent = '保存设置失败：' + e.message;
      st.classList.add('err');
    }
  }

  async function onManualSave() {
    const content = $('#ob-manual').value;
    if (!content.trim()) {
      const st = $('#ob-manual-status');
      st.textContent = '请先粘贴笔记内容到上方文本框';
      st.classList.add('err');
      return;
    }
    const btn = $('#ob-manual-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const r = await sendToBg({
        type: 'saveNoteToObsidian',
        title: '手动笔记',
        content: content
      });
      const st = $('#ob-manual-status');
      if (r.ok) {
        st.textContent = '已保存：' + r.data.path;
        st.classList.remove('err');
      } else {
        st.textContent = '保存失败：' + r.error;
        st.classList.add('err');
      }
    } catch (e) {
      const st = $('#ob-manual-status');
      st.textContent = '保存失败：' + e.message;
      st.classList.add('err');
    }
    btn.disabled = false;
    btn.textContent = '保存到 Obsidian';
  }

  // ---------- 初始化 ----------

  // 从 URL 参数带过来的链接自动填入
  try {
    const q = new URLSearchParams(location.search);
    const u = q.get('url');
    if (u) $('#bn-url').value = u;
  } catch (e) { /* 忽略 */ }

  loadObCfg();

  $('#bn-start').addEventListener('click', onStart);
  $('#bn-send').addEventListener('click', onSend);
  $('#bn-debug').addEventListener('click', onDebug);
  $('#bn-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onStart();
  });
  $('#ob-save').addEventListener('click', saveObCfg);
  $('#ob-manual-save').addEventListener('click', onManualSave);
})();
