// B站学习笔记助手 - 豆包网页内容脚本
// 职责：检测到 B站页传来的待发送内容（chrome.storage.local 的 bn_pending_submit）后，
// 自动填入豆包输入框并发送；发送后监控豆包的回答，整理完成自动保存到 Obsidian；
// 任一环节页面结构不支持时，自动复制到剪贴板并给出明确提示。

(() => {
  const PENDING_KEY = 'bn_pending_submit';
  // 每次注入都全新初始化：扩展重载后旧脚本实例失效但 window.__bnLoaded 标志残留，
  // 若沿用"已加载则复用"逻辑，新脚本会被失效的旧函数拦截导致本页永不再工作。
  // 防重复由以下机制保证：pending 消费（发送前即删除）+ window.__bnWatching（同页只监控一次）。
  window.__bnLoaded = true;
  console.log('[B站笔记助手] v3.7.21 内容脚本已注入 ' + location.host + ' | textarea=' + document.querySelectorAll('textarea').length + ' | contenteditable=' + document.querySelectorAll('[contenteditable]').length + ' | role=textbox=' + document.querySelectorAll('[role="textbox"]').length);

  // 找到可见的输入框，覆盖多种形态：textarea / contenteditable / role=textbox / 带"发消息"占位符
  function findEditor() {
    const visible = (el) => el.offsetParent !== null;

    let els = Array.from(document.querySelectorAll('textarea')).filter(visible);
    if (els.length) return els[0];

    els = Array.from(document.querySelectorAll('[contenteditable]')).filter(visible);
    if (els.length) return els[els.length - 1];

    els = Array.from(document.querySelectorAll('[role="textbox"]')).filter(visible);
    if (els.length) return els[els.length - 1];

    els = Array.from(document.querySelectorAll('textarea, [contenteditable], [role="textbox"]')).filter((el) => {
      if (!visible(el)) return false;
      const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
      return /(发消息|输入|提问|发送|ask|message)/i.test(ph);
    });
    if (els.length) return els[els.length - 1];

    return null;
  }

  // 向受控组件写入文本（兼容 React 及 ProseMirror 等编辑器）
  function setEditorText(editor, text) {
    editor.focus();
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return editor.value.length > 0;
    }
    // contenteditable：用 execCommand 模拟真实输入（对 React 受控组件更可靠）
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) { /* 走 textContent 兜底 */ }
    if (editor.textContent.length === 0) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return editor.textContent.length > 0;
  }

  // 尝试点击发送按钮（向后遍历，发送按钮一般在右下角 DOM 靠后）
  function clickSendButton() {
    const cands = [];
    document.querySelectorAll('button').forEach((b) => cands.push(b));
    document.querySelectorAll('[role="button"]').forEach((b) => cands.push(b));
    const pick = cands.reverse().find((b) => {
      if (b.offsetParent === null) return false;
      const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '') + ' ' + (b.getAttribute('data-testid') || '');
      return /发送|^send|发送消息/i.test(label);
    });
    if (pick) { pick.click(); return true; }
    return false;
  }

  // 在输入框上模拟回车（部分版本豆包用 Enter 发送）
  function pressEnter(editor) {
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      editor.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    });
  }

  // 输入框是否已被清空（发送成功后豆包会清空输入框）
  function editorEmpty(editor) {
    if (!editor) return true;
    return editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT'
      ? !editor.value
      : !editor.textContent.trim();
  }

  // 请求后台用 CDP 发送真实回车（React 受控组件只响应 isTrusted=true 的真实事件）
  function pressEnterReal() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'pressEnterReal' }, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  function copyFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  function showTip(text) {
    const div = document.createElement('div');
    div.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:340px;padding:10px 14px;' +
      'background:#fff;border:1px solid #d0d3d6;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);' +
      'font:12px/1.6 "Microsoft YaHei",sans-serif;color:#1f2329;white-space:pre-wrap;';
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 10000);
  }

  // ---------- 抓取豆包的回答 ----------

  // HTML 实体解码
  function decodeHtml(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }
  // 去掉标签只留文本（用于提取代码/标题内容）
  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }
  // 把豆包回答节点的 innerHTML 还原成 Markdown（innerText 会丢失 #、-、``` 等标记，导致 Obsidian 格式全乱）
  function htmlToMd(html) {
    let s = String(html || '');
    // 0) 丢弃页面渲染辅助区：<style>/<svg>（豆包"思维导图"渲染的 CSS/SVG 会污染 Markdown，必须先删）
    s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
    // 1) 代码块（含 mermaid/latex）：<pre>…</pre> → ```lang … ```
    s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, inner) => {
      // 移除 pre 内豆包页面渲染的语言标签 div（如 <div class="language-latex">latex</div>），避免混入代码内容
      inner = inner.replace(/<div[^>]*class="[^"]*language-[\w-]+"[^>]*>[\s\S]*?<\/div>/gi, '');
      const cls = /class="[^"]*language-([\w-]+)/.exec(inner) || [];
      const lang = cls[1] || '';
      let code = stripTags(inner).replace(/\n+$/, '').trim();
      // 兜底：若首行仍是语言名（latex/mermaid），去掉
      const firstLine = (code.split('\n')[0] || '').trim();
      if (firstLine === lang || firstLine === 'latex' || firstLine === 'mermaid') {
        code = code.split('\n').slice(1).join('\n').trim();
      }
      return '\n```' + lang + '\n' + code + '\n```\n';
    });
    // 2) 行内代码 → `code`
    s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, c) => '`' + stripTags(c) + '`');
    // 3) 公式：优先取 <annotation encoding="application/x-tex"> 里的标准 LaTeX，其次 aria-label，最后渲染文本
    // （katex/MathJax 渲染的 span 结构：annotation 或 aria-label 含原始公式源码，可还原标准下标/上标）
    s = s.replace(/<span[^>]*class="[^"]*katex[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, (m, inner) => {
      const ann = /<annotation[^>]*>([\s\S]*?)<\/annotation>/.exec(inner);
      if (ann && ann[1] && ann[1].trim()) return '$' + ann[1].trim() + '$';
      const label = /aria-label="([^"]*)"/.exec(m);
      if (label && label[1]) return '$' + label[1] + '$';
      const txt = stripTags(inner);
      return txt ? '$' + txt + '$' : '';
    });
    // 4) 标题 → # …（先处理，避免后面 stripTags 破坏）
    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => '\n' + '#'.repeat(+n) + ' ' + stripTags(t) + '\n');
    // 5) 加粗/斜体
    s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (m, t) => '**' + stripTags(t) + '**');
    s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (m, t) => '*' + stripTags(t) + '*');
    // 6) 无序列表项 → - 条目
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => '- ' + stripTags(t) + '\n');
    // 7) 段落/换行/表格行
    s = s.replace(/<\/p>/gi, '\n\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (m, t) => stripTags(t).replace(/\s+/g, ' | ').trim() + '\n');
    s = s.replace(/<th[^>]*>|<\/th>/gi, '');
    s = s.replace(/<td[^>]*>|<\/td>/gi, '');
    // 8) 移除剩余标签
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/&nbsp;/g, ' ');
    s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    // 9) 清理多余空行，去掉每行多余缩进
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.split('\n').map((ln) => ln.replace(/\s+$/g, '')).join('\n');
    // 10) 过滤豆包界面残留文案（思维导图渲染区的按钮/错误提示/品牌文案），清理零宽字符
    s = s.split('\n').filter((ln) => {
      const l = ln.trim();
      if (l.includes('生成失败') || l.includes('预览查看代码') || l.includes('豆包你的 AI 助手') || l.includes('助力每日工作学习')) return false;
      return true;
    }).join('\n');
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    // 11) 删除代码块前独立成行的语言名（豆包偶发在 ```latex/```mermaid 前多输出一行 "latex"/"mermaid"）
    s = s.replace(/^latex\s*\n(?=```latex)/gim, '');
    s = s.replace(/^mermaid\s*\n(?=```mermaid)/gim, '');
    return s.trim();
  }

  // 判定内容是否"明显的用户消息/字幕"：以 [mm:ss] 时间戳开头，且不含任何 Markdown 标记（#、```、|）
  // 豆包 AI 笔记回答会带 ## 标题/```mermaid/表格分隔符，字幕/用户消息没有 → 不保存
  function looksLikeUserMsg(t) {
    const s = String(t || '').trim();
    if (!/^\[\d{1,2}:\d{2}\]/.test(s)) return false;
    if (/[#`|]/.test(s)) return false;
    return true;
  }

  // 判定内容是否"笔记特征"：含 Markdown 标题（#）、代码块（```）、或核心要点/思维导图/关键节点等关键词
  // 豆包侧边栏历史对话列表、页面杂鱼文本不含这些特征 → 不保存
  function looksLikeNote(t) {
    const s = String(t || '');
    if (/#{1,6}\s/.test(s)) return true;
    if (s.includes('```')) return true;
    if (s.includes('核心要点') || s.includes('思维导图') || s.includes('关键节点')) return true;
    return false;
  }

  // 内容指纹：去空白后的长度 + 开头 60 字 —— 同一回答的不同快照（结尾/换行有细微差异）视为同一条
  function sig(t) {
    const s = String(t || '').replace(/\s+/g, '').trim();
    return s.length + ':' + s.slice(0, 60);
  }

  // 从页面提取"最后一条 AI 回答"文本（多候选选择器，兼容豆包页面结构变化）
  function extractAnswerText() {
    const STATE_RE = /(正在|思考|整理|生成|分析中|稍等|请稍候|加载中|回答中|努力|输入中)/;
    const sels = [
      '[data-testid*="assistant"]',
      '[data-testid*="answer"]',
      '[data-testid*="bot"]',
      '[class*="assistant"]',
      '[class*="answer"]',
      '[class*="message"][class*="bot"]',
      '[class*="message"][class*="ai"]',
      '[class*="markdown"]',
      '[class*="rich-text"]',
      '[class*="chat-content"]',
      '[class*="reply-content"]',
      '[class*="bot-answer"]',
      '[class*="message-content"]'
    ];
    for (const sel of sels) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => {
          if (el.offsetParent === null && el.getClientRects().length === 0) return false;
          // 排除输入框及其内部内容（避免把发送到输入框的字幕当成回答）
          if (el.closest && el.closest('[contenteditable], textarea, [role="textbox"]')) return false;
          // 排除用户消息（提示词+字幕回显），只保留 AI 回答
          if (el.closest && el.closest('[class*="user-message"], [class*="message-user"], [class*="user-message-content"], [data-testid*="user"], [class*="mine"], [class*="self"]')) return false;
          return true;
        });
        if (nodes.length) {
          // 拼接所有匹配节点的 HTML 并还原成 Markdown（豆包回答可能被拆成多个区块：核心要点/思维导图/关键节点）
          // 用 innerHTML+转换而非 innerText：保住 ## 标题、- 列表、```mermaid 代码块、公式等格式
          const raw = nodes.map((n) => htmlToMd(n.innerHTML || ''));
          let t = raw.filter((txt) => {
            if (txt.includes('字幕内容：')) return false;
            if (txt.includes('你是学习笔记助手')) return false;
            if (txt.includes('请把下面这段')) return false;
            return true;
          }).join('\n\n').trim();
          // 从"最后一次出现"的起始标志（# 《标题》/## 核心要点）开始截取：
          // 每条笔记回答都以这两者之一开头，最后一次出现 = 最新一条回答的起点，
          // 上一条/上上条历史回答全部切掉；同一条回答内部的思维导图/关键节点区块保留在其后
          const START_MARKERS = ['# 《', '## 核心要点'];
          let cutAt = -1;
          for (const mk of START_MARKERS) {
            const idx = t.lastIndexOf(mk);
            if (idx > cutAt) cutAt = idx;
          }
          if (cutAt > 0) t = t.slice(cutAt);
          // 截掉回答末尾豆包页面的"推荐提问/相关问题"（在最后一条 [mm:ss] 时间戳之后，或挤在同一行混入）
          const tsLines = t.split('\n');
          let lastTs = -1;
          for (let i = 0; i < tsLines.length; i++) {
            if (/^\[\d{1,2}:\d{2}\]/.test(tsLines[i].trim())) lastTs = i;
          }
          if (lastTs >= 0) {
            // 若最后一条时间戳行内混入了推荐问句（" 如何/ 怎样/ 为什么/ 哪些/ 是什么/ 怎么" 开头），在该位置截掉
            const lastLine = tsLines[lastTs];
            const q = /(\s(?:如何|怎样|为什么|哪些|是什么|怎么)\S)/.exec(lastLine);
            if (q && q.index > 6) tsLines[lastTs] = lastLine.slice(0, q.index);
            t = tsLines.slice(0, lastTs + 1).join('\n');
          }
          // 过滤加载/状态类短文本，避免把"正在整理中…"当成回答
          // 长度上限 8000：超出说明抓到的是输入框/聊天区里的字幕回显（上万字），忽略
          if (t.length > 20 && t.length <= 8000 && !(t.length < 200 && STATE_RE.test(t))) return t;
        }
      } catch (e) { /* 尝试下一个选择器 */ }
    }
    // 兜底：取最后一个"不含用户消息特征"的较长文本块（用户消息含提示词/字幕内容，AI 回答不含）
    try {
      const big = Array.from(document.querySelectorAll('div, section, main, article, [class*="message"]')).filter((el) => {
        if (el.offsetParent === null && el.getClientRects().length === 0) return false;
        if (el.closest && el.closest('[contenteditable], textarea, [role="textbox"]')) return false;
        const tt = (el.innerText || el.textContent || '').trim();
        if (tt.length <= 200 || tt.length > 8000) return false;
        if (tt.includes('字幕内容：')) return false;
        if (tt.includes('你是学习笔记助手')) return false;
        if (tt.includes('请把下面这段')) return false;
        return true;
      });
      if (big.length) {
        // 用 innerHTML 还原 Markdown 格式（保标题/列表/代码块），而非 innerText 纯文本
        const t = htmlToMd(big[big.length - 1].innerHTML || '');
        if (t.length > 200) return t;
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  // 豆包整理完成后，把回答保存到 Obsidian；未配置 Obsidian 时静默，其他失败复制兜底
  // 把笔记里的 ```latex 代码块转成 Obsidian 原生公式（$$...$$），由 Obsidian 内置 MathJax 渲染。
  // 零依赖、零网络、零第三方插件：Obsidian 内置渲染器必然可用，公式必然显示。
  function latexBlocksToDisplay(md) {
    return String(md || '').replace(/```latex\s*\n([\s\S]*?)```/g, (m, body) => {
      let inner = body.replace(/\s+$/g, '').trim();
      if (!inner) return m;
      // 去掉可能存在的完整 LaTeX 文档外壳（documentclass/usepackage/begin/end document）
      inner = inner
        .replace(/\\documentclass[^\n]*\n?/g, '')
        .replace(/\\usepackage\{[^}]*\}[^\n]*\n?/g, '')
        .replace(/\\begin\{document\}[^\n]*\n?|\n?\\end\{document\}/g, '')
        .trim();
      // 去掉可能包裹的单个 $ 或 $$（如此前版本包装的 $公式$）
      inner = inner.replace(/^\$\$?|\$\$?$/g, '').trim();
      return '\n$$\n' + inner + '\n$$\n';
    });
  }

  // 把正文里的物理量符号（IS、UT、UD、IDQ、rd、IF、UR、fM 等纯文本）转成行内公式 $...$，
  // 自动加下标；只处理非代码块/非公式块文本，避免破坏 LaTeX 公式块与 mermaid 思维导图。
  function inlineSymbolsToMath(md) {
    const symbols = [
      ['UBR', 'U_{BR}'], ['UON', 'U_{ON}'], ['IDQ', 'I_{DQ}'], ['IF', 'I_F'],
      ['UR', 'U_R'], ['fM', 'f_M'], ['IS', 'I_S'], ['UT', 'U_T'], ['UD', 'U_D'],
      ['rd', 'r_d'], ['uI', 'u_I'], ['uD', 'u_D'], ['id', 'i_d'], ['iD', 'i_D'],
      ['UO', 'U_O'], ['UI', 'U_I'], ['IO', 'I_O'], ['II', 'I_I'],
      ['U', 'U'], ['I', 'I'], ['Q', 'Q'], ['V', 'V'], ['R', 'R'], ['C', 'C'],
      ['L', 'L'], ['P', 'P'], ['N', 'N'], ['T', 'T']
    ];
    // 排除代码块（```...```）、公式块（$$...$$）、行内代码（`...`）
    const parts = String(md || '').split(/(\$\$[\s\S]*?\$\$|```[\s\S]*?```|`[^`\n]*`)/g);
    return parts.map((p, i) => {
      if (i % 2 === 1) return p; // 代码块/公式块/行内代码：不处理
      for (const [raw, tex] of symbols) {
        // 前后不能是字母/数字/下划线/$，避免误伤英文单词、单位（0.7V、26mV）、已生成的 $...$ 公式
        const re = new RegExp('(?<![A-Za-z0-9_$])' + raw + '(?![A-Za-z0-9_$])', 'g');
        p = p.replace(re, () => '$' + tex + '$');
      }
      return p;
    }).join('');
  }

  async function finishAnswer(content, title) {
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'saveNoteToObsidian', title: title || '', content: inlineSymbolsToMath(latexBlocksToDisplay(content)) });
    } catch (e) {
      resp = { ok: false, error: e.message };
    }
    if (resp && resp.ok) {
      showTip('笔记已自动写入 Obsidian：' + resp.data.path + '\n可到 Obsidian 中查看。');
      return;
    }
    const err = (resp && resp.error) || '未知错误';
    if (err === '__NOT_CONFIGURED__') {
      // 未配置 REST API 时，参照 Bili Clipper 用 obsidian:// 协议直接创建笔记（无需 API Key/插件配置）
      try {
        const safeName = String(title || 'B站笔记').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'B站笔记';
        const uri = 'obsidian://new?file=' + encodeURIComponent(safeName + '.md') + '&content=' + encodeURIComponent(content);
        await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'openUri', uri }, () => resolve()));
        showTip('已通过 obsidian:// 协议创建笔记：' + safeName + '\n（若 Obsidian 未响应，请在设置→第三方集成中允许 obsidian:// 链接）');
      } catch (e) {
        copyFallback(content);
        showTip('Obsidian 未配置且协议打开失败，笔记已复制到剪贴板，可粘贴到 Obsidian 保存。');
      }
      return;
    }
    copyFallback(content);
    showTip('豆包回答已复制到剪贴板（Obsidian 写入未成功：' + err + '）。\n可在 Obsidian 新建笔记粘贴保存，或在扩展页「手动保存」粘贴。');
  }

  // 发送成功后监控豆包的回答：文本稳定后视为整理完成
  function watchAnswer(title) {
    if (window.__bnWatching) return; // 同一页面只监控一次，防止多实例重复写文件
    window.__bnWatching = true;
    let answer = '';
    let stable = 0;
    let guard = 0;
    const tick = () => {
      if (guard++ > 100) { // 约 5 分钟超时
        showTip('等待豆包整理超时。请复制豆包的回答，到扩展页「手动保存」粘贴保存。');
        return;
      }
      const t = extractAnswerText();
      console.log('[B站笔记助手] 监控回答: 文本长度=' + (t ? t.length : 0) + ' 稳定次数=' + stable + ' 是否变化=' + (t !== answer));
      if (t && t !== answer) {
        if (t.length < answer.length * 0.5) {
          // 文本骤降：豆包回答完成后页面重排/新元素出现，选择器指向变化
          // 已抓到足够长的完整回答 → 立即保存（去重：同一内容只存一次）
          if (answer.length > 200 && sig(answer) !== lastSavedSig && !looksLikeUserMsg(answer) && looksLikeNote(answer)) {
            lastSavedSig = sig(answer);
            console.log('[B站笔记助手] 检测到回答完成（文本骤降），保存内容长度=' + answer.length);
            finishAnswer(answer, title);
            return;
          }
          // 否则视为抖动，忽略本次
        } else {
          answer = t;
          stable = 0;
        }
      } else if (t && t === answer) {
        stable++;
      }
      // 完整笔记通常超过 200 字；短文本（状态提示、占位）不判定完成
      if (answer.length > 200 && stable >= 2 && sig(answer) !== lastSavedSig && !looksLikeUserMsg(answer) && looksLikeNote(answer)) {
        lastSavedSig = sig(answer);
        console.log('[B站笔记助手] 判定完成，尝试写入 Obsidian，内容长度=' + answer.length);
        finishAnswer(answer, title);
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 4000);
  }

  // ---------- 发送主流程 ----------

  let dead = false;
  // 全局去重标记：同一段豆包回答只自动保存一次（扩展发送流程与持续自动保存共用）
  let lastSavedSig = '';
  async function trySend() {
    if (document.visibilityState !== 'visible') return; // 隐藏标签页不发送（多个豆包页时防重复发送）
    let items = null;
    try {
      items = await new Promise((resolve) => chrome.storage.local.get([PENDING_KEY], resolve));
    } catch (e) {
      // 扩展重载后旧脚本实例的上下文失效：停止轮询，避免反复报错
      dead = true;
      console.log('[B站笔记助手] 扩展上下文已失效（扩展被重载过），旧脚本停止轮询');
      return;
    }
    const pending = items ? items[PENDING_KEY] : null;
    if (!pending || !pending.text) return;

    const text = pending.text;
    const title = pending.title || '';

    const editor = findEditor();
    if (!editor) {
      // 页面可能还在加载（新打开的豆包页 React 未渲染完输入框）：保留 pending，等待下一轮轮询重试
      console.log('[B站笔记助手] 未找到豆包输入框（页面可能仍在加载），保留待发送，等待重试…');
      return;
    }
    // 找到输入框后移除待发送标记，防止轮询/多标签页重复发送
    chrome.storage.local.remove(PENDING_KEY);

    if (!setEditorText(editor, text)) {
      console.log('[B站笔记助手] 输入框写入失败');
      copyFallback(text);
      showTip('自动填写失败，字幕已复制到剪贴板，请手动粘贴到豆包输入框后发送。');
      return;
    }

    setTimeout(() => {
      let started = false;
      const startWatch = () => {
        if (!started) {
          started = true;
          showTip('已自动发送到豆包，正在整理笔记…完成后将尝试自动保存。');
          console.log('[B站笔记助手] 已发送字幕到豆包，开始监控回答');
          watchAnswer(title);
        }
      };
      const stillHasText = () => !editorEmpty(editor);
      if (clickSendButton()) {
        startWatch();
        return;
      }
      pressEnter(editor);
      setTimeout(() => {
        if (!stillHasText()) { startWatch(); return; }
        // 合成键盘事件通常不被 React 响应 → 用 CDP 发送真实回车（isTrusted=true）
        // CDP 回车前重新聚焦输入框（tab 激活/欢迎页切换可能丢失焦点）
        try { editor.focus(); } catch (e) {}
        pressEnterReal().then(() => {
          setTimeout(() => {
            if (!stillHasText()) { startWatch(); return; }
            pressEnter(editor);
            setTimeout(() => {
              if (!stillHasText()) {
                console.log('[B站笔记助手] 发送未成功（输入框仍有内容）');
                copyFallback(text);
                showTip('自动发送未成功，字幕已复制到剪贴板，请手动粘贴到豆包输入框后发送。');
              } else {
                startWatch();
              }
            }, 1200);
          }, 1500);
        });
      }, 1200);
    }, 600);
  }

  window.__bnTrySend = trySend;

  // ---------- 持续自动保存：用户手动在豆包提问/整理，回答完成后自动写入 Obsidian ----------
  // 不依赖扩展发送流程：只要豆包页面出现"新的 AI 回答"并稳定完成，就自动保存。
  // 同一回答只保存一次（用文本特征标记去重），短文本/状态提示不保存。
  function startAutoSave() {
    if (window.__bnAutoSave) return;
    window.__bnAutoSave = true;
    let prev = '';
    let stable = 0;
    let guard = 0;
    const tick = () => {
      if (guard++ > 600) return; // 30 分钟上限
      const t = extractAnswerText();
      console.log('[B站笔记助手] 自动保存监控: 文本长度=' + (t ? t.length : 0) + ' 稳定=' + stable + ' 变化=' + (t !== prev));
      if (t && t !== prev) {
        if (t.length < prev.length * 0.5) {
          // 文本骤降 = 上一轮回答完成、新回答开始：把上一轮足够长的回答保存
          if (prev.length > 200 && sig(prev) !== lastSavedSig && !looksLikeUserMsg(prev) && looksLikeNote(prev)) {
            lastSavedSig = sig(prev);
            console.log('[B站笔记助手] 自动保存（回答完成-骤降），长度=' + prev.length);
            finishAnswer(prev, '豆包笔记');
          }
          prev = '';
          stable = 0;
        } else {
          prev = t;
          stable = 0;
        }
      } else if (t && t === prev) {
        stable++;
        if (prev.length > 200 && stable >= 2 && sig(prev) !== lastSavedSig && !looksLikeUserMsg(prev) && looksLikeNote(prev)) {
          lastSavedSig = sig(prev);
          console.log('[B站笔记助手] 自动保存（回答稳定），长度=' + prev.length);
          finishAnswer(prev, '豆包笔记');
          prev = '';
          stable = 0;
        }
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 6000);
  }
  // 已停用（v3.7.33）：持续自动保存会与扩展发送流程重复生成"豆包笔记"文件。
  // 只保留扩展发送流程（视频标题命名）的自动保存。
  // startAutoSave();

  // 页面加载完成后轮询 + 监听 storage 变化（覆盖已打开豆包页再触发的情况）
  let tries = 0;
  const poll = () => {
    if (dead || tries++ >= 60) return;
    trySend();
    setTimeout(poll, 1000);
  };
  setTimeout(poll, 800);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PENDING_KEY]) trySend();
  });
})();
