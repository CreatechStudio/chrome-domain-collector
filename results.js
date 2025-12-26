document.addEventListener('DOMContentLoaded', async () => {
  const resultBox = document.getElementById('resultBox');
  const statusDiv = document.getElementById('status');
  const copyBtn = document.getElementById('copyBtn');
  const closeBtn = document.getElementById('closeBtn');

  // 动态添加选项区域到界面中 (插在 resultBox 之前)
  const optionsDiv = document.createElement('div');
  optionsDiv.style.marginBottom = '15px';
  optionsDiv.style.padding = '10px';
  optionsDiv.style.backgroundColor = '#f9fafb';
  optionsDiv.style.borderRadius = '6px';
  optionsDiv.style.border = '1px solid #e5e7eb';

  optionsDiv.innerHTML = `
    <div style="margin-bottom: 8px;">
      <label style="display:flex; align-items:center; cursor:pointer; font-weight:600; color:#374151;">
        <input type="checkbox" id="wildcardToggle" style="margin-right:8px; transform:scale(1.2);">
        自动组合通配符 <span style="font-weight:normal; color:#6b7280; font-size: 12px; margin-left: 5px;">(a.test.com, b.test.com &rarr; *.test.com)</span>
      </label>
    </div>
    <div style="display:flex; align-items:center; flex-wrap: wrap; gap: 15px;">
      <label style="display:flex; align-items:center; cursor:pointer; font-weight:600; color:#374151;">
        <input type="checkbox" id="clashToggle" style="margin-right:8px; transform:scale(1.2);">
        Clash 模式格式化
      </label>
      <input type="text" id="clashSuffix" placeholder="策略后缀 (例如: DIRECT)" 
             style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 180px;">
    </div>
  `;
  resultBox.parentNode.insertBefore(optionsDiv, resultBox);

  const wildcardToggle = document.getElementById('wildcardToggle');
  const clashToggle = document.getElementById('clashToggle');
  const clashSuffixInput = document.getElementById('clashSuffix');

  // 从 Storage 获取结果和上次的选项偏好
  const data = await chrome.storage.local.get(['lastResult', 'useWildcard', 'useClashMode', 'clashSuffix']);
  const rawDomains = data.lastResult || [];
  
  // 恢复之前的 UI 状态
  if (data.useWildcard !== false) wildcardToggle.checked = true; // 默认开启通配符
  if (data.useClashMode) clashToggle.checked = true;
  if (data.clashSuffix) clashSuffixInput.value = data.clashSuffix;

  // 根据 Clash 模式初始状态设置输入框显隐/样式（可选优化，这里保持常显但逻辑依赖 toggle）
  updateInputState();

  if (rawDomains.length === 0) {
    resultBox.value = "没有抓取到域名，或者发生了错误。";
    return;
  }

  // 初始化显示 (不自动复制)
  updateDisplay();

  // --- 事件监听 ---

  // 1. 通配符开关
  wildcardToggle.addEventListener('change', () => {
    chrome.storage.local.set({ useWildcard: wildcardToggle.checked });
    updateDisplay();
  });

  // 2. Clash 模式开关
  clashToggle.addEventListener('change', () => {
    chrome.storage.local.set({ useClashMode: clashToggle.checked });
    updateInputState();
    updateDisplay();
  });

  // 3. 后缀输入框 (输入时实时更新预览，防抖保存)
  let timeoutId;
  clashSuffixInput.addEventListener('input', () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      chrome.storage.local.set({ clashSuffix: clashSuffixInput.value });
    }, 500);
    updateDisplay();
  });

  // 4. 按钮事件
  copyBtn.addEventListener('click', () => {
    copyToClipboard(resultBox.value);
  });

  closeBtn.addEventListener('click', () => {
    window.close();
  });

  function updateInputState() {
    clashSuffixInput.disabled = !clashToggle.checked;
    clashSuffixInput.style.opacity = clashToggle.checked ? '1' : '0.5';
  }

  // 核心功能：更新显示内容
  function updateDisplay() {
    // 1. 先处理通配符逻辑
    let domainList = [];
    if (wildcardToggle.checked) {
      domainList = processWildcards(rawDomains);
    } else {
      domainList = rawDomains;
    }

    // 2. 再处理 Clash 格式逻辑
    let finalText = "";
    
    if (clashToggle.checked) {
      const suffix = clashSuffixInput.value.trim();
      const suffixStr = suffix ? `,${suffix}` : ''; // 如果有后缀，前面加逗号
      
      const clashLines = domainList.map(domain => {
        if (domain.startsWith('*.')) {
          // 通配符处理: *.example.com -> DOMAIN-SUFFIX,example.com,DIRECT
          const cleanDomain = domain.substring(2); // 去掉 *.
          return `DOMAIN-SUFFIX,${cleanDomain}${suffixStr}`;
        } else {
          // 普通域名处理: example.com -> DOMAIN,example.com,DIRECT
          return `DOMAIN,${domain}${suffixStr}`;
        }
      });
      finalText = clashLines.join('\n');
    } else {
      // 普通模式，直接换行连接
      finalText = domainList.join('\n');
    }

    resultBox.value = finalText;
    
    // 注意：已移除 updateDisplay 中的 copyToClipboard 调用，现在只在点击按钮时复制
    // 重置状态栏提示，避免误导
    statusDiv.style.display = 'none'; 
  }

  // 通配符处理逻辑
  function processWildcards(domainList) {
    const groups = new Map();
    const singles = [];

    domainList.forEach(domain => {
      const parts = domain.split('.');
      // 只有当域名部分大于2个时才尝试合并 (保留 example.com, 避免 *.com)
      if (parts.length > 2) {
        // 提取父级域名 (从第一个点之后开始截取)
        const parent = parts.slice(1).join('.');
        
        if (!groups.has(parent)) {
          groups.set(parent, []);
        }
        groups.get(parent).push(domain);
      } else {
        singles.push(domain);
      }
    });

    const result = [...singles];

    groups.forEach((list, parent) => {
      // 如果同一个父级下有多个子域名，则合并为通配符
      if (list.length > 1) {
        result.push('*.' + parent);
      } else {
        // 只有一个的话，保持原样
        result.push(list[0]);
      }
    });

    return result.sort();
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      // 计算行数
      const count = text.trim() ? text.split('\n').length : 0;
      showStatus(`✅ 已成功复制！包含 ${count} 条规则。`);
    }).catch(err => {
      showStatus("❌ 复制失败，请手动复制。", false);
      console.error('复制失败', err);
    });
  }

  function showStatus(msg, isSuccess = true) {
    statusDiv.style.display = 'block';
    statusDiv.textContent = msg;
    statusDiv.className = 'status-bar ' + (isSuccess ? 'success' : '');
  }
});