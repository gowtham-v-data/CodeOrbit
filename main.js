const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const simpleGit = require("simple-git");

let mainWindow;
let currentWorkingDir = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webviewTag: true,
      sandbox: false,
    },
  });
  mainWindow.loadFile("index.html");
  
  // DEBUG: Forward renderer logs to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER LOG] ${message} (${path.basename(sourceId)}:${line})`);
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ═══════ Window Controls ═══════
ipcMain.on("window-minimize", () => mainWindow.minimize());
ipcMain.on("window-maximize", () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow.close());

// ═══════ File System ═══════
ipcMain.handle("open-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (!result.canceled && result.filePaths.length > 0) {
    currentWorkingDir = result.filePaths[0];
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("read-directory", async (_, dirPath) => {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    return items
      .filter((i) => !i.name.startsWith(".") && i.name !== "node_modules" && i.name !== "__pycache__")
      .map((i) => ({ name: i.name, path: path.join(dirPath, i.name), isDirectory: i.isDirectory() }))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
  } catch { return []; }
});

ipcMain.handle("read-file", async (_, filePath) => {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return null; }
});

ipcMain.handle("save-file", async (_, filePath, content) => {
  try { fs.writeFileSync(filePath, content, "utf-8"); return true; } catch { return false; }
});

ipcMain.handle("create-new-file", async (_, dirPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: dirPath || app.getPath("desktop"),
    filters: [
      { name: "Python", extensions: ["py"] }, { name: "JavaScript", extensions: ["js"] },
      { name: "TypeScript", extensions: ["ts"] }, { name: "HTML", extensions: ["html"] },
      { name: "CSS", extensions: ["css"] }, { name: "Java", extensions: ["java"] },
      { name: "C++", extensions: ["cpp"] }, { name: "C", extensions: ["c"] },
      { name: "JSON", extensions: ["json"] }, { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!result.canceled && result.filePath) {
    try { fs.writeFileSync(result.filePath, "", "utf-8"); return result.filePath; } catch { return null; }
  }
  return null;
});

ipcMain.handle("write-file-direct", async (_, filePath, content) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(currentWorkingDir || app.getPath("desktop"), filePath);
    // Ensure directory exists
    const dirname = path.dirname(fullPath);
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname, { recursive: true });
    }
    fs.writeFileSync(fullPath, content || "", "utf-8");
    return { success: true, path: fullPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("create-new-folder", async (_, parentDir) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: parentDir || app.getPath("desktop"),
    title: "Create New Folder",
    buttonLabel: "Create Folder",
  });
  if (!result.canceled && result.filePath) {
    try { fs.mkdirSync(result.filePath, { recursive: true }); return result.filePath; } catch { return null; }
  }
  return null;
});

ipcMain.handle("delete-file", async (_, filePath) => {
  try { fs.unlinkSync(filePath); return true; } catch { return false; }
});

ipcMain.handle("rename-file", async (_, oldPath, newName) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName);
    fs.renameSync(oldPath, newPath);
    return newPath;
  } catch { return null; }
});

ipcMain.handle("get-project-structure", async (_, rootDir) => {
  const structure = [];
  const root = rootDir || currentWorkingDir;
  if (!root) return [];

  function scan(dir, base = "") {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "__pycache__") continue;
        const relativePath = path.join(base, item.name);
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          structure.push({ path: relativePath, isDirectory: true });
          scan(fullPath, relativePath);
        } else {
          structure.push({ path: relativePath, isDirectory: false });
        }
      }
    } catch {}
  }
  
  scan(root);
  return structure;
});

// ═══════ Run Code ═══════
let runningProcess = null;

ipcMain.handle("run-code", async (event, code, language, filePath) => {
  if (runningProcess) { try { runningProcess.kill(); } catch {} runningProcess = null; }
  
  let tempFile, command, cwd;
  const tempDir = path.join(__dirname, ".tmp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  if (filePath && fs.existsSync(filePath)) {
    cwd = path.dirname(filePath);
    tempFile = filePath;
  } else {
    cwd = tempDir;
    const exts = { python: "py", javascript: "js", typescript: "ts", java: "java", cpp: "cpp", c: "c" };
    const name = language === "java" ? "Main.java" : `temp.${exts[language] || "txt"}`;
    tempFile = path.join(tempDir, name);
    fs.writeFileSync(tempFile, code);
  }

  const fileName = path.basename(tempFile);
  const fileNameNoExt = path.parse(fileName).name;

  // Use cmd.exe syntax (&&) — these run via spawn with shell:true which uses cmd.exe on Windows
  const cmds = {
    python: `python ${fileName}`,
    javascript: `node ${fileName}`,
    typescript: `npx ts-node ${fileName}`,
    java: `javac ${fileName} && java ${fileNameNoExt}`,
    cpp: `g++ ${fileName} -o ${fileNameNoExt}.exe && ${fileNameNoExt}.exe`,
    c: `gcc ${fileName} -o ${fileNameNoExt}.exe && ${fileNameNoExt}.exe`,
  };

  if (!cmds[language]) {
    return { success: false, error: `Unsupported: ${language}` };
  }
  
  command = cmds[language];
  const start = Date.now();

  runningProcess = spawn(command, { cwd, shell: true });

  runningProcess.stdout.on("data", (data) => {
    event.sender.send("run-output", { data: data.toString(), type: "stdout" });
  });

  runningProcess.stderr.on("data", (data) => {
    event.sender.send("run-output", { data: data.toString(), type: "stderr" });
  });

  runningProcess.on("exit", (code) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    event.sender.send("run-exit", { exitCode: code, elapsed });
    runningProcess = null;
  });

  runningProcess.on("error", (err) => {
    event.sender.send("run-output", { data: `Process Error: ${err.message}\n`, type: "stderr" });
    runningProcess = null;
  });

  return { success: true };
});

