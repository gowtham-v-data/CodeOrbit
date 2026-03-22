// ═══════════════════════════════════════════════════════════════
//  CodeOrbit — Renderer (Terminal + Git + Full IDE)
// ═══════════════════════════════════════════════════════════════

(function() {
let ipcRenderer, path, Terminal, FitAddon;

// ═══ TOP-LEVEL MODULE LOADING (Safe) ═══
try {
  ipcRenderer = nodeRequire("electron").ipcRenderer;
  path = nodeRequire("node:path");
  Terminal = nodeRequire("xterm").Terminal;
  FitAddon = nodeRequire("xterm-addon-fit").FitAddon;
} catch (e) {
  console.error("❌ Failed to load native modules:", e);
  alert("CodeOrbit Error: Native modules could not be loaded. Please ensure you are running in Electron with nodeIntegration enabled.\nDetails: " + e.message);
}

let editor = null, currentFolder = null, openTabs = [], activeTab = null;

// ═══ Terminal State ═══
const terminalInstances = []; // { id, term, fitAddon, viewEl }
let activeTerminal = null;

// ═══ Monaco Init ═══
function initEditor() {
  monaco.editor.defineTheme("gowtham-dark", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment", foreground: "6a9955", fontStyle: "italic" },
      { token: "keyword", foreground: "569cd6" },
      { token: "keyword.control", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "type", foreground: "4ec9b0" },
      { token: "function", foreground: "dcdcaa" },
      { token: "variable", foreground: "9cdcfe" },
      { token: "tag", foreground: "569cd6" },
      { token: "attribute.name", foreground: "9cdcfe" },
      { token: "attribute.value", foreground: "ce9178" },
    ],
    colors: {
      "editor.background": "#1e1e1e", "editor.foreground": "#d4d4d4",
      "editor.lineHighlightBackground": "#2a2d2e", "editor.selectionBackground": "#264f78",
      "editorCursor.foreground": "#aeafad", "editorLineNumber.foreground": "#858585",
      "editorLineNumber.activeForeground": "#c6c6c6",
      "scrollbarSlider.background": "rgba(121,121,121,0.4)",
    },
  });

  editor = monaco.editor.create(document.getElementById("editor-container"), {
    value: "", language: "python", theme: "gowtham-dark",
    fontFamily: '"JetBrains Mono","Cascadia Code",Consolas,monospace',
    fontSize: 14, lineHeight: 20, fontLigatures: true,
    minimap: { enabled: true }, scrollBeyondLastLine: true,
    automaticLayout: true, cursorBlinking: "blink",
    cursorSmoothCaretAnimation: "on", smoothScrolling: true, tabSize: 4,
    renderLineHighlight: "line", renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true }, padding: { top: 4 },
  });

  editor.onDidChangeCursorPosition(() => {
    const p = editor.getPosition();
    const sels = editor.getSelections();
    let statusText = `Ln ${p.lineNumber}, Col ${p.column}`;
    
    if (sels && sels.length > 1) {
      statusText += ` (${sels.length} cursors)`;
    } else if (sels && sels.length === 1 && !sels[0].isEmpty()) {
      const s = sels[0];
      const lineCnt = Math.abs(s.endLineNumber - s.startLineNumber) + 1;
      const charCnt = editor.getModel().getValueInRange(s).length;
      statusText += ` (Selected ${charCnt} chars, ${lineCnt} lines)`;
    }
    document.getElementById("status-cursor").textContent = statusText;
  });
  editor.onDidChangeModelContent(() => {
    if (activeTab !== null && openTabs[activeTab]) {
      openTabs[activeTab].modified = true; updateTabUI(); updateOpenEditors();
    }
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentFile);
  editor.addCommand(monaco.KeyCode.F5, runCode);
}

// ═══ File Explorer ═══
async function openFolder() {
  const fp = await ipcRenderer.invoke("open-folder");
  if (fp) { currentFolder = fp; loadFolderUI(fp); showNotification("Opened: " + path.basename(fp), "info"); refreshGitStatus(); }
}

function loadFolderUI(fp) {
  currentFolder = fp;
  document.getElementById("folder-header").style.display = "flex";
  document.getElementById("folder-name-text").textContent = path.basename(fp);
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("window-title").textContent = path.basename(fp) + " — CodeOrbit";
  renderFileTree(fp);
}

async function renderFileTree(dir) {
  const tree = document.getElementById("file-tree");
  const es = document.getElementById("empty-state");
  if (es) es.style.display = "none";
  Array.from(tree.children).forEach(c => { if (!c.classList?.contains("empty-state")) c.remove(); });
  await buildTree(dir, tree, 0);
}

async function buildTree(dir, container, depth) {
  const items = await ipcRenderer.invoke("read-directory", dir);
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "tree-item"; div.style.paddingLeft = 8 + depth * 16 + "px";
    if (item.isDirectory) {
      const chev = el("i", "fas fa-chevron-right chevron");
      const ico = el("span", "icon icon-folder"); ico.textContent = "📁";
      const nm = el("span", "name"); nm.textContent = item.name;
      div.append(chev, ico, nm);
      const child = el("div", "tree-children collapsed"); let loaded = false;
      div.addEventListener('click', async e => {
        e.stopPropagation();
        if (!child.classList.contains("collapsed")) {
          child.classList.add("collapsed"); chev.classList.remove("expanded"); ico.textContent = "📁";
        } else {
          if (!loaded) { await buildTree(item.path, child, depth + 1); loaded = true; }
          child.classList.remove("collapsed"); chev.classList.add("expanded"); ico.textContent = "📂";
        }
      });
      div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showFileContextMenu(e.clientX, e.clientY, item.path, true); });
      container.append(div, child);
    } else {
      const sp = el("span"); sp.style.cssText = "width:16px;min-width:16px;display:inline-block;";
      const info = fileIcon(path.extname(item.name).toLowerCase());
      const ico = el("span", `icon ${info.cls}`); ico.textContent = info.em;
      const nm = el("span", "name"); nm.textContent = item.name;
      div.append(sp, ico, nm); div.dataset.filepath = item.path;
      div.addEventListener("click", e => { e.stopPropagation(); openFile(item.path); });
      div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showFileContextMenu(e.clientX, e.clientY, item.path, false); });
      container.appendChild(div);
    }
  });
}

// (el helper removed from here, now defined at line 364)

function fileIcon(ext) {
  const m = {
    ".py": { em: "🐍", cls: "icon-python" }, ".js": { em: "JS", cls: "icon-javascript" },
    ".ts": { em: "TS", cls: "icon-typescript" }, ".html": { em: "🌐", cls: "icon-html" },
    ".css": { em: "🎨", cls: "icon-css" }, ".json": { em: "{ }", cls: "icon-json" },
    ".md": { em: "📝", cls: "icon-markdown" }, ".java": { em: "☕", cls: "icon-java" },
    ".cpp": { em: "C+", cls: "icon-cpp" }, ".c": { em: "C", cls: "icon-c" },
    ".txt": { em: "📄", cls: "icon-default" }, ".gitignore": { em: "🔒", cls: "icon-default" },
  };
  return m[ext] || { em: "📄", cls: "icon-default" };
}

function langFromExt(ext) {
  const m = {
    ".py": "python", ".js": "javascript", ".ts": "typescript", ".html": "html",
    ".css": "css", ".json": "json", ".md": "markdown", ".java": "java", ".cpp": "cpp",
    ".c": "c", ".txt": "plaintext"
  };
  return m[ext] || "plaintext";
}

// ═══ File Manipulation ═══
window.createAndOpenFile = async function (filePath, content) {
  const result = await ipcRenderer.invoke("write-file-direct", filePath, content);
  if (result.success) {
    if (currentFolder) renderFileTree(currentFolder);
    await openFile(result.path);
    showNotification(`File ${path.basename(result.path)} created and opened`, "success");
    return true;
  } else {
    showNotification("Failed to create file: " + result.error, "error");
    return false;
  }
};

// ═══ Tabs ═══
async function openFile(fp) {
  const idx = openTabs.findIndex(t => t.filePath === fp);
  if (idx !== -1) { switchTab(idx); return; }
  const content = await ipcRenderer.invoke("read-file", fp);
  if (content === null) { showNotification("Cannot open file", "error"); return; }
  const ext = path.extname(fp).toLowerCase(), lang = langFromExt(ext);
  const uri = monaco.Uri.file(fp);
  let model = monaco.editor.getModel(uri);
  if (model) model.setValue(content); else model = monaco.editor.createModel(content, lang, uri);
  openTabs.push({ filePath: fp, model, viewState: null, modified: false, language: lang });
  switchTab(openTabs.length - 1);
  document.getElementById("language-selector").value = lang; setStatusLang(lang);
  updateBreadcrumb(fp); highlightTree(fp); showEditor(); updateOpenEditors();
}

async function createNewFile() {
  const fp = await ipcRenderer.invoke("create-new-file", currentFolder);
  if (fp) {
    if (!currentFolder) loadFolderUI(path.dirname(fp));
    else renderFileTree(currentFolder);
    await openFile(fp); showNotification("Created: " + path.basename(fp), "success");
  }
}

function switchTab(i) {
  if (i < 0 || i >= openTabs.length) return;
  if (activeTab !== null && openTabs[activeTab]) openTabs[activeTab].viewState = editor.saveViewState();
  activeTab = i; const t = openTabs[i];
  editor.setModel(t.model); if (t.viewState) editor.restoreViewState(t.viewState);
  editor.focus(); updateTabUI(); updateOpenEditors();
  document.getElementById("language-selector").value = t.language; setStatusLang(t.language);
  updateBreadcrumb(t.filePath); highlightTree(t.filePath);
  document.getElementById("window-title").textContent = path.basename(t.filePath) + (currentFolder ? " — " + path.basename(currentFolder) : "") + " — CodeOrbit";
}

