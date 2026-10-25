// B站学习笔记助手 - B站页面内容脚本
// 页面右下角显示「笔记」按钮，点击打开网页式入口（自动带上当前视频链接）。

(() => {
  if (window.__biliNoteInjected) return;
  window.__biliNoteInjected = true;

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

  const fab = document.createElement('button');
  fab.id = 'bn-fab';
  fab.textContent = '笔记';
  fab.title = '打开B站学习笔记助手（网页式入口）';
  document.body.appendChild(fab);

  fab.addEventListener('click', async () => {
    fab.disabled = true;
    fab.textContent = '打开中…';
    try {
      await sendToBg({ type: 'openApp', url: location.href });
    } finally {
      fab.disabled = false;
      fab.textContent = '笔记';
    }
  });
})();
