# 🚀 CodeOrbit — Next-Gen Desktop IDE

> A powerful AI-integrated desktop IDE built with Electron & Monaco Editor — designed for performance, focus, and intelligent development.

---

## 🎯 Overview

**CodeOrbit** is a modern desktop IDE that combines:

⚡ High performance  
🎨 Premium UI/UX  
🤖 AI-powered development  
🖥️ Integrated terminal & runtime  

It is designed as a **complete developer ecosystem**, not just a code editor.

---

## ✨ Features

### 🎨 Premium UI & Design
✨ Glassmorphic UI with blur effects  
🌙 Custom dark theme (`gowtham-dark`)  
🎨 Live accent color customization  
⚡ Smooth micro-animations & transitions  

---

### 💻 Industrial Code Editor
💻 Monaco Editor (VS Code engine)  
🌐 Multi-language support (JS, TS, Python, Java, C, C++)  
📊 Status bar (Ln/Col, encoding, language)  
🧭 Breadcrumb navigation  
🎋 Zen Mode for distraction-free coding  

---

### 🤖 AI Copilot
🧠 Context-aware AI chat  
✏️ Explain code  
🛠 Fix errors  
🔄 Refactor logic  
📄 Generate documentation  
🔌 Multi-model support (Gemini, OpenAI, Claude)  

---

### 🖥️ Terminal & Runtime
🧵 xterm.js terminal interface  
⚙️ node-pty backend execution  
📡 Run servers & scripts  
🧪 Multi-tab terminal support  
⚡ F5 instant code execution  

---

### 📦 Developer Workflow Tools
⚡ Command Palette (Ctrl + P)  
🌿 Git integration (status & branch tracking)  
📁 Smart File Explorer  
📑 Multi-tab editor with unsaved indicators  

---

## 🏗️ Architecture

User Interface (Renderer)
│
├── Monaco Editor
├── File Explorer
├── Tabs Manager
├── Terminal UI (xterm.js)
│
↓ IPC Communication
│
Main Process (Node.js)
│
├── File System (fs-extra)
├── Code Execution (child_process)
├── Terminal Backend (node-pty)
├── Git Integration (simple-git)

---

## ⚙️ Tech Stack

### 🔹 Core Framework
- Electron
- Node.js

### 🔹 Editor & UI
- Monaco Editor
- HTML5 + CSS3
- CSS Variables (dynamic theming)
- Glassmorphism (backdrop filters)

### 🔹 Terminal
- xterm.js
- node-pty
- xterm-addon-fit

### 🔹 AI Integration
- Google Gemini API
- OpenAI API
- Anthropic Claude API
- Unified API Adapter

### 🔹 File System & Git
- fs-extra
- path module
- simple-git

### 🔹 Build Tools
- npm
- Electron Builder

---

## 📂 Project Structure

CodeOrbit/
│
├── main.js # Electron main process
├── preload.js # Secure bridge (IPC)
├── renderer.js # Frontend logic
├── index.html # UI structure
├── styles.css # Styling & themes
├── package.json # Dependencies
│
├── /components # UI modules
├── /ai # AI Copilot logic
├── /utils # Helper functions


---

## 🔄 How It Works

### 1️⃣ Application Startup
- Electron launches `main.js`
- Creates browser window
- Loads `index.html`
- Renderer initializes UI

---

### 2️⃣ File Handling
- User opens folder (`Ctrl + O`)
- Renderer sends request via IPC
- Main process reads files (`fs-extra`)
- File tree is rendered in sidebar

---

### 3️⃣ Code Editing
- Monaco Editor loads file
- Syntax highlighting applied
- Cursor updates status bar in real-time

---

### 4️⃣ Code Execution
- Press `F5`
- Code sent to main process
- Executed using `child_process`
- Output streamed to terminal

---

### 5️⃣ Terminal System
- xterm.js handles UI
- node-pty runs shell (PowerShell/Bash)
- Input/output synced via IPC

---

### 6️⃣ AI Copilot Flow
- User selects code or asks query
- Request sent to AI adapter
- Routed to Gemini/OpenAI/Claude
- Response displayed inline

---

### 7️⃣ Performance Optimization
⚡ Parallel bootstrapping (fast startup)  
🔄 IPC for efficient communication  
🛡 Fault isolation (prevents crashes)  

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|--------|--------|
| Ctrl + P | Command Palette |
| Ctrl + S | Save File |
| Ctrl + O | Open Folder |
| Ctrl + W | Close Tab |
| F5 | Run Code |
| Ctrl + ` | Toggle Terminal |
| Ctrl + Shift + Z | Zen Mode |

---

## 🚀 Installation


git clone https://github.com/gowtham-v-data/CodeOrbit
cd codeorbit
npm install
npm start 

## 📦 Build

npm run build 

## 🌌 Roadmap

🔌 Extension marketplace  
🤖 Autonomous AI agents  
☁️ Cloud sync & collaboration  
📊 Developer analytics dashboard

## 💡 Vision

> CodeOrbit is not just an IDE — it is a **developer ecosystem** focused on speed, intelligence, and experience.
