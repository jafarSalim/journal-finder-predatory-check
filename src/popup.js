const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById("check").onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: "check", tabId: tab.id });
  if (!r?.ok) document.getElementById("msg").textContent = "This page cannot be read (browser pages, the Web Store and PDFs are off limits).";
  else window.close();
};
document.getElementById("find").onclick = async () => {
  let text = "";
  try { [{ result: text }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || "") }); } catch { /* no access */ }
  await chrome.runtime.sendMessage({ type: "find", text });
  window.close();
};