function closeTab(i, e) {
  if (e) e.stopPropagation();
  openTabs[i].model?.dispose(); openTabs.splice(i, 1);
  if (!openTabs.length) { activeTab = null; hideEditor(); document.getElementById("window-title").textContent = currentFolder ? path.basename(currentFolder) + " — CodeOrbit" : "CodeOrbit"; }
  else if (activeTab >= openTabs.length) switchTab(openTabs.length - 1);
  else if (activeTab === i) switchTab(Math.min(i, openTabs.length - 1));
  else if (activeTab > i) activeTab--;
  updateTabUI(); updateOpenEditors();
}

function updateTabUI() {
  const c = document.getElementById("tabs-container"); c.innerHTML = "";
  openTabs.forEach((t, i) => {
    const d = el("div", `tab${i === activeTab ? " active" : ""}${t.modified ? " modified" : ""}`);
    d.setAttribute("draggable", "true");
    const info = fileIcon(path.extname(t.filePath).toLowerCase());
    const ico = el("span", `tab-icon ${info.cls}`); ico.textContent = info.em; ico.style.fontSize = "13px";
    const nm = el("span", "tab-name"); nm.textContent = path.basename(t.filePath);
    if (t.modified) { const dot = el("span", "tab-dot"); nm.appendChild(dot); }
    const cb = el("button", "tab-close"); cb.textContent = "✕"; cb.addEventListener("click", e => closeTab(i, e));
    d.append(ico, nm, cb); 
    
    // Switch tab on click
    d.addEventListener("click", () => switchTab(i)); 

    // Drag and Drop
    d.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("tabIndex", i);
      d.classList.add("dragging");
    });
    d.addEventListener("dragend", () => d.classList.remove("dragging"));
    d.addEventListener("dragover", (e) => {
      e.preventDefault();
      d.classList.add("drag-over");
    });
    d.addEventListener("dragleave", () => d.classList.remove("drag-over"));
    d.addEventListener("drop", (e) => {
      e.preventDefault();
      d.classList.remove("drag-over");
      const fromIndex = parseInt(e.dataTransfer.getData("tabIndex"));
      if (fromIndex !== i) {
        const movedTab = openTabs.splice(fromIndex, 1)[0];
        openTabs.splice(i, 0, movedTab);
        activeTab = i;
        updateTabUI(); updateOpenEditors();
      }
    });

    c.appendChild(d);
  });
}

function updateOpenEditors() {
  const list = document.getElementById("open-editors-list"), cnt = document.getElementById("open-editors-count");
  list.innerHTML = ""; cnt.textContent = openTabs.length;
  openTabs.forEach((t, i) => {
    const d = el("div", `open-editor-item${i === activeTab ? " active" : ""}`);
    const info = fileIcon(path.extname(t.filePath).toLowerCase());
    d.innerHTML = `<span class="oe-icon">${info.em}</span><span class="oe-name">${path.basename(t.filePath)}${t.modified ? " ●" : ""}</span><button class="oe-close">✕</button>`;
    d.addEventListener("click", () => switchTab(i));
    d.querySelector(".oe-close").addEventListener("click", e => { e.stopPropagation(); closeTab(i); });
    list.appendChild(d);
  });
}

function updateBreadcrumb(fp) {
  document.getElementById("breadcrumb").style.display = "flex";
  const parts = fp.split(path.sep).slice(-3);
  document.getElementById("breadcrumb-content").innerHTML = parts.map((p, i) =>
    `<span class="breadcrumb-item">${p}</span>${i < parts.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ''}`
  ).join("");
}

function highlightTree(fp) {
  document.querySelectorAll(".tree-item").forEach(e => { e.classList.toggle("selected", e.dataset.filepath === fp); });
}

function showEditor() { document.getElementById("welcome-screen").classList.add("hidden"); document.getElementById("editor-container").classList.add("visible"); if (editor) editor.layout(); }
function hideEditor() { document.getElementById("welcome-screen").classList.remove("hidden"); document.getElementById("editor-container").classList.remove("visible"); document.getElementById("breadcrumb").style.display = "none"; }

function setStatusLang(l) {
  const n = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", html: "HTML", css: "CSS", json: "JSON", markdown: "Markdown", java: "Java", cpp: "C++", c: "C" };
  document.getElementById("status-language").textContent = n[l] || l;
}

// ═══ Save ═══
async function saveCurrentFile() {
  if (activeTab === null || !openTabs[activeTab]) return;
  const t = openTabs[activeTab], content = t.model.getValue();
  const res = await ipcRenderer.invoke("save-file", t.filePath, content);
  if (res) {
    t.modified = false; updateTabUI(); updateOpenEditors();
    showNotification("Saved: " + path.basename(t.filePath), "success");
    ipcRenderer.send("notify-file-change"); // Refresh Live Server
  } else showNotification("Save failed", "error");
}

// ═══ Live Server ═══
let liveServerActive = false;
async function toggleLiveServer() {
  const btn = document.getElementById("btn-go-live");
  const webview = document.getElementById("preview-webview");
  const placeholder = document.getElementById("preview-placeholder");
  const urlEl = document.getElementById("preview-url");

  if (liveServerActive) {
    await ipcRenderer.invoke("stop-live-server");
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Go Live';
    if (webview) { webview.style.display = "none"; webview.src = "about:blank"; }
    if (placeholder) placeholder.style.display = "flex";
    liveServerActive = false;
    showNotification("Live Server stopped", "info");
  } else {
    const res = await ipcRenderer.invoke("start-live-server", currentFolder);
    if (res.success) {
      btn.classList.add("active");
      btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Port: 5500';
      if (urlEl) urlEl.textContent = res.url;
      if (webview) { webview.src = res.url; webview.style.display = "block"; }
      if (placeholder) placeholder.style.display = "none";
      liveServerActive = true;
      switchSidebarPanel("preview");
      showNotification("Live Server started on port 5500", "success");
    } else {
      showNotification(res.error, "error");
    }
  }
}

function refreshPreview() {
  const webview = document.getElementById("preview-webview");
  if (webview && liveServerActive) {
    const url = webview.src;
    webview.src = "about:blank";
    setTimeout(() => { webview.src = url; }, 50);
  }
}

function openExternalPreview() {
  const url = document.getElementById("preview-url").textContent;
  if (liveServerActive) window.open(url, "_blank");
}
// ═══ Global Helpers ═══
/**
 * Quick Element Creator
 */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// ═══ Project Analytics ═══
async function updateAnalytics() {
  if (!currentFolder) return;
  try {
    const structure = await ipcRenderer.invoke("get-project-structure", currentFolder);
    if (!structure) return;

    const stats = { files: 0, langs: {} };
    for (const item of structure) {
      if (!item.isDirectory) {
        stats.files++;
        const ext = path.extname(item.path).toLowerCase() || '.txt';
        stats.langs[ext] = (stats.langs[ext] || 0) + 1;
      }
    }

    document.getElementById("stat-files").textContent = stats.files;
    document.getElementById("stat-lines").textContent = "~" + (stats.files * 45); // Approximation for performance

    const list = document.getElementById("lang-list"), chart = document.getElementById("lang-chart");
    if (!list || !chart) return;
    list.innerHTML = ""; chart.innerHTML = "";

    const sorted = Object.entries(stats.langs).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const colors = ["#3b82f6", "#10b981", "#fbbf24", "#ef4444", "#8b5cf6", "#6b7280"];

    sorted.forEach(([ext, count], i) => {
      const pct = (count / stats.files * 100).toFixed(1);
      const color = colors[i] || colors[5];

      const bar = document.createElement("div");
      bar.className = "lang-bar"; bar.style.width = pct + "%"; bar.style.backgroundColor = color;
      chart.appendChild(bar);

      const item = document.createElement("div");
      item.className = "lang-item";
      item.innerHTML = `<span class="lang-dot" style="background:${color}"></span><span class="lang-name">${ext === '.txt' ? 'Other' : ext.slice(1).toUpperCase()}</span><span class="lang-pct">${pct}%</span>`;
      list.appendChild(item);
    });

    const info = await ipcRenderer.invoke("git-status", currentFolder);
    if (info.isRepo) {
      document.getElementById("git-branch").textContent = info.branch;
      const log = await ipcRenderer.invoke("git-log", currentFolder, 100);
      document.getElementById("git-commits").textContent = log.length + (log.length === 100 ? "+" : "");
    }
  } catch (e) { console.error("Analytics error:", e); }
}

// ═══ Run Code ═══
async function runCode() {
  if (!editor) return;
  const code = editor.getValue();
  if (!code.trim()) { showNotification("Write code first", "info"); return; }
  if (activeTab !== null && openTabs[activeTab]?.modified) await saveCurrentFile();
  const lang = document.getElementById("language-selector").value;
  const out = document.getElementById("output-content");
  const lineContainer = document.getElementById("output-lines");
  const names = { python: "Python", javascript: "Node.js", typescript: "TypeScript", java: "Java", cpp: "C++", c: "C" };

  // Switch to output panel
  switchPanelTab("output");
  document.getElementById("bottom-panel").classList.remove("collapsed");

  document.getElementById("btn-run").style.display = "none";
  document.getElementById("btn-stop").style.display = "flex";
  
  if (lineContainer) {
    lineContainer.innerHTML = `<div class="output-header">▶ Running ${names[lang] || lang}...</div>`;
  }

  try {
    const filePath = activeTab !== null ? openTabs[activeTab].filePath : null;
    const res = await ipcRenderer.invoke("run-code", code, lang, filePath);
    
    if (res.success) {
      if (lineContainer) {
        lineContainer.innerHTML = `<div class="output-header">▶ Running ${names[lang] || lang}...</div>`;
      }
      document.getElementById("output-input-area").style.display = "flex";
      document.getElementById("output-input-field").focus();
    } else {
      if (lineContainer) {
        lineContainer.innerHTML += `<div class="output-line stderr">Error: ${res.error}</div>`;
      } else {
        out.innerHTML += `<div class="output-line stderr">Error: ${res.error}</div>`;
      }
      document.getElementById("btn-run").style.display = "flex";
      document.getElementById("btn-stop").style.display = "none";
    }
  } catch (e) { 
    if (lineContainer) {
      lineContainer.innerHTML += `<div class="output-line stderr">${esc(e.message)}</div>`;
    } else {
      out.innerHTML += `<div class="output-line stderr">${esc(e.message)}</div>`; 
    }
    document.getElementById("btn-run").style.display = "flex";
    document.getElementById("btn-stop").style.display = "none";
  }
}

