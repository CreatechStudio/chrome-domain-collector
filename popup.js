document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('urlInput');
  const exclusionInput = document.getElementById('exclusionInput');
  const autoCloseCheckbox = document.getElementById('autoCloseCheckbox');
  const startBtn = document.getElementById('startBtn');

  // 1. 加载上次保存的配置
  const data = await chrome.storage.local.get(['lastUrl', 'savedExclusions', 'autoCloseSource']);
  
  if (data.lastUrl) urlInput.value = data.lastUrl;
  if (data.savedExclusions) exclusionInput.value = data.savedExclusions;
  
  // 恢复自动关闭选项的状态 (默认为 true)
  if (data.autoCloseSource !== undefined) {
    autoCloseCheckbox.checked = data.autoCloseSource;
  } else {
    autoCloseCheckbox.checked = true;
  }

  // 2. 绑定点击事件
  startBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    const exclusionText = exclusionInput.value.trim();
    const autoClose = autoCloseCheckbox.checked;
    
    if (!url) {
      alert("请输入有效的 URL");
      return;
    }

    // 将排除文本转换为数组，过滤空行
    const exclusions = exclusionText.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // 保存当前配置，方便下次使用
    chrome.storage.local.set({
      lastUrl: url,
      savedExclusions: exclusionText,
      autoCloseSource: autoClose
    });

    // 发送消息给 background.js 开始任务
    chrome.runtime.sendMessage({
      action: "START_ANALYSIS",
      url: url,
      exclusions: exclusions,
      autoClose: autoClose // 传递自动关闭参数
    });

    // 关闭 popup
    window.close();
  });
});