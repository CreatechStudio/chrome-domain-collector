// 存储当前正在记录的任务状态
let activeTask = {
  tabId: null,
  isRecording: false,
  domains: new Set(),
  exclusions: [],
  autoClose: false // 新增状态字段
};

// 监听来自 Popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_ANALYSIS") {
    startAnalysis(request.url, request.exclusions, request.autoClose);
    sendResponse({ status: "started" });
  }
});

// 开始分析流程
async function startAnalysis(targetUrl, userExclusions, autoClose) {
  // 重置状态
  activeTask.domains.clear();
  activeTask.exclusions = userExclusions || [];
  activeTask.isRecording = true;
  activeTask.autoClose = autoClose; // 记录用户偏好

  // 默认排除规则 (Chrome 内部页面和扩展页面)
  activeTask.exclusions.push("chrome-extension://");
  activeTask.exclusions.push("chrome://");
  activeTask.exclusions.push("devtools://");

  // 创建新标签页
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  activeTask.tabId = tab.id;
}

// 监听网络请求
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // 仅记录当前任务标签页的请求，且处于记录状态
    if (!activeTask.isRecording || details.tabId !== activeTask.tabId) {
      return;
    }

    try {
      const urlObj = new URL(details.url);
      const domain = urlObj.hostname;
      const fullProtocol = urlObj.protocol + "//"; // e.g., chrome-extension://

      // 检查是否在排除列表中
      let isExcluded = false;
      for (const rule of activeTask.exclusions) {
        if (!rule) continue;
        // 支持简单的字符串包含匹配 (既匹配域名，也匹配协议头)
        if (domain.includes(rule) || fullProtocol.includes(rule)) {
          isExcluded = true;
          break;
        }
      }

      if (!isExcluded && domain) {
        activeTask.domains.add(domain);
      }
    } catch (e) {
      console.error("URL解析错误:", e);
    }
  },
  { urls: ["<all_urls>"] }
);

// 监听标签页更新状态，判断何时结束
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (activeTask.isRecording && tabId === activeTask.tabId) {
    if (changeInfo.status === 'complete') {
      // 页面加载完成，给予额外 2 秒的缓冲时间等待异步请求
      setTimeout(() => {
        finishTask();
      }, 2000);
    }
  }
});

// 监听标签页关闭 (如果用户手动关闭了正在分析的页面)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTask.isRecording && tabId === activeTask.tabId) {
    finishTask(true); // 传入 true 表示是由关闭事件触发的
  }
});

// 结束任务并打开结果页
async function finishTask(fromRemoved = false) {
  if (!activeTask.isRecording) return;
  
  activeTask.isRecording = false;
  
  // 将 Set 转为数组并排序
  const domainList = Array.from(activeTask.domains).sort();

  // 保存结果到本地存储，以便结果页读取
  await chrome.storage.local.set({ 
    "lastResult": domainList,
    "sourceUrl": activeTask.tabId
  });

  // 打开结果展示页
  chrome.tabs.create({ url: "results.html" });

  // 如果启用了自动关闭，且不是因为手动关闭触发的任务结束，则关闭源标签页
  if (activeTask.autoClose && !fromRemoved && activeTask.tabId) {
    try {
      // 尝试获取标签页以确认它存在
      chrome.tabs.get(activeTask.tabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          chrome.tabs.remove(activeTask.tabId);
        }
      });
    } catch (e) {
      console.warn("无法关闭标签页:", e);
    }
  }
}