// ═══ Run in Terminal ═══
async function runInTerminal() {
  if (!editor) return;
  if (activeTab === null || !openTabs[activeTab]) { showNotification("Open a file first", "info"); return; }
  const filePath = openTabs[activeTab].filePath;
  if (!filePath) { showNotification("Save the file first", "info"); return; }
  if (openTabs[activeTab].modified) await saveCurrentFile();

  const fileDir = path.dirname(filePath);
  
  // Just open a new terminal in the file's directory — user types commands manually
  await createTerminal(fileDir);
}

// ═══ Output Listeners (with pip auto-detect) ═══
ipcRenderer.on("run-output", (_, { data, type }) => {
  const container = document.getElementById("output-lines");
  const div = document.createElement("div");
  div.className = `output-line ${type}`;
  div.textContent = data;
  container.appendChild(div);
  
  // ★ Auto-detect ModuleNotFoundError and offer pip install
  if (type === "stderr") {
    // Python: ModuleNotFoundError: No module named 'xxx'
    const moduleMatch = data.match(/ModuleNotFoundError:\s*No module named ['\"]([^'"]+)['"]/);
    // Python: ImportError: No module named xxx
    const importMatch = data.match(/ImportError:\s*No module named ['\"]?([^'";\s]+)['\"]?/);
    const pkgName = (moduleMatch && moduleMatch[1]) || (importMatch && importMatch[1]);
    
    if (pkgName) {
      const cleanPkg = pkgName.split('.')[0]; // Get root package name
      const installDiv = document.createElement("div");
      installDiv.className = "output-line pip-install-suggestion";
      installDiv.innerHTML = `
        <div class="pip-suggest-box">
          <i class="fas fa-exclamation-triangle" style="color:var(--orange);"></i>
          <span>Missing package: <strong>${cleanPkg}</strong></span>
          <button class="pip-install-btn" id="pip-btn-${cleanPkg}">
            <i class="fas fa-download"></i> pip install ${cleanPkg}
          </button>
        </div>`;
      container.appendChild(installDiv);
      
      installDiv.querySelector('.pip-install-btn').addEventListener('click', async () => {
        await runPipInstall(cleanPkg);
      });
    }
  }
  
  // Auto-scroll
  const outPanel = document.getElementById("output-content");
  outPanel.scrollTop = outPanel.scrollHeight;
});

ipcRenderer.on("run-exit", (_, { exitCode, elapsed }) => {
  const container = document.getElementById("output-lines");
  const footer = document.createElement("div");
  footer.className = "output-footer";
  footer.innerHTML = `${exitCode === 0 ? `<span style="color:var(--green)">✓ Code 0</span>` : `<span style="color:var(--red)">✗ Code ${exitCode}</span>`} — ${elapsed}s`;
  container.appendChild(footer);
  
  document.getElementById("btn-run").style.display = "flex";
  document.getElementById("btn-stop").style.display = "none";
  document.getElementById("output-input-area").style.display = "none";
});

// ═══ Pip Install System ═══
async function runPipInstall(packageName) {
  const container = document.getElementById("output-lines");
  switchPanelTab("output");
  document.getElementById("bottom-panel").classList.remove("collapsed");
  
  // Show install header
  const header = document.createElement("div");
  header.className = "output-line pip-action-header";
  header.innerHTML = `<div class="pip-progress-box"><i class="fas fa-spinner fa-spin"></i> Installing <strong>${packageName}</strong> via pip...</div>`;
  container.appendChild(header);
  
  const outPanel = document.getElementById("output-content");
  outPanel.scrollTop = outPanel.scrollHeight;
  
  try {
    const result = await ipcRenderer.invoke("pip-install", packageName);
    
    const resultDiv = document.createElement("div");
    if (result.success) {
      resultDiv.className = "output-line pip-success";
      resultDiv.innerHTML = `
        <div class="pip-result-box success">
          <i class="fas fa-check-circle"></i>
          <span>✅ <strong>${packageName}</strong> installed successfully!</span>
          <button class="pip-rerun-btn" onclick="this.closest('.pip-result-box').querySelector('.pip-rerun-btn').disabled=true; document.getElementById('btn-run')?.click();">
            <i class="fas fa-play"></i> Re-run Code
          </button>
        </div>`;
      showNotification(`${packageName} installed successfully!`, 'success');
    } else {
      resultDiv.className = "output-line pip-error";
      resultDiv.innerHTML = `
        <div class="pip-result-box error">
          <i class="fas fa-times-circle"></i>
          <span>❌ Failed to install <strong>${packageName}</strong>. Exit code: ${result.exitCode || 'unknown'}</span>
          <button class="pip-retry-btn" onclick="runPipInstall('${packageName}')">
            <i class="fas fa-redo"></i> Retry
          </button>
        </div>`;
      showNotification(`Failed to install ${packageName}`, 'error');
    }
    container.appendChild(resultDiv);
    outPanel.scrollTop = outPanel.scrollHeight;
  } catch (e) {
    const errDiv = document.createElement("div");
    errDiv.className = "output-line stderr";
    errDiv.textContent = `Pip Error: ${e.message}`;
    container.appendChild(errDiv);
    showNotification('Pip install failed: ' + e.message, 'error');
  }
}

// Pip output listener
ipcRenderer.on("pip-output", (_, { data, type }) => {
  const container = document.getElementById("output-lines");
  const div = document.createElement("div");
  div.className = `output-line ${type === 'stderr' ? 'pip-stderr' : 'pip-stdout'}`;
  div.style.cssText = 'padding-left:24px;color:#888;font-size:11px;';
  div.textContent = data;
  container.appendChild(div);
  const outPanel = document.getElementById("output-content");
  outPanel.scrollTop = outPanel.scrollHeight;
});

// Shell output listener
ipcRenderer.on("shell-output", (_, { data, type }) => {
  const container = document.getElementById("output-lines");
  const div = document.createElement("div");
  div.className = `output-line ${type}`;
  div.textContent = data;
  container.appendChild(div);
  const outPanel = document.getElementById("output-content");
  outPanel.scrollTop = outPanel.scrollHeight;
});

// ═══ Pip Install Dialog (Command Palette) ═══
function showPipInstallDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.id = 'pip-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="command-palette" style="padding:0;max-width:500px;">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-primary);background:linear-gradient(135deg,rgba(78,201,176,0.05),rgba(59,130,246,0.05));">
        <i class="fas fa-download" style="color:var(--green);font-size:16px;"></i>
        <span style="font-size:14px;font-weight:600;color:var(--text-bright);">Python Package Manager</span>
      </div>
      <div style="padding:16px;">
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" id="pip-pkg-input" placeholder="Enter package name (e.g. requests, flask, numpy)" 
            style="flex:1;background:var(--bg-input);border:1px solid var(--border-primary);color:var(--text-bright);padding:10px 14px;border-radius:8px;font-size:13px;outline:none;" />
          <button id="pip-install-confirm" style="background:linear-gradient(135deg,#059669,#10b981);border:none;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.2s;">
            <i class="fas fa-download"></i> Install
          </button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
          <span style="font-size:11px;color:var(--text-muted);width:100%;margin-bottom:4px;">Popular packages:</span>
          <button class="pip-quick-pkg" data-pkg="requests" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">requests</button>
          <button class="pip-quick-pkg" data-pkg="flask" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">flask</button>
          <button class="pip-quick-pkg" data-pkg="numpy" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">numpy</button>
          <button class="pip-quick-pkg" data-pkg="pandas" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">pandas</button>
          <button class="pip-quick-pkg" data-pkg="django" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">django</button>
          <button class="pip-quick-pkg" data-pkg="matplotlib" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">matplotlib</button>
          <button class="pip-quick-pkg" data-pkg="pillow" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">pillow</button>
          <button class="pip-quick-pkg" data-pkg="opencv-python" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">opencv</button>
          <button class="pip-quick-pkg" data-pkg="beautifulsoup4" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">beautifulsoup4</button>
          <button class="pip-quick-pkg" data-pkg="selenium" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;">selenium</button>
        </div>
        <div id="pip-install-log" style="max-height:200px;overflow-y:auto;background:#0d1117;border-radius:8px;padding:8px 12px;font-family:var(--font-mono);font-size:11px;color:#8b949e;display:none;border:1px solid rgba(255,255,255,0.06);"></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="pip-install-requirements" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:6px 14px;border-radius:6px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-file-alt" style="color:var(--blue);"></i> Install from requirements.txt
          </button>
          <button id="pip-list-installed" style="background:var(--bg-tertiary);border:1px solid var(--border-primary);color:var(--text-primary);padding:6px 14px;border-radius:6px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-list" style="color:var(--cyan);"></i> List Installed
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  
  const input = document.getElementById('pip-pkg-input');
  const logDiv = document.getElementById('pip-install-log');
  input.focus();
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  // Install button
  document.getElementById('pip-install-confirm').addEventListener('click', async () => {
    const pkg = input.value.trim();
    if (!pkg) { input.focus(); return; }
    await doPipInstallInDialog(pkg, logDiv, overlay);
  });
  
  // Enter to install
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('pip-install-confirm').click();
    if (e.key === 'Escape') overlay.remove();
  });
  
  // Quick package buttons
  overlay.querySelectorAll('.pip-quick-pkg').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.pkg;
      document.getElementById('pip-install-confirm').click();
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--accent)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--bg-tertiary)'; btn.style.color = 'var(--text-primary)'; btn.style.borderColor = 'var(--border-primary)'; });
  });
  
  // Install from requirements.txt
  document.getElementById('pip-install-requirements').addEventListener('click', async () => {
    if (!currentFolder) { showNotification('Open a folder first', 'info'); return; }
    const reqPath = path.join(currentFolder, 'requirements.txt');
    const content = await ipcRenderer.invoke('read-file', reqPath);
    if (!content) { showNotification('No requirements.txt found in project root', 'info'); return; }
    await doPipInstallInDialog('-r "' + reqPath + '"', logDiv, overlay);
  });
  
  // List installed
  document.getElementById('pip-list-installed').addEventListener('click', async () => {
    logDiv.style.display = 'block';
    logDiv.innerHTML = '<span style="color:#58a6ff;"><i class="fas fa-spinner fa-spin"></i> Loading installed packages...</span>';
    const packages = await ipcRenderer.invoke('pip-list');
    if (packages.length) {
      logDiv.innerHTML = packages.map(p => `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="color:#e0e0e0;">${p.name}</span><span style="color:#666;">${p.version}</span></div>`).join('');
    } else {
      logDiv.innerHTML = '<span style="color:var(--orange);">No packages found or pip not available</span>';
    }
  });
}

