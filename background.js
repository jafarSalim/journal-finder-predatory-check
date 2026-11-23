// Reads what the checker needs from the journal page in the current tab (only when you ask),
// keeps it in session storage and opens the report. Also adds a right-click entry that sends
// selected text (an abstract) to the journal finder.
export async function pageInfo(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = (n) => document.querySelector(`meta[name="${n}" i], meta[property="${n}" i]`)?.content || null;
      return {
        url: location.href,
        title: document.title,
        names: [meta("citation_journal_title"), meta("og:site_name"), meta("dc.publisher"), document.querySelector("h1")?.innerText, document.title]
          .filter(Boolean).map((s) => s.trim().slice(0, 200)),
        text: (document.body?.innerText || "").slice(0, 200000),
      };
    },
  });
  return result;
}

export async function openCheck(tabId) {
  const info = await pageInfo(tabId);
  const key = `page-${Date.now()}`;
  await chrome.storage.session.set({ [key]: info });
  await chrome.tabs.create({ url: chrome.runtime.getURL("check.html") + `?k=${key}` });
  return info;
}

export async function openFinder(text = "") {
  const key = `text-${Date.now()}`;
  if (text) await chrome.storage.session.set({ [key]: text });
  await chrome.tabs.create({ url: chrome.runtime.getURL("finder.html") + (text ? `?k=${key}` : "") });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "jf-find", title: "Find a journal for this text", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener((info) => { if (info.menuItemId === "jf-find") openFinder(info.selectionText || ""); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type === "check") openCheck(msg.tabId).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e.message || e) }));
  if (msg?.type === "find") openFinder(msg.text || "").then(() => reply({ ok: true }));
  return true;
});
globalThis.__pageInfo = pageInfo;
globalThis.__openCheck = openCheck;
globalThis.__openFinder = openFinder;
