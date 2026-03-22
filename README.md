# 🎋 CodeOrbit IDE - Professional Desktop Editor

CodeOrbit is a high-performance, aesthetically pleasing, and full-featured IDE built with **Electron**, **Monaco Editor**, and **xterm.js**. It's designed to provide a "VS Code-like" experience with advanced custom features and a focus on speed and reliability.

![CodeOrbit Banner](https://img.shields.io/badge/IDE-CodeOrbit-blue?style=for-the-badge&logo=visualstudiocode)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

## 🚀 Key Features
*   **Monaco Engine**: Powers the world's best code editors, now with custom themes.
*   **Fault-Tolerant Initialization**: Parallel script loading ensures the UI is responsive even while the engine is warming up.
*   **Integrated Professional Terminal**: Full shell support via `node-pty`.
*   **Extension Marketplace**: A rich simulation of 20+ plugins (Rust, Docker, Vim, etc.).
*   **Git Integration**: Real-time status updates and simple commit management.
*   **Live Preview**: Integrated web server for real-time HTML/CSS previewing.

## 🛠️ Tech Stack
*   **Core**: Electron 30+, Node.js
*   **Editor**: Monaco Editor (vs-dark theme)
*   **Terminal**: xterm.js with fit-addon
*   **VSC Backend**: simple-git, node-pty
*   **Styling**: Pure CSS with Glassmorphism and Micro-Animations

## 🏗️ Getting Started

### Prerequisites
*   [Node.js](https://nodejs.org/) (version 18 or higher)
*   Git (for version control features)

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/codeorbit.git
    cd codeorbit
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Launch the IDE:
    ```bash
    npm start
    ```

## 📖 Technical Documentation
For a deep dive into **How, What, and Why** we built CodeOrbit this way, check out our [Comprehensive Documentation](./PROJECT_DOCS.md).

## 🎋 Developer
**Gowtham Sanjay** & The CodeOrbit AI Team.