async function doPipInstallInDialog(pkg, logDiv, overlay) {
  const confirmBtn = document.getElementById('pip-install-confirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
  logDiv.style.display = 'block';
  logDiv.innerHTML = `<span style="color:var(--cyan);">$ pip install ${pkg}</span>\n`;
  
  // Listen for pip output
  const pipListener = (_, { data }) => {
    logDiv.innerHTML += `<div style="color:#8b949e;">${data.replace(/\n/g, '<br>')}</div>`;
    logDiv.scrollTop = logDiv.scrollHeight;
  };
  ipcRenderer.on('pip-output', pipListener);
  
  try {
    const result = await ipcRenderer.invoke('pip-install', pkg);
    ipcRenderer.removeListener('pip-output', pipListener);
    
    if (result.success) {
      logDiv.innerHTML += '<div style="color:var(--green);margin-top:8px;font-weight:600;">✅ Installation successful!</div>';
      showNotification(`${pkg} installed successfully!`, 'success');
      confirmBtn.innerHTML = '<i class="fas fa-check"></i> Done!';
      confirmBtn.style.background = 'linear-gradient(135deg,#059669,#10b981)';
      setTimeout(() => {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-download"></i> Install';
        confirmBtn.style.background = '';
        document.getElementById('pip-pkg-input').value = '';
        document.getElementById('pip-pkg-input').focus();
      }, 2000);
    } else {
      logDiv.innerHTML += `<div style="color:var(--red);margin-top:8px;">❌ Installation failed (exit code: ${result.exitCode})</div>`;
      showNotification(`Failed to install ${pkg}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-download"></i> Retry';
    }
  } catch (e) {
    ipcRenderer.removeListener('pip-output', pipListener);
    logDiv.innerHTML += `<div style="color:var(--red);">Error: ${e.message}</div>`;
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="fas fa-download"></i> Retry';
  }
}

// Make pip install globally accessible
window.runPipInstall = runPipInstall;



// ═══ Terminal ═══
async function createTerminal(cwd) {
  // Use: provided cwd > active file's directory > project folder > fallback
  let dir = cwd || null;
  if (!dir && activeTab !== null && openTabs[activeTab]?.filePath) {
    dir = path.dirname(openTabs[activeTab].filePath);
  }
  if (!dir) dir = currentFolder;
  
  const id = await ipcRenderer.invoke("terminal-create", dir);

  const term = new Terminal({
    fontFamily: '"JetBrains Mono","Cascadia Code",Consolas,monospace',
    fontSize: 13, lineHeight: 1.4,
    theme: {
      background: "#1e1e1e", foreground: "#cccccc", cursor: "#aeafad",
      selectionBackground: "#264f78",
      black: "#000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
      blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
      brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b",
      brightYellow: "#f5f543", brightBlue: "#3b8eea", brightMagenta: "#d670d6",
      brightCyan: "#29b8db", brightWhite: "#e5e5e5",
    },
    cursorBlink: true, scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Create DOM
  const viewEl = el("div", "terminal-view");
  viewEl.id = `term-view-${id}`;
  document.getElementById("terminal-views").appendChild(viewEl);
  term.open(viewEl);

  // Fit after a small delay for DOM to settle
  setTimeout(() => { try { fitAddon.fit(); } catch { } }, 100);

  // Send input directly — node-pty handles everything natively
  term.onData(data => {
    ipcRenderer.send("terminal-input", id, data);
  });

  // Handle Copy/Paste in Terminal (Modern Clipboard API)
  term.attachCustomKeyEventHandler(e => {
    // Only handle keydown events, skip keyup to avoid double-triggers
    if (e.type !== 'keydown') return true;
    const ctrl = e.ctrlKey || e.metaKey;
    
    // Ctrl+C: Copy selection OR send SIGINT
    if (ctrl && e.key.toLowerCase() === 'c') {
      if (term.hasSelection()) {
        const selectedText = term.getSelection();
        navigator.clipboard.writeText(selectedText).then(() => {
          term.clearSelection();
        }).catch(err => {
          console.warn('Clipboard write failed, using fallback:', err);
          // Fallback: create a temporary textarea
          const ta = document.createElement('textarea');
          ta.value = selectedText;
          ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          term.clearSelection();
        });
        return false; // Prevent terminal from receiving Ctrl+C
      }
      // No selection: let Ctrl+C pass through as SIGINT
      return true;
    }
    
    // Ctrl+V: Paste from clipboard
    if (ctrl && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then(text => {
        if (text) ipcRenderer.send('terminal-input', id, text);
      }).catch(err => {
        console.warn('Clipboard read failed:', err);
      });
      return false;
    }
    
    // Ctrl+A: Select all in terminal
    if (ctrl && e.key.toLowerCase() === 'a') {
      term.selectAll();
      return false;
    }
    
    return true;
  });

  // Right-click context menu for terminal
  viewEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTerminalContextMenu(e.clientX, e.clientY, term, id);
  });

  // Resize terminal when container size changes
  const resizeObserver = new ResizeObserver(() => {
    try {
      fitAddon.fit();
      ipcRenderer.send("terminal-resize", id, term.cols, term.rows);
    } catch {}
  });
  resizeObserver.observe(viewEl);

  const inst = { id, term, fitAddon, viewEl, resizeObserver };
  terminalInstances.push(inst);

  // Switch to this terminal
  switchTerminal(terminalInstances.length - 1);
  updateTerminalTabs();

  // Make sure terminal panel is visible
  document.getElementById("bottom-panel").classList.remove("collapsed");
  switchPanelTab("terminal");

  return inst;
}

function switchTerminal(idx) {
  if (idx < 0 || idx >= terminalInstances.length) return;
  activeTerminal = idx;
  terminalInstances.forEach((inst, i) => {
    inst.viewEl.classList.toggle("active", i === idx);
  });
  updateTerminalTabs();
  // Focus the terminal so keyboard input works immediately
  setTimeout(() => {
    try { terminalInstances[idx].term.focus(); } catch {}
  }, 50);
  const inst = terminalInstances[idx];
  setTimeout(() => { try { inst.fitAddon.fit(); inst.term.focus(); } catch { } }, 50);
}

function killTerminal(idx) {
  if (idx < 0 || idx >= terminalInstances.length) return;
  const inst = terminalInstances[idx];
  ipcRenderer.send("terminal-kill", inst.id);
  inst.term.dispose();
  inst.viewEl.remove();
  terminalInstances.splice(idx, 1);
  if (!terminalInstances.length) activeTerminal = null;
  else if (activeTerminal >= terminalInstances.length) switchTerminal(terminalInstances.length - 1);
  else switchTerminal(Math.min(idx, terminalInstances.length - 1));
  updateTerminalTabs();
}

function updateTerminalTabs() {
  const container = document.getElementById("terminal-tabs"); container.innerHTML = "";
  terminalInstances.forEach((inst, i) => {
    const tab = el("div", `terminal-tab${i === activeTerminal ? " active" : ""}`);
    tab.innerHTML = `<i class="fas fa-terminal" style="font-size:10px;"></i> <span>Terminal ${i + 1}</span> <button class="tt-close">✕</button>`;
    tab.addEventListener("click", () => switchTerminal(i));
    tab.querySelector(".tt-close").addEventListener("click", e => { e.stopPropagation(); killTerminal(i); });
    container.appendChild(tab);
  });
}

// Receive data from main process
ipcRenderer.on("terminal-data", (_, id, data) => {
  const inst = terminalInstances.find(t => t.id === id);
  if (inst) inst.term.write(data);
});

ipcRenderer.on("terminal-exit", (_, id, code) => {
  const inst = terminalInstances.find(t => t.id === id);
  if (inst) inst.term.writeln(`\r\n\x1b[90mProcess exited with code ${code}\x1b[0m`);
});

// ═══ Git ═══
async function refreshGitStatus() {
  if (!currentFolder) return;
  try {
    const s = await ipcRenderer.invoke("git-status", currentFolder);
    if (!s.isRepo) {
      document.getElementById("git-not-repo").style.display = "flex";
      document.getElementById("git-repo").style.display = "none";
      document.getElementById("git-badge").style.display = "none";
      document.getElementById("branch-name").textContent = "—";
      return;
    }
    document.getElementById("git-not-repo").style.display = "none";
    document.getElementById("git-repo").style.display = "block";
    document.getElementById("branch-name").textContent = s.branch || "main";

    // Badge
    const totalChanges = (s.changed?.length || 0) + (s.untracked?.length || 0) + (s.deleted?.length || 0) + (s.created?.length || 0);
    const badge = document.getElementById("git-badge");
    if (totalChanges > 0) { badge.textContent = totalChanges; badge.style.display = "flex"; }
    else badge.style.display = "none";

    // Sync
    document.getElementById("status-sync").innerHTML = `<i class="fas fa-sync-alt"></i> ${s.behind || 0}↓ ${s.ahead || 0}↑`;

    // Staged
    renderGitList("git-staged-list", s.staged || [], "staged");
    document.getElementById("staged-count").textContent = s.staged?.length || 0;

    // Changes
    const changes = [...(s.changed || []), ...(s.untracked || []), ...(s.deleted || []), ...(s.created || [])];
    renderGitList("git-changes-list", changes, "changes");
    document.getElementById("changes-count").textContent = changes.length;
  } catch (e) { console.error("Git error:", e); }
}

function renderGitList(containerId, files, type) {
  const c = document.getElementById(containerId); c.innerHTML = "";
  files.forEach(f => {
    const d = el("div", "git-file-item");
    const statusLetter = { modified: "M", untracked: "U", deleted: "D", staged: "S", created: "A", conflicted: "!" }[f.status] || "?";
    d.innerHTML = `
      <span class="git-status ${f.status}">${statusLetter}</span>
      <span class="git-fname">${f.path}</span>
      <div class="git-file-actions">
        ${type === "changes"
        ? `<button class="icon-btn" title="Stage"><i class="fas fa-plus"></i></button>`
        : `<button class="icon-btn" title="Unstage"><i class="fas fa-minus"></i></button>`
      }
      </div>`;
    d.querySelector(".icon-btn").addEventListener("click", async e => {
      e.stopPropagation();
      if (type === "changes") await ipcRenderer.invoke("git-stage", currentFolder, f.path);
      else await ipcRenderer.invoke("git-unstage", currentFolder, f.path);
      refreshGitStatus();
    });
    c.appendChild(d);
  });
}

async function gitCommit() {
  const input = document.getElementById("git-commit-input");
  const msg = input.value.trim();
  if (!msg) { showNotification("Enter a commit message", "info"); input.focus(); return; }
  const ok = await ipcRenderer.invoke("git-commit", currentFolder, msg);
  if (ok) { input.value = ""; showNotification("Committed: " + msg, "success"); refreshGitStatus(); }
  else showNotification("Commit failed", "error");
}

async function gitInit() {
  const ok = await ipcRenderer.invoke("git-init", currentFolder);
  if (ok) { showNotification("Git repository initialized", "success"); refreshGitStatus(); }
  else showNotification("Git init failed", "error");
}

// Auto refresh git every 5 seconds
setInterval(() => { if (currentFolder) refreshGitStatus(); }, 5000);

// ═══ Panel Switching ═══
function switchPanelTab(name) {
  document.querySelectorAll(".panel-tab").forEach(t => t.classList.toggle("active", t.dataset.panel === name));
  document.querySelectorAll(".panel-view").forEach(v => v.classList.remove("active"));
  const views = { output: "output-content", terminal: "terminal-container", problems: "problems-content" };
  const view = document.getElementById(views[name]);
  if (view) { view.classList.add("active"); view.style.display = "flex"; }
  // Hide others
  Object.entries(views).forEach(([k, id]) => { if (k !== name) document.getElementById(id).style.display = "none"; });

  // Fit terminal if switching to terminal
  if (name === "terminal" && activeTerminal !== null && terminalInstances[activeTerminal]) {
    setTimeout(() => { try { terminalInstances[activeTerminal].fitAddon.fit(); } catch { } }, 50);
  }
}

// ═══ Activity Bar Panel Switching ═══
function switchSidebarPanel(name) {
  document.querySelectorAll(".activity-btn").forEach(b => b.classList.toggle("active", b.dataset.panel === name));
  document.querySelectorAll(".sidebar-panel").forEach(p => p.classList.remove("active"));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add("active");
  if (name === "git") refreshGitStatus();
  if (name === "analytics") updateAnalytics();
  if (name === "extensions") renderMarketplace("");
}

// ═══ Dropdown Menus ═══
function showDropdown(anchor, items) {
  const menu = document.getElementById("dropdown-menu"), rect = anchor.getBoundingClientRect();
  menu.innerHTML = "";
  items.forEach(item => {
    if (item === "---") { menu.appendChild(el("div", "dropdown-sep")); return; }
    const d = el("div", "dropdown-item");
    d.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ""}`;
    d.addEventListener("click", () => { hideDropdown(); item.action?.(); });
    menu.appendChild(d);
  });
  menu.style.left = rect.left + "px"; menu.style.top = rect.bottom + "px"; menu.style.display = "block";
  setTimeout(() => document.addEventListener("click", hideDropdown, { once: true }), 10);
}
function hideDropdown() { document.getElementById("dropdown-menu").style.display = "none"; }

// ═══ Command Palette ═══
const commands = [
  { label: "Quick Open File", icon: "fas fa-bolt", action: showQuickOpen },
  { label: "New File", icon: "fas fa-file-circle-plus", action: createNewFile },
  { label: "Open Folder", icon: "fas fa-folder-open", action: openFolder },
  { label: "Save File", icon: "fas fa-save", action: saveCurrentFile },
  { label: "Pip Install Package", icon: "fas fa-download", action: showPipInstallDialog },
  { label: "Keyboard Shortcuts", icon: "fas fa-keyboard", action: showShortcutsModal },
  { label: "Search in Files", icon: "fas fa-search", action: () => switchSidebarPanel("search") },
  { label: "Run Code", icon: "fas fa-play", action: runCode },
  { label: "New Terminal", icon: "fas fa-terminal", action: createTerminal },
  { label: "Toggle Panel", icon: "fas fa-columns", action: () => { document.getElementById("bottom-panel").classList.toggle("collapsed"); editor?.layout(); } },
  { label: "Close Tab", icon: "fas fa-times", action: () => { if (activeTab !== null) closeTab(activeTab); } },
  { label: "Git: Commit", icon: "fas fa-check", action: gitCommit },
  { label: "Git: Refresh Status", icon: "fas fa-sync", action: refreshGitStatus },
  { label: "Toggle Word Wrap", icon: "fas fa-text-width", action: () => { const c = editor.getOption(monaco.editor.EditorOption.wordWrap); editor.updateOptions({ wordWrap: c === "on" ? "off" : "on" }); } },
  { label: "Toggle Minimap", icon: "fas fa-map", action: () => { const c = editor.getOption(monaco.editor.EditorOption.minimap); editor.updateOptions({ minimap: { enabled: !c.enabled } }); } },
  { label: "Format Document", icon: "fas fa-indent", action: () => editor?.getAction("editor.action.formatDocument")?.run() },
  { label: "Go to Line", icon: "fas fa-arrow-down", action: () => editor?.getAction("editor.action.gotoLine")?.run() },
  { label: "Find", icon: "fas fa-search", action: () => editor?.trigger("menu", "actions.find") },
  { label: "Replace", icon: "fas fa-exchange-alt", action: () => editor?.trigger("menu", "editor.action.startFindReplaceAction") },
  { label: "Zen Mode: Toggle", icon: "fas fa-expand", action: toggleZenMode },
];

function toggleZenMode() {
  const isZen = document.body.classList.toggle("zen-mode");
  if (isZen) {
    showNotification("Zen Mode Enabled - Press ESC or Ctrl+Shift+Z to exit", "info");
  }
}

// Global Zen Shortcut
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.shiftKey && e.key === "Z") toggleZenMode();
  if (e.key === "Escape" && document.body.classList.contains("zen-mode")) toggleZenMode();
});

function showPalette() {
  const ov = document.getElementById("command-palette-overlay"), inp = document.getElementById("command-palette-input");
  ov.style.display = "flex"; inp.value = ""; inp.focus(); renderPaletteList("");
  inp.oninput = () => renderPaletteList(inp.value);
  inp.onkeydown = e => {
    if (e.key === "Escape") hidePalette();
    if (e.key === "Enter") { const f = document.querySelector(".command-palette-item"); if (f) f.click(); }
  };
  ov.onclick = e => { if (e.target === ov) hidePalette(); };
}
function hidePalette() { document.getElementById("command-palette-overlay").style.display = "none"; }
function renderPaletteList(q) {
  const list = document.getElementById("command-palette-list"); list.innerHTML = "";
  commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase())).forEach(cmd => {
    const d = el("div", "command-palette-item");
    d.innerHTML = `<i class="${cmd.icon}"></i><span>${cmd.label}</span>`;
    d.addEventListener("click", () => { hidePalette(); cmd.action(); });
    list.appendChild(d);
  });
}