ipcMain.on("code-input", (_, input) => {
  if (runningProcess && runningProcess.stdin.writable) {
    runningProcess.stdin.write(input + "\n");
  }
});

ipcMain.handle("stop-code", async () => {
  if (runningProcess) { try { runningProcess.kill(); } catch {} runningProcess = null; return true; }
  return false;
});

// ═══════ Pip Install & Shell Commands ═══════
let pipProcess = null;

ipcMain.handle("pip-install", async (event, packageName) => {
  if (pipProcess) { try { pipProcess.kill(); } catch {} pipProcess = null; }
  
  const command = `pip install ${packageName}`;
  pipProcess = spawn(command, { shell: true, env: process.env });
  
  pipProcess.stdout.on("data", (data) => {
    event.sender.send("pip-output", { data: data.toString(), type: "stdout" });
  });
  
  pipProcess.stderr.on("data", (data) => {
    event.sender.send("pip-output", { data: data.toString(), type: "stderr" });
  });
  
  return new Promise((resolve) => {
    pipProcess.on("exit", (code) => {
      pipProcess = null;
      resolve({ success: code === 0, exitCode: code });
    });
    pipProcess.on("error", (err) => {
      pipProcess = null;
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle("pip-list", async () => {
  return new Promise((resolve) => {
    exec("pip list --format=json", { env: process.env }, (error, stdout) => {
      if (error) { resolve([]); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
    });
  });
});

ipcMain.handle("run-shell-cmd", async (event, command, cwd) => {
  const dir = cwd || currentWorkingDir || process.env.USERPROFILE;
  const proc = spawn(command, { cwd: dir, shell: true, env: process.env });
  
  proc.stdout.on("data", (data) => {
    event.sender.send("shell-output", { data: data.toString(), type: "stdout" });
  });
  proc.stderr.on("data", (data) => {
    event.sender.send("shell-output", { data: data.toString(), type: "stderr" });
  });
  
  return new Promise((resolve) => {
    proc.on("exit", (code) => resolve({ success: code === 0, exitCode: code }));
    proc.on("error", (err) => resolve({ success: false, error: err.message }));
  });
});

ipcMain.handle("detect-python", async () => {
  return new Promise((resolve) => {
    exec("python --version", (error, stdout) => {
      if (error) {
        exec("python3 --version", (err2, stdout2) => {
          resolve(err2 ? null : { version: stdout2.trim(), cmd: "python3" });
        });
      } else {
        resolve({ version: stdout.trim(), cmd: "python" });
      }
    });
  });
});

// ═══════ Terminal ═══════
let ptyModule = null;
try { ptyModule = require("node-pty"); } catch (e) { console.warn("node-pty not available, terminal may have limited functionality:", e.message); }

const terminals = new Map();
let terminalIdCounter = 0;

ipcMain.handle("terminal-create", (event, cwd) => {
  const id = ++terminalIdCounter;
  const dir = cwd || currentWorkingDir || process.env.USERPROFILE || __dirname;
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";

  if (ptyModule) {
    // Real PTY — full interactive terminal with echo, backspace, etc.
    const ptyProc = ptyModule.spawn(shell, [], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    terminals.set(id, { type: "pty", proc: ptyProc });

    ptyProc.onData((data) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("terminal-data", id, data);
    });

    ptyProc.onExit(({ exitCode }) => {
      terminals.delete(id);
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("terminal-exit", id, exitCode);
    });
  } else {
    // Fallback: spawn with pipes (limited interactivity)
    const proc = spawn(shell, ["-NoLogo"], {
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    terminals.set(id, { type: "spawn", proc });

    proc.stdout.on("data", (data) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("terminal-data", id, data.toString());
    });

    proc.stderr.on("data", (data) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("terminal-data", id, data.toString());
    });

    proc.on("exit", (code) => {
      terminals.delete(id);
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("terminal-exit", id, code);
    });
  }

  return id;
});

ipcMain.on("terminal-input", (_, id, data) => {
  const entry = terminals.get(id);
  if (!entry) return;
  if (entry.type === "pty") {
    entry.proc.write(data);
  } else {
    if (entry.proc.stdin.writable) entry.proc.stdin.write(data);
  }
});

ipcMain.on("terminal-kill", (_, id) => {
  const entry = terminals.get(id);
  if (entry) { try { entry.proc.kill(); } catch {} terminals.delete(id); }
});

ipcMain.on("terminal-resize", (_, id, cols, rows) => {
  const entry = terminals.get(id);
  if (entry && entry.type === "pty") {
    try { entry.proc.resize(cols, rows); } catch {}
  }
});

// ═══════ Live Server ═══════
const http = require("http");
const { WebSocketServer } = require("ws");
let liveServer = null, wss = null;

ipcMain.handle("start-live-server", async (_, rootDir) => {
  if (liveServer) { try { liveServer.close(); } catch {} }
  if (wss) { try { wss.close(); } catch {} }

  const port = 5500, wsPort = 5501;
  const root = rootDir || currentWorkingDir;
  if (!root) return { success: false, error: "No folder opened" };

  // WS Server for hot-reloading
  wss = new WebSocketServer({ port: wsPort });

  // HTTP Server
  liveServer = http.createServer((req, res) => {
    let url = req.url.split("?")[0];
    if (url === "/") url = "/index.html";
    const filePath = path.join(root, url);
    
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("File not found: " + url); return; }
      
      const ext = path.extname(filePath).toLowerCase();
      const mimes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
      res.writeHead(200, { "Content-Type": mimes[ext] || "text/plain" });
      
      if (ext === ".html") {
        let content = data.toString();
        const reloadScript = `
          <script>
            (function() {
              const ws = new WebSocket('ws://localhost:${wsPort}');
              ws.onmessage = (msg) => { if (msg.data === 'reload') location.reload(); };
              ws.onclose = () => console.log('Live Server disconnected');
              console.log('Live Server connected');
            })();
          </script>
        `;
        content = content.includes("</body>") ? content.replace("</body>", reloadScript + "</body>") : content + reloadScript;
        res.end(content);
      } else {
        res.end(data);
      }
    });
  });

  return new Promise((resolve) => {
    liveServer.listen(port, () => {
      console.log(`Live Server running at http://localhost:${port}`);
      resolve({ success: true, url: `http://localhost:${port}` });
    });
  });
});

ipcMain.handle("stop-live-server", async () => {
  if (liveServer) { liveServer.close(); liveServer = null; }
  if (wss) { wss.close(); wss = null; }
  return true;
});

ipcMain.on("notify-file-change", () => {
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send("reload");
    });
  }
});

// ═══════ Git Integration ═══════
function getGit(dir) {
  return simpleGit(dir || currentWorkingDir || __dirname);
}

ipcMain.handle("git-status", async (_, dir) => {
  try {
    const git = getGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { isRepo: false };
    const status = await git.status();
    const branch = status.current;
    return {
      isRepo: true,
      branch,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged.map((f) => ({ path: f, status: "staged" })),
      changed: status.modified.map((f) => ({ path: f, status: "modified" })),
      untracked: status.not_added.map((f) => ({ path: f, status: "untracked" })),
      deleted: status.deleted.map((f) => ({ path: f, status: "deleted" })),
      conflicted: status.conflicted.map((f) => ({ path: f, status: "conflicted" })),
      created: status.created.map((f) => ({ path: f, status: "created" })),
    };
  } catch (err) {
    return { isRepo: false, error: err.message };
  }
});

ipcMain.handle("git-log", async (_, dir, max) => {
  try {
    const git = getGit(dir);
    const log = await git.log({ maxCount: max || 20 });
    return log.all.map((c) => ({ hash: c.hash.substring(0, 7), message: c.message, author: c.author_name, date: c.date }));
  } catch { return []; }
});

ipcMain.handle("git-stage", async (_, dir, filePath) => {
  try { await getGit(dir).add(filePath); return true; } catch { return false; }
});

ipcMain.handle("git-unstage", async (_, dir, filePath) => {
  try { await getGit(dir).reset(["HEAD", "--", filePath]); return true; } catch { return false; }
});

ipcMain.handle("git-stage-all", async (_, dir) => {
  try { await getGit(dir).add("."); return true; } catch { return false; }
});

ipcMain.handle("git-commit", async (_, dir, message) => {
  try { await getGit(dir).commit(message); return true; } catch (err) { return false; }
});

ipcMain.handle("git-diff", async (_, dir, filePath) => {
  try { return await getGit(dir).diff([filePath]); } catch { return ""; }
});

ipcMain.handle("git-init", async (_, dir) => {
  try { await getGit(dir).init(); return true; } catch { return false; }
});

// ═══════ Clipboard (reliable fallback for terminals) ═══════
ipcMain.handle("clipboard-read", () => clipboard.readText());
ipcMain.handle("clipboard-write", (_, text) => { clipboard.writeText(text); return true; });

// Cleanup on quit
app.on("before-quit", () => {
  terminals.forEach((proc) => { try { proc.kill(); } catch {} });
});