// ═══ Terminal Context Menu ═══
function showTerminalContextMenu(x, y, term, termId) {
  removeContextMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'terminal-context-menu';
  const items = [
    { label: 'Copy', icon: 'fas fa-copy', shortcut: 'Ctrl+C', action: () => { if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); } }, disabled: !term.hasSelection() },
    { label: 'Paste', icon: 'fas fa-paste', shortcut: 'Ctrl+V', action: () => { navigator.clipboard.readText().then(text => { if (text) ipcRenderer.send('terminal-input', termId, text); }).catch(() => {}); }},
    'sep',
    { label: 'Select All', icon: 'fas fa-object-group', shortcut: 'Ctrl+A', action: () => term.selectAll() },
    { label: 'Clear Terminal', icon: 'fas fa-broom', action: () => term.clear() },
    'sep',
    { label: 'Split Terminal', icon: 'fas fa-columns', action: () => createTerminal() },
    { label: 'Kill Terminal', icon: 'fas fa-skull-crossbones', action: () => { const idx = terminalInstances.findIndex(t => t.id === termId); if (idx !== -1) killTerminal(idx); }},
  ];
  items.forEach(item => {
    if (item === 'sep') { menu.appendChild(el('div', 'context-menu-sep')); return; }
    const row = el('div', `context-menu-item${item.disabled ? ' disabled' : ''}`);
    row.innerHTML = `<i class="${item.icon}"></i><span>${item.label}</span>${item.shortcut ? `<span class="ctx-shortcut">${item.shortcut}</span>` : ''}`;
    if (!item.disabled) row.addEventListener('click', () => { removeContextMenus(); item.action(); });
    menu.appendChild(row);
  });
  menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', removeContextMenus, { once: true }), 10);
}

// ═══ File Explorer Context Menu ═══
function showFileContextMenu(x, y, filePath, isDirectory) {
  removeContextMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'file-context-menu';
  const items = isDirectory ? [
    { label: 'New File Here...', icon: 'fas fa-file-circle-plus', action: async () => { const fp = await ipcRenderer.invoke('create-new-file', filePath); if (fp) { if (currentFolder) renderFileTree(currentFolder); await openFile(fp); } }},
    { label: 'New Folder Here...', icon: 'fas fa-folder-plus', action: async () => { await ipcRenderer.invoke('create-new-folder', filePath); if (currentFolder) renderFileTree(currentFolder); }},
    'sep',
    { label: 'Rename...', icon: 'fas fa-pen', action: () => promptRename(filePath) },
    { label: 'Delete', icon: 'fas fa-trash', action: () => promptDelete(filePath) },
    'sep',
    { label: 'Copy Path', icon: 'fas fa-link', action: () => { navigator.clipboard.writeText(filePath); showNotification('Path copied', 'info'); }},
    { label: 'Reveal in Explorer', icon: 'fas fa-external-link-alt', action: () => { const { shell } = nodeRequire('electron'); shell.showItemInFolder(filePath); }},
  ] : [
    { label: 'Open File', icon: 'fas fa-folder-open', action: () => openFile(filePath) },
    'sep',
    { label: 'Rename...', icon: 'fas fa-pen', action: () => promptRename(filePath) },
    { label: 'Delete', icon: 'fas fa-trash', action: () => promptDelete(filePath) },
    'sep',
    { label: 'Copy Path', icon: 'fas fa-link', action: () => { navigator.clipboard.writeText(filePath); showNotification('Path copied', 'info'); }},
    { label: 'Copy Relative Path', icon: 'fas fa-share', action: () => { const rel = currentFolder ? path.relative(currentFolder, filePath) : filePath; navigator.clipboard.writeText(rel); showNotification('Relative path copied', 'info'); }},
    'sep',
    { label: 'Reveal in Explorer', icon: 'fas fa-external-link-alt', action: () => { const { shell } = nodeRequire('electron'); shell.showItemInFolder(filePath); }},
  ];
  items.forEach(item => {
    if (item === 'sep') { menu.appendChild(el('div', 'context-menu-sep')); return; }
    const row = el('div', 'context-menu-item');
    row.innerHTML = `<i class="${item.icon}"></i><span>${item.label}</span>`;
    row.addEventListener('click', () => { removeContextMenus(); item.action(); });
    menu.appendChild(row);
  });
  menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 350) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', removeContextMenus, { once: true }), 10);
}

function removeContextMenus() {
  document.getElementById('terminal-context-menu')?.remove();
  document.getElementById('file-context-menu')?.remove();
}

async function promptRename(filePath) {
  const currentName = path.basename(filePath);
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.id = 'rename-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="command-palette" style="padding:20px;max-width:400px;"><label style="color:#ccc;font-size:13px;margin-bottom:8px;display:block;">Rename: <strong style="color:#fff;">${currentName}</strong></label><input type="text" id="rename-input" value="${currentName}" style="width:100%;background:#2d2d2d;border:1px solid #444;color:#fff;padding:8px 12px;border-radius:6px;font-size:14px;outline:none;margin-bottom:12px;" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="primary-btn" id="rename-confirm" style="font-size:12px;padding:6px 16px;">Rename</button><button id="rename-cancel" style="font-size:12px;padding:6px 16px;background:#333;color:#ccc;border:none;border-radius:6px;cursor:pointer;">Cancel</button></div></div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('rename-input');
  input.focus(); input.select();
  const cleanup = () => overlay.remove();
  document.getElementById('rename-cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  const doRename = async () => {
    const newName = input.value.trim();
    if (!newName || newName === currentName) { cleanup(); return; }
    const result = await ipcRenderer.invoke('rename-file', filePath, newName);
    if (result) { showNotification(`Renamed to ${newName}`, 'success'); if (currentFolder) renderFileTree(currentFolder); const tabIdx = openTabs.findIndex(t => t.filePath === filePath); if (tabIdx !== -1) { openTabs[tabIdx].filePath = result; updateTabUI(); } }
    else showNotification('Rename failed', 'error');
    cleanup();
  };
  document.getElementById('rename-confirm').addEventListener('click', doRename);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') cleanup(); });
}

async function promptDelete(filePath) {
  const name = path.basename(filePath);
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const ok = await ipcRenderer.invoke('delete-file', filePath);
  if (ok) { showNotification(`Deleted: ${name}`, 'success'); if (currentFolder) renderFileTree(currentFolder); const tabIdx = openTabs.findIndex(t => t.filePath === filePath); if (tabIdx !== -1) closeTab(tabIdx); }
  else showNotification('Delete failed', 'error');
}

// ═══ Quick File Opener (Ctrl+P) ═══
let quickOpenOverlay = null;
function showQuickOpen() {
  if (quickOpenOverlay) { quickOpenOverlay.remove(); quickOpenOverlay = null; }
  if (!currentFolder) { showNotification('Open a folder first', 'info'); return; }
  quickOpenOverlay = document.createElement('div');
  quickOpenOverlay.className = 'command-palette-overlay';
  quickOpenOverlay.id = 'quick-open-overlay';
  quickOpenOverlay.style.display = 'flex';
  quickOpenOverlay.innerHTML = `<div class="command-palette quick-open-palette"><div style="display:flex;align-items:center;gap:8px;padding:0 4px;"><i class="fas fa-search" style="color:#888;font-size:13px;"></i><input type="text" id="quick-open-input" placeholder="Search files by name..." style="flex:1;background:none;border:none;color:#fff;font-size:14px;outline:none;padding:8px 0;" /></div><div id="quick-open-list" class="command-palette-list" style="max-height:400px;overflow-y:auto;"></div><div style="display:flex;gap:16px;padding:6px 12px;font-size:11px;color:#666;border-top:1px solid #333;"><span><kbd style="background:#333;padding:1px 4px;border-radius:3px;font-size:10px;">↑↓</kbd> Navigate</span><span><kbd style="background:#333;padding:1px 4px;border-radius:3px;font-size:10px;">Enter</kbd> Open</span><span><kbd style="background:#333;padding:1px 4px;border-radius:3px;font-size:10px;">Esc</kbd> Close</span></div></div>`;
  document.body.appendChild(quickOpenOverlay);
  const input = document.getElementById('quick-open-input');
  const list = document.getElementById('quick-open-list');
  let fileCache = [], selectedIdx = 0;
  ipcRenderer.invoke('get-project-structure', currentFolder).then(structure => {
    fileCache = structure.filter(f => !f.isDirectory).map(f => ({ name: path.basename(f.path), rel: f.path, full: path.join(currentFolder, f.path) }));
    renderQOList('');
  });
  function renderQOList(q) {
    list.innerHTML = '';
    const ql = q.toLowerCase();
    const matches = fileCache.filter(f => !ql || f.name.toLowerCase().includes(ql) || f.rel.toLowerCase().includes(ql)).slice(0, 25);
    selectedIdx = 0;
    matches.forEach((f, i) => {
      const info = fileIcon(path.extname(f.name).toLowerCase());
      const item = el('div', `command-palette-item${i === 0 ? ' selected' : ''}`);
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;';
      item.innerHTML = `<span class="${info.cls}" style="font-size:14px;min-width:20px;text-align:center;">${info.em}</span><span style="flex:1;color:#e0e0e0;">${f.name}</span><span style="color:#666;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.rel}</span>`;
      item.addEventListener('click', () => { closeQuickOpen(); openFile(f.full); });
      item.addEventListener('mouseenter', () => { list.querySelectorAll('.command-palette-item').forEach(e => e.classList.remove('selected')); item.classList.add('selected'); selectedIdx = i; });
      list.appendChild(item);
    });
    if (!matches.length) list.innerHTML = '<div style="padding:20px;text-align:center;color:#666;"><i class="fas fa-search"></i> No files found</div>';
  }
  input.addEventListener('input', () => renderQOList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeQuickOpen(); return; }
    const items = list.querySelectorAll('.command-palette-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx)); items[selectedIdx]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx)); items[selectedIdx]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') items[selectedIdx]?.click();
  });
  quickOpenOverlay.addEventListener('click', (e) => { if (e.target === quickOpenOverlay) closeQuickOpen(); });
  input.focus();
}
function closeQuickOpen() { if (quickOpenOverlay) { quickOpenOverlay.remove(); quickOpenOverlay = null; } }

// ═══ Auto-Save (2.5s debounce) ═══
let autoSaveTimer = null;
function enableAutoSave() {
  if (!editor) return;
  editor.onDidChangeModelContent(() => {
    if (activeTab !== null && openTabs[activeTab]?.filePath) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { if (activeTab !== null && openTabs[activeTab]?.modified) saveCurrentFile(); }, 2500);
    }
  });
}

// ═══ Search in Files (Advanced) ═══
let searchDebounce = null;
let searchOptions = { case: false, regex: false };

async function searchInFiles(query) {
  const resultsEl = document.getElementById('search-results');
  if (!currentFolder || !query.trim()) { 
    resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;"><i class="fas fa-search" style="font-size:24px;display:block;margin-bottom:8px;"></i>Type to search across files</div>'; 
    return; 
  }
  
  resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888;"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
  
  try {
    const structure = await ipcRenderer.invoke('get-project-structure', currentFolder);
    const files = structure.filter(f => !f.isDirectory && !f.path.includes('.git') && !f.path.includes('node_modules'));
    
    let results = [];
    let q;
    try {
      q = searchOptions.regex ? new RegExp(query, searchOptions.case ? "g" : "gi") : query.toLowerCase();
    } catch (e) {
      resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red);">Invalid Regex: ${e.message}</div>`;
      return;
    }

    for (const file of files) {
      try {
        const fullPath = path.join(currentFolder, file.path);
        const content = await ipcRenderer.invoke('read-file', fullPath);
        if (!content) continue;
        
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          let match = false;
          if (searchOptions.regex) {
            match = q.test(line);
            q.lastIndex = 0; // reset
          } else {
            const l = searchOptions.case ? line : line.toLowerCase();
            match = l.includes(q);
          }
          
          if (match) {
            results.push({ file: file.path, fullPath, line: line.trim().substring(0, 120), lineNum: idx + 1 });
          }
        });
      } catch {}
      if (results.length > 500) break;
    }

    resultsEl.innerHTML = '';
    if (!results.length) { 
      resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">No results for "${esc(query)}"</div>`; 
      return; 
    }

    const grouped = {};
    results.forEach(r => { if (!grouped[r.file]) grouped[r.file] = []; grouped[r.file].push(r); });
    
    const countDiv = el('div'); countDiv.style.cssText = 'padding:8px 12px;color:var(--accent);font-size:11px;border-bottom:1px solid var(--border-primary);font-weight:600;';
    countDiv.textContent = `${results.length} results in ${Object.keys(grouped).length} files`;
    resultsEl.appendChild(countDiv);

    Object.entries(grouped).forEach(([file, matches]) => {
      const info = fileIcon(path.extname(file).toLowerCase());
      const grp = el('div', 'search-result-file');
      const hdr = el('div', 'search-result-header');
      hdr.innerHTML = `<i class="fas fa-chevron-down" style="font-size:8px;transition:transform .2s;"></i><span class="${info.cls}" style="font-size:11px;">${info.em}</span><span class="search-result-name">${path.basename(file)}</span><span style="font-size:9px;color:var(--text-muted);opacity:0.6;margin-left:4px;">${path.dirname(file)}</span>`;
      
      const body = el('div', 'search-result-matches');
      let expanded = true;
      hdr.addEventListener('click', () => { 
        expanded = !expanded; 
        body.style.display = expanded ? 'block' : 'none'; 
        hdr.querySelector('i').style.transform = expanded ? '' : 'rotate(-90deg)'; 
      });

      matches.forEach(m => {
        const ml = el('div', 'search-result-match');
        const highlighted = searchOptions.regex 
          ? m.line.replace(q, '<strong style="color:var(--orange);background:rgba(255,165,0,0.1);padding:0 2px;border-radius:2px;">$&</strong>')
          : m.line.replace(new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', searchOptions.case ? 'g' : 'gi'), '<strong style="color:var(--orange);background:rgba(255,165,0,0.1);padding:0 2px;border-radius:2px;">$1</strong>');
        
        ml.innerHTML = `<span style="color:var(--text-muted);min-width:28px;text-align:right;font-size:10px;">${m.lineNum}</span><span class="search-match-text" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${highlighted}</span>`;
        ml.addEventListener('click', async () => { 
          await openFile(m.fullPath); 
          editor.revealLineInCenter(m.lineNum); 
          editor.setPosition({ lineNumber: m.lineNum, column: 1 }); 
          editor.focus(); 
        });
        body.appendChild(ml);
      });
      grp.appendChild(hdr); grp.appendChild(body); resultsEl.appendChild(grp);
    });
  } catch (e) { resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red);"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`; }
}


// ═══ Enhanced Cursor Status ═══
function updateCursorStatus() {
  if (!editor) return;
  const p = editor.getPosition();
  const sel = editor.getSelection();
  const statusCursor = document.getElementById('status-cursor');
  if (sel && !sel.isEmpty()) {
    const selectedText = editor.getModel()?.getValueInRange(sel) || '';
    const lines = selectedText.split('\n').length;
    const chars = selectedText.length;
    statusCursor.textContent = `Ln ${p.lineNumber}, Col ${p.column} (${lines}L, ${chars}C selected)`;
  } else {
    statusCursor.textContent = `Ln ${p.lineNumber}, Col ${p.column}`;
  }
}

// ═══ Notifications ═══
function showNotification(msg, type = "info") {

  const c = document.getElementById("notification-container");
  const icons = { success: "fas fa-check-circle", error: "fas fa-exclamation-circle", info: "fas fa-info-circle" };
  const n = el("div", `notification ${type}`);
  n.innerHTML = `<i class="${icons[type]}"></i><span class="notif-text">${msg}</span><button class="notif-close">✕</button>`;
  n.querySelector(".notif-close").addEventListener("click", () => n.remove());
  c.appendChild(n);
  setTimeout(() => { n.style.opacity = "0"; n.style.transform = "translateX(100%)"; n.style.transition = "all .3s ease"; setTimeout(() => n.remove(), 300); }, 3500);
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// ═══ Resize ═══
function initResize(handleId, target, prop, dir) {
  const h = document.getElementById(handleId);
  h.addEventListener("mousedown", e => {
    h.classList.add("active"); document.body.style.cursor = dir === "x" ? "col-resize" : "row-resize"; document.body.style.userSelect = "none";
    const startPos = dir === "x" ? e.clientX : e.clientY, startSize = target.getBoundingClientRect()[prop === "width" ? "width" : "height"];
    const move = e => {
      const delta = dir === "x" ? e.clientX - startPos : -(e[dir === "x" ? "clientX" : "clientY"] - startPos);
      const newSize = Math.min(Math.max(startSize + (dir === "x" ? (e.clientX - startPos) : delta), dir === "x" ? 150 : 80), dir === "x" ? 500 : 500);
      target.style[prop] = newSize + "px"; editor?.layout();
      if (activeTerminal !== null && terminalInstances[activeTerminal]) try { terminalInstances[activeTerminal].fitAddon.fit(); } catch { }
    };
    const up = () => { h.classList.remove("active"); document.body.style.cursor = ""; document.body.style.userSelect = ""; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
}

// ═══ Init ═══

// ═══ CORE INITIALIZATION (Fault-Tolerant) ═══
(function init() {
  console.log("🚀 CodeOrbit Initialization Started...");
  
  // 1. Critical UI Navigation (Must run first!)
  try {
    // Sidebar Navigation
    const activityBtns = document.querySelectorAll(".activity-btn");
    activityBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const panelName = btn.dataset.panel;
        if (panelName) {
          console.log("📂 Switching to panel:", panelName);
          switchSidebarPanel(panelName);
        } else if (btn.id === "btn-settings") {
          console.log("⚙️ Opening Settings...");
          document.getElementById("copilot-settings-overlay").style.display = "flex";
        }
      });
    });

    // Home Page & Welcome Actions
    const homeActions = [
      { id: "btn-home-open", fn: openFolder },
      { id: "btn-home-new", fn: createNewFile },
      { id: "wl-new-file", fn: createNewFile },
      { id: "wl-open-folder", fn: openFolder },
      { id: "wl-terminal", fn: createTerminal },
      { id: "btn-open-folder-main", fn: openFolder },
      { id: "btn-new-file-sidebar", fn: createNewFile }
    ];
    homeActions.forEach(action => {
      document.getElementById(action.id)?.addEventListener("click", () => {
        console.log("🏠 Home action clicked:", action.id);
        action.fn();
      });
    });

    console.log("✅ UI Navigation listeners attached");

    // 2. Settings Modal Logic
    const settingsOverlay = document.getElementById("copilot-settings-overlay");
    const closeSettings = () => { if (settingsOverlay) settingsOverlay.style.display = "none"; };
    document.getElementById("copilot-settings-close")?.addEventListener("click", closeSettings);
    settingsOverlay?.addEventListener("click", e => { if (e.target === settingsOverlay) closeSettings(); });

    // Settings Tabs
    document.querySelectorAll(".copilot-settings-modal .tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".copilot-settings-modal .tab-btn").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".copilot-settings-modal .tab-pane").forEach(tp => tp.style.display = "none");
        btn.classList.add("active");
        const pane = document.getElementById(`settings-${tab}-tab`);
        if (pane) pane.style.display = "block";
      });
    });

    // Accent Dots
    document.querySelectorAll(".accent-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        const color = dot.dataset.color;
        document.documentElement.style.setProperty('--accent', color);
        document.documentElement.style.setProperty('--blue', color);
        showNotification("Theme accent color updated!", "success");
      });
    });

  } catch (e) { console.error("❌ UI Navigation init error:", e); }

  // 3. Independent Component Initialization
  
  // 3a. Editor (Deferred until Monaco is ready)
  window.onMonacoReady = () => {
    try {
      initEditor();
      console.log("✅ Editor initialized");
    } catch (e) {
      console.error("❌ Editor Init Failure:", e);
      showNotification("Editor failed to load. Some features may be limited.", "error");
    }
  };

  // 3b. Resizers
  try {
    const sidebar = document.getElementById("sidebar");
    const bottom = document.getElementById("bottom-panel");
    if (sidebar) initResize("sidebar-resize", sidebar, "width", "x");
    if (bottom) initResize("bottom-panel-resize", bottom, "height", "y");
  } catch (e) { console.error("❌ Resizer init failure:", e); }

  // 3c. Window controls
  try {
    document.getElementById("btn-minimize")?.addEventListener("click", () => ipcRenderer.send("window-minimize"));
    document.getElementById("btn-maximize")?.addEventListener("click", () => ipcRenderer.send("window-maximize"));
    document.getElementById("btn-close")?.addEventListener("click", () => ipcRenderer.send("window-close"));
  } catch (e) { console.error("❌ Window controls failure:", e); }

  // 3d. Menus
  try {
    const menus = ["file", "edit", "view", "run", "terminal", "help"];
    menus.forEach(m => {
      const el = document.getElementById(`menu-${m}`);
      if (el) {
        el.addEventListener("click", e => {
          let list = [];
          if (m === "file") list = [ { label: "New File", shortcut: "Ctrl+N", action: createNewFile }, { label: "Open Folder", shortcut: "Ctrl+O", action: openFolder }, "---", { label: "Save", shortcut: "Ctrl+S", action: saveCurrentFile } ];
          if (m === "edit") list = [ { label: "Undo", shortcut: "Ctrl+Z", action: () => editor?.trigger("menu", "undo") }, { label: "Redo", shortcut: "Ctrl+Y", action: () => editor?.trigger("menu", "redo") } ];
          if (m === "view") list = [ { label: "Command Palette", shortcut: "Ctrl+Shift+P", action: showPalette }, { label: "Explorer", shortcut: "Ctrl+Shift+E", action: () => switchSidebarPanel("explorer") } ];
          if (m === "run") list = [ { label: "Run Code", shortcut: "F5", action: runCode } ];
          if (m === "terminal") list = [ { label: "New Terminal", shortcut: "Ctrl+Shift+`", action: createTerminal } ];
          if (m === "help") list = [ { label: "About CodeOrbit", action: () => showNotification("CodeOrbit v2.2 ready 🚀", "info") } ];
          showDropdown(e.target, list);
        });
      }
    });
  } catch (e) { console.error("❌ Menu init failure:", e); }

  // 3e. Panel tabs
  try {
    document.querySelectorAll(".panel-tab")?.forEach(tab => {
      tab.addEventListener("click", () => switchPanelTab(tab.dataset.panel));
    });
  } catch (e) { console.error("❌ Panel tab init failure:", e); }

  // 3f. Tool Buttons & Tabs
  try {
    // Explorer Toolbar
    document.getElementById("btn-new-file")?.addEventListener("click", createNewFile);
    document.getElementById("btn-new-folder")?.addEventListener("click", async () => {
      if (currentFolder) { await ipcRenderer.invoke("create-new-folder", currentFolder); renderFileTree(currentFolder); }
    });
    document.getElementById("btn-refresh")?.addEventListener("click", () => currentFolder && renderFileTree(currentFolder));
    document.getElementById("btn-collapse")?.addEventListener("click", () => {
      document.querySelectorAll(".tree-children").forEach(c => c.classList.add("collapsed"));
      document.querySelectorAll(".chevron").forEach(c => c.classList.remove("expanded"));
    });

    // Git Toolbar
    document.getElementById("btn-git-refresh")?.addEventListener("click", refreshGitStatus);
    document.getElementById("btn-git-commit")?.addEventListener("click", gitCommit);
    document.getElementById("btn-git-init")?.addEventListener("click", async () => {
      if (currentFolder) { const ok = await ipcRenderer.invoke("git-init", currentFolder); if (ok) refreshGitStatus(); }
    });

    // Extension Tabs
    document.querySelectorAll(".ext-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".ext-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".ext-list").forEach(l => l.classList.remove("active"));
        tab.classList.add("active");
        const listId = tab.dataset.tab === "marketplace" ? "ext-marketplace" : "ext-installed";
        document.getElementById(listId)?.classList.add("active");
        if (tab.dataset.tab === "marketplace") renderMarketplace("");
      });
    });

    // Bottom panel buttons
    document.getElementById("btn-new-terminal")?.addEventListener("click", createTerminal);
    document.getElementById("btn-kill-terminal")?.addEventListener("click", () => { if (activeTerminal !== null) killTerminal(activeTerminal); });
    document.getElementById("btn-clear")?.addEventListener("click", () => activeTerminal !== null && terminalInstances[activeTerminal].term.clear());
    document.getElementById("btn-toggle-panel")?.addEventListener("click", () => { 
      const p = document.getElementById("bottom-panel");
      const isCollapsed = p?.classList.toggle("collapsed");
      document.getElementById("btn-toggle-panel").innerHTML = isCollapsed ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
      editor?.layout(); 
    });
  } catch (e) { console.error("❌ Component listener failure:", e); }

  // 3g. Global Shortcuts
  try {
    document.addEventListener("keydown", e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") { e.preventDefault(); saveCurrentFile(); }
      if (ctrl && e.key === "o") { e.preventDefault(); openFolder(); }
      if (ctrl && e.key === "n") { e.preventDefault(); createNewFile(); }
      if (ctrl && e.key === "p") { e.preventDefault(); showQuickOpen(); }
      if (e.key === "F5") { e.preventDefault(); runCode(); }
    });
  } catch (e) { console.error("❌ Global shortcut failure:", e); }

  // 3h. Final touches
  try {
    setTimeout(createTerminal, 1000);
    console.log("✨ CodeOrbit Ready!");
  } catch (e) { console.error("❌ Final touches failure:", e); }

})();

// ═══ Restored Missing Core Functions ═══

/**
 * Renders the extension marketplace or installed extensions
 */
async function renderMarketplace(query) {
  const list = document.getElementById("ext-marketplace");
  if (!list) return;
  list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Loading Extensions...</div>`;
  
  // Simulated marketplace with 20+ extensions
  setTimeout(() => {
    const exts = [
      { id: "java-pack", name: "Java Extension Pack", author: "CodeOrbit", desc: "Support for Java 8-21 manual execution", icon: "☕", stars: 4.8 },
      { id: "python-pro", name: "Python Pro", author: "Gowtham", desc: "Advanced linting and bug detection", icon: "🐍", stars: 4.9 },
      { id: "live-preview", name: "Live Preview", author: "CodeOrbit", desc: "Real-time preview for HTML/CSS", icon: "🌐", stars: 4.7 },
      { id: "cpp-tools", name: "C/C++ Tools", author: "Microsoft Clone", desc: "IntelliSense and debugging for C++", icon: "💎", stars: 4.6 },
      { id: "rust-analyzer", name: "Rust Analyzer", author: "Rust Team", desc: "Semantic analysis and refactoring for Rust", icon: "🦀", stars: 4.9 },
      { id: "git-graph", name: "Git Graph", author: "Eric Amod", desc: "Visualize your git history in a graph", icon: "🎋", stars: 4.8 },
      { id: "docker", name: "Docker Manager", author: "Container Co.", desc: "Manage containers and images directly", icon: "🐋", stars: 4.7 },
      { id: "prettier", name: "Prettier Clone", author: "Format Team", desc: "An opinionated code formatter", icon: "✨", stars: 4.9 },
      { id: "eslint", name: "ESLint Clone", author: "Lint Team", desc: "Find and fix problems in JavaScript", icon: "🖨️", stars: 4.8 },
      { id: "vim-mode", name: "Vim Emulator", author: "Vim Team", desc: "Vim keybindings for the editor", icon: "⌨️", stars: 4.5 },
      { id: "go-tools", name: "Go Support", author: "Google Clone", desc: "Rich language support for Go", icon: "🐹", stars: 4.7 },
      { id: "material-theme", name: "Material Icons", author: "UI Team", desc: "Premium file icons for the explorer", icon: "📁", stars: 4.9 },
      { id: "error-lens", name: "Error Lens", author: "Gowtham", desc: "Show errors directly in the current line", icon: "🚨", stars: 4.8 },
      { id: "peacock", name: "Peacock", author: "John Papa", desc: "Color code your workspace windows", icon: "🦚", stars: 4.4 },
      { id: "sql-explorer", name: "SQL Explorer", author: "DB Tool", desc: "Query databases from the IDE", icon: "🗄️", stars: 4.6 },
      { id: "auto-close", name: "Auto Close Tag", author: "Jun Han", desc: "Automatically close HTML tags", icon: "🏷️", stars: 4.7 },
      { id: "php-intel", name: "PHP Intelephense", author: "PHP Lab", desc: "Advanced PHP language features", icon: "🐘", stars: 4.5 },
      { id: "ruby-rails", name: "Ruby on Rails", author: "Rails Co.", desc: "Support for Ruby and Rails projects", icon: "💎", stars: 4.6 },
      { id: "jupyter", name: "Jupyter Notebooks", author: "PyData", desc: "Interactive notebooks in the IDE", icon: "🪐", stars: 4.8 },
      { id: "bracket-color", name: "Bracket Pair Colorizer", author: "CoenraadS", desc: "Color code your brackets", icon: "🌈", stars: 4.9 },
      { id: "quokka", name: "Quokka Clone", author: "Wallaby", desc: "Live scratchpad for JS/TS", icon: "📱", stars: 4.7 },
      { id: "tailwind-intel", name: "Tailwind CSS IntelliSense", author: "Tailwind", desc: "Autocomplete for Tailwind", icon: "🎨", stars: 4.8 }
    ];
    
    const filtered = exts.filter(e => e.name.toLowerCase().includes(query.toLowerCase()));
    
    if (!filtered.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No extensions found matching "${query}"</div>`;
      return;
    }

    list.innerHTML = filtered.map(e => `
      <div class="extension-item">
        <div class="ext-icon">${e.icon}</div>
        <div class="ext-info">
          <div class="ext-name">${e.name} <span class="ext-stars"><i class="fas fa-star"></i> ${e.stars}</span></div>
          <div class="ext-author">by ${e.author}</div>
          <div class="ext-desc">${e.desc}</div>
        </div>
        <button class="ext-install-btn" onclick="showNotification('Installing ${e.name}...','info')">Install</button>
      </div>
    `).join("");
  }, 300);
}

/**
 * Shows the Keyboard Shortcuts reference modal
 */
function showShortcutsModal() {
  const overlay = el("div", "command-palette-overlay");
  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div class="command-palette" style="max-width:500px;padding:0;">
      <div style="padding:16px;border-bottom:1px solid var(--border-primary);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;color:var(--text-bright);"><i class="fas fa-keyboard"></i> Keyboard Shortcuts</span>
        <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;" onclick="this.closest('.command-palette-overlay').remove()">✕</button>
      </div>
      <div style="padding:16px;max-height:400px;overflow-y:auto;">
        <div style="display:grid;grid-template-columns:1fr auto;gap:12px;">
          <div style="color:var(--text-primary);">Save File</div><kbd>Ctrl + S</kbd>
          <div style="color:var(--text-primary);">Quick Open File</div><kbd>Ctrl + P</kbd>
          <div style="color:var(--text-primary);">Command Palette</div><kbd>Ctrl + Shift + P</kbd>
          <div style="color:var(--text-primary);">Toggle Sidebar</div><kbd>Ctrl + B</kbd>
          <div style="color:var(--text-primary);">New Terminal</div><kbd>Ctrl + Shift + \`</kbd>
          <div style="color:var(--text-primary);">Run Code</div><kbd>F5</kbd>
          <div style="color:var(--text-primary);">Zen Mode</div><kbd>Ctrl + Shift + Z</kbd>
          <div style="color:var(--text-primary);">Explorer</div><kbd>Ctrl + Shift + E</kbd>
          <div style="color:var(--text-primary);">Search</div><kbd>Ctrl + Shift + F</kbd>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// Ensure extensions listen for search input
document.getElementById("ext-search")?.addEventListener("input", (e) => {
  renderMarketplace(e.target.value);
});

})();
