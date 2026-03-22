// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  CodeOrbit â€” AI Copilot Engine
//  Features: Chat, Fix Errors, Explain, Refactor, Generate Docs,
//            Generate Tests, Code Review, Optimize, Convert,
//            Inline Suggestions, Auto-Fix
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

(function () {
  "use strict";

  // â•â•â• State â•â•â•
  const STORAGE_KEY = "gowtham-ide-copilot";
  let copilotSettings = loadSettings();
  let chatHistory = []; // { role: "user"|"assistant", content: string }
  let isStreaming = false;
  let attachedCode = null; // code context attached to next message
  let inlineWidget = document.getElementById("copilot-inline-widget");
  let selectionTimeout = null;
  let abortController = null;

  // â•â•â• Settings Management â•â•â•
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      provider: "gemini",
      apiKey: "",
      model: "gemini-2.0-flash",
      temperature: 0.3,
      inlineEnabled: true,
      autoFix: true,
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copilotSettings));
    } catch {}
  }

  // â•â•â• API Endpoints â•â•â•
  function getApiConfig() {
    const s = copilotSettings;
    switch (s.provider) {
      case "gemini":
        return {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${s.model}:generateContent?key=${s.apiKey}`,
          headers: { "Content-Type": "application/json" },
          buildBody: (messages) => ({
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              temperature: s.temperature,
              maxOutputTokens: 8192,
            },
          }),
          extractResponse: (data) => {
            return (
              data?.candidates?.[0]?.content?.parts?.[0]?.text ||
              "No response generated."
            );
          },
        };
      case "openai":
        return {
          url: "https://api.openai.com/v1/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.apiKey}`,
          },
          buildBody: (messages) => ({
            model: s.model || "gpt-4o-mini",
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: s.temperature,
            max_tokens: 4096,
          }),
          extractResponse: (data) => {
            return (
              data?.choices?.[0]?.message?.content ||
              "No response generated."
            );
          },
        };
      case "anthropic":
        return {
          url: "https://api.anthropic.com/v1/messages",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": s.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          buildBody: (messages) => ({
            model: s.model || "claude-3-5-sonnet-20241022",
            max_tokens: 4096,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          extractResponse: (data) => {
            return (
              data?.content?.[0]?.text || "No response generated."
            );
          },
        };
      case "openrouter":
        return {
          url: "https://openrouter.ai/api/v1/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.apiKey}`,
          },
          buildBody: (messages) => ({
            model: s.model || "google/gemini-2.0-flash-exp:free",
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: s.temperature,
          }),
          extractResponse: (data) => {
            return (
              data?.choices?.[0]?.message?.content ||
              "No response generated."
            );
          },
        };
      default:
        return null;
    }
  }

  // â•â•â• System Prompt â•â•â•
  function getSystemPrompt() {
    return `You are CodeOrbit AI Copilot — an expert coding assistant with advanced AGENT modes.
    
    When an AGENT MISSION is started:
    - ARCHITECT: Design and generate multi-file projects. Use \`\`\`lang:file\`\`\` for every file.
    - DEBUGGER: Deep-scan the project structure to find bugs across multiple files.
    - REFACTORER: Deeply analyze code structure and suggest project-wide improvements.
    - WEB DESIGNER: Create sophisticated, responsive websites.
    
    MULTI-AGENT MODE (ADVANCED):
    If the user's request is complex, you act as the ORCHESTRATOR. 
    You must BEGIN your response with a JSON-like block: [ORCHESTRATION: Agent1 (role), Agent2 (role)]
    Then, simulate the collaboration between them to solve the problem step-by-step.
    
    CRITICAL: To create a file, use the format: \`\`\`language:filename.ext\nCODE\n\`\`\`.
    
    - Always specify the language.
    - For files, provide the FULL corrected code.
    - Be concise, friendly, and professional.`;
  }

  // â•â•â• Action Prompts â•â•â•
  function getActionPrompt(action, code, language) {
    const lang = language || "the provided";
    const prompts = {
      "fix-errors": `Analyze the following ${lang} code and fix ALL errors, bugs, and issues. Explain each fix clearly.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      explain: `Explain the following ${lang} code step by step. Break down what each part does, including any algorithms, data structures, or patterns used.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      refactor: `Refactor the following ${lang} code to improve readability, performance, and maintainability. Apply SOLID principles and modern best practices. Show the refactored version with explanations.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      "generate-docs": `Generate comprehensive documentation for the following ${lang} code. Include:\n- Function/class docstrings\n- Parameter descriptions\n- Return value descriptions\n- Usage examples\n- Any important notes\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      "generate-tests": `Generate comprehensive unit tests for the following ${lang} code. Include:\n- Normal cases\n- Edge cases\n- Error cases\n- Setup/teardown if needed\nUse the most popular testing framework for ${lang}.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      review: `Perform a thorough code review of the following ${lang} code. Check for:\n- Bugs and logical errors\n- Security vulnerabilities\n- Performance issues\n- Code style and readability\n- Best practice violations\n- Potential improvements\n\nRate each issue by severity (Critical/High/Medium/Low) and suggest fixes.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      optimize: `Optimize the following ${lang} code for better performance. Focus on:\n- Time complexity improvements\n- Space complexity improvements\n- Algorithmic optimizations\n- Memory management\n- Caching opportunities\n\nShow the optimized version and explain the improvements with Big-O analysis where applicable.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      convert: `Convert the following ${lang} code to Python, JavaScript, and Java (provide all three). Ensure the converted code is idiomatic and follows the conventions of each target language.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
    };
    return prompts[action] || `Help me with this ${lang} code:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
  }

  // â•â•â• API Call â•â•â•
  async function callAI(messages) {
    const config = getApiConfig();
    if (!config) throw new Error("Invalid API provider.");
    if (!copilotSettings.apiKey) {
      throw new Error(
        "API key not set. Open Copilot Settings to configure your API key."
      );
    }

    // Prepend system prompt
    const fullMessages = [
      { role: "user", content: getSystemPrompt() },
      { role: "assistant", content: "Understood! I'm ready to help." },
      ...messages,
    ];

    abortController = new AbortController();

    const response = await fetch(config.url, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(config.buildBody(fullMessages)),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `API Error (${response.status})`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson?.error?.message || errJson?.message || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    return config.extractResponse(data);
  }

  // â•â•â• Markdown Renderer (lightweight) â•â•â•
  function renderMarkdown(text) {
    // Escape HTML
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks with language and optional filename (e.g. ```python:main.py)
    html = html.replace(
      /```(\w+)?(?::([\w\.\-\/]+))?\n([\s\S]*?)```/g,
      function (_, lang, fileName, code) {
        let finalLang = lang || "code";
        let finalFileName = fileName;
        let finalCode = code.trim();

        // Robust check: AI sometimes puts filename on the first line inside the block
        // e.g. python:main.py
        if (!finalFileName) {
          const lines = finalCode.split("\n");
          const firstLine = lines[0].trim();
          
          // Check for "python:main.py" or "filename: main.py" or "# main.py"
          if (firstLine.includes(":") && firstLine.length < 50) {
            const parts = firstLine.split(":");
            const possibleFile = parts[1].trim();
            if (possibleFile.includes(".")) {
               finalFileName = possibleFile;
               finalCode = lines.slice(1).join("\n").trim();
            }
          } else if (firstLine.startsWith("# ") && firstLine.includes(".") && firstLine.length < 50) {
            finalFileName = firstLine.replace("# ", "").trim();
            finalCode = lines.slice(1).join("\n").trim();
          }
        }

        const displayLabel = finalFileName ? `${finalFileName} (${finalLang})` : finalLang;
        const createFileBtn = finalFileName ? `<button class="copilot-create-btn" onclick="window._copilotCreateFile(this, '${finalFileName}')"><i class="fas fa-file-export"></i> Create ${finalFileName}</button>` : '';
        
        return `
          <div class="copilot-code-header">
            <span>${displayLabel}</span>
            <button class="copilot-code-copy" onclick="window._copilotCopyCode(this)"><i class="fas fa-copy"></i> Copy</button>
          </div>
          <pre><code class="language-${finalLang}">${finalCode}</code></pre>
          <div class="copilot-code-actions">
            <button class="copilot-apply-btn" onclick="window._copilotApplyCode(this)"><i class="fas fa-check"></i> Apply to Editor</button>
            ${createFileBtn}
          </div>`;
      }
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Headers
    html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Line breaks to paragraphs
    html = html
      .split("\n\n")
      .map((block) => {
        block = block.trim();
        if (!block) return "";
        if (
          block.startsWith("<") &&
          !block.startsWith("<li>") &&
          !block.startsWith("<code>") &&
          !block.startsWith("<strong>") &&
          !block.startsWith("<em>")
        )
          return block;
        if (block.includes("<h1>") || block.includes("<h2>") || block.includes("<h3>") || block.includes("<h4>"))
          return block;
        if (block.includes("<ul>") || block.includes("<ol>")) return block;
        if (block.includes("<pre>") || block.includes("<div class=\"copilot-code")) return block;
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("\n");

    return html;
  }

  // â•â•â• Chat UI â•â•â•
  function addMessage(role, content) {
    chatHistory.push({ role, content });
    renderMessage(role, content);
    scrollToBottom();
  }

  function renderMessage(role, content, streaming = false) {
    const messagesEl = document.getElementById("copilot-messages");

    // Remove welcome message if it exists
    const welcome = messagesEl.querySelector(".copilot-welcome-msg");
    if (welcome) welcome.remove();

    const msgDiv = document.createElement("div");
    msgDiv.className = `copilot-msg ${role}${streaming ? " copilot-streaming" : ""}`;
    if (streaming) msgDiv.id = "copilot-streaming-msg";

    const avatar = document.createElement("div");
    avatar.className = "copilot-msg-avatar";
    avatar.innerHTML =
      role === "assistant"
        ? '<i class="fas fa-robot"></i>'
        : '<i class="fas fa-user"></i>';

    const bubble = document.createElement("div");
    bubble.className = "copilot-msg-bubble";
    bubble.innerHTML =
      role === "assistant" ? renderMarkdown(content) : escapeHtml(content).replace(/\n/g, "<br>");

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    messagesEl.appendChild(msgDiv);

    // Add click handlers for code actions
    if (role === "assistant") {
      bubble.querySelectorAll(".copilot-code-copy").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          window._copilotCopyCode(btn);
        });
      });
      bubble.querySelectorAll(".copilot-apply-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          window._copilotApplyCode(btn);
        });
      });
    }

    return msgDiv;
  }

  function showTypingIndicator() {
    const messagesEl = document.getElementById("copilot-messages");
    const typing = document.createElement("div");
    typing.className = "copilot-typing";
    typing.id = "copilot-typing";

    const avatar = document.createElement("div");
    avatar.className = "copilot-msg-avatar";
    avatar.innerHTML = '<i class="fas fa-robot"></i>';
    avatar.style.background = "linear-gradient(135deg, #7c3aed, #3b82f6)";
    avatar.style.color = "#fff";

    const dots = document.createElement("div");
    dots.className = "copilot-typing-dots";
    dots.innerHTML =
      '<div class="copilot-typing-dot"></div><div class="copilot-typing-dot"></div><div class="copilot-typing-dot"></div>';

    typing.appendChild(avatar);
    typing.appendChild(dots);
    messagesEl.appendChild(typing);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    document.getElementById("copilot-typing")?.remove();
  }

  function scrollToBottom() {
    const messagesEl = document.getElementById("copilot-messages");
    setTimeout(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 50);
  }

  function clearChat() {
    chatHistory = [];
    const messagesEl = document.getElementById("copilot-messages");
    messagesEl.innerHTML = `
      <div class="copilot-welcome-msg">
        <div class="copilot-avatar-large"><i class="fas fa-robot"></i></div>
        <h3>Hi! I'm your AI Copilot</h3>
        <p>I can help you write, fix, explain, and optimize code. Ask me anything or use the quick actions above!</p>
        <div class="copilot-suggestions">
          <button class="copilot-suggestion" data-prompt="Help me fix the errors in my code">ðŸ”§ Fix my code</button>
          <button class="copilot-suggestion" data-prompt="Explain this code step by step">ðŸ“– Explain this code</button>
          <button class="copilot-suggestion" data-prompt="Suggest improvements for my code">ðŸ’¡ Improve my code</button>
          <button class="copilot-suggestion" data-prompt="Write unit tests for this code">ðŸ§ª Write tests</button>
        </div>
      </div>
    `;
    bindSuggestionButtons();
    showNotification("Chat cleared", "info");
  }

  // â•â•â• Send Message â•â•â•
  async function sendMessage(content) {
    if (isStreaming || !content.trim()) return;

    // Attach code context if any
    let fullContent = content;
    if (attachedCode) {
      const lang = getCurrentLanguage();
      fullContent = `${content}\n\nHere is the code context:\n\`\`\`${lang}\n${attachedCode}\n\`\`\``;
      clearAttachedCode();
    } else {
      // Auto-attach current editor code if it looks like user is asking about code
      const codeRelatedKeywords = [
        "fix",
        "error",
        "bug",
        "explain",
        "refactor",
        "optimize",
        "review",
        "test",
        "help",
        "improve",
        "what",
        "how",
        "why",
        "my code",
        "this code",
      ];
      const hasCodeKeyword = codeRelatedKeywords.some((kw) =>
        content.toLowerCase().includes(kw)
      );
      if (hasCodeKeyword && editor && editor.getValue().trim()) {
        const selection = editor.getModel()?.getValueInRange(editor.getSelection());
        const code = selection && selection.trim() ? selection : editor.getValue();
        const lang = getCurrentLanguage();
        fullContent = `${content}\n\nHere is the code:\n\`\`\`${lang}\n${code}\n\`\`\``;
      }
    }

    // Show user message
    addMessage("user", content);
    const input = document.getElementById("copilot-input");
    input.value = "";
    input.style.height = "36px";
    document.getElementById("copilot-send").disabled = true;

    // Show typing indicator
    isStreaming = true;
    showTypingIndicator();
    updateCopilotStatus("loading");

    try {
      const messages = chatHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      // Replace last user message with full content (including code context)
      messages[messages.length - 1] = { role: "user", content: fullContent };

      const response = await callAI(messages);

      removeTypingIndicator();
      addMessage("assistant", response);
      updateCopilotStatus("ready");
    } catch (err) {
      removeTypingIndicator();
      if (err.name === "AbortError") {
        addMessage(
          "assistant",
          "âš ï¸ Request was cancelled."
        );
      } else {
        addMessage(
          "assistant",
          `âŒ **Error:** ${err.message}\n\n*Make sure your API key is configured correctly in Copilot Settings.*`
        );
      }
      updateCopilotStatus("error");
    }

    isStreaming = false;
    document.getElementById("copilot-send").disabled = false;
    input.focus();
  }

  // â•â•â• Quick Actions â•â•â•
  async function executeAction(action) {
    const code = getCodeForAction();
    if (!code) {
      showNotification(
        "Write or select some code first",
        "info"
      );
      return;
    }

    // Switch to copilot panel
    switchSidebarPanel("copilot");

    const lang = getCurrentLanguage();
    const actionNames = {
      "fix-errors": "ðŸ”§ Fix Errors",
      explain: "ðŸ“– Explain Code",
      refactor: "â™»ï¸ Refactor",
      "generate-docs": "ðŸ“ Generate Docs",
      "generate-tests": "ðŸ§ª Generate Tests",
      review: "ðŸ” Code Review",
      optimize: "âš¡ Optimize",
      convert: "ðŸ”„ Convert Language",
    };

    const prompt = getActionPrompt(action, code, lang);

    // Show user message
    addMessage("user", `${actionNames[action] || action}`);

    isStreaming = true;
    document.getElementById("copilot-send").disabled = true;
    showTypingIndicator();
    updateCopilotStatus("loading");

    try {
      const messages = [{ role: "user", content: prompt }];
      const response = await callAI(messages);

      removeTypingIndicator();
      addMessage("assistant", response);
      chatHistory.push({ role: "user", content: prompt });
      // Replace the display message with actual prompt in history
      chatHistory[chatHistory.length - 2] = {
        role: "user",
        content: prompt,
      };
      updateCopilotStatus("ready");
    } catch (err) {
      removeTypingIndicator();
      addMessage(
        "assistant",
        `âŒ **Error:** ${err.message}\n\n*Check your API key in Copilot Settings.*`
      );
      updateCopilotStatus("error");
    }

    isStreaming = false;
    document.getElementById("copilot-send").disabled = false;
  }

  // â•â•â• Code Helpers â•â•â•
  function getCodeForAction() {
    if (!editor) return null;
    const selection = editor
      .getModel()
      ?.getValueInRange(editor.getSelection());
    if (selection && selection.trim()) return selection;
    const fullCode = editor.getValue();
    return fullCode.trim() ? fullCode : null;
  }

  function getCurrentLanguage() {
    if (!editor) return "code";
    try {
      const model = editor.getModel();
      return model ? monaco.editor.getModelLanguage(model) || "code" : "code";
    } catch {
      return document.getElementById("language-selector")?.value || "code";
    }
  }

  function attachCodeContext() {
    const code = getCodeForAction();
    if (!code) return;
    attachedCode = code;
    document.getElementById("copilot-input-context").style.display = "flex";
    const lines = code.split("\n").length;
    document.getElementById(
      "copilot-context-label"
    ).textContent = `${lines} lines attached`;
  }

  function clearAttachedCode() {
    attachedCode = null;
    document.getElementById("copilot-input-context").style.display = "none";
  }

  // â•â•â• Copy / Apply Code â•â•â•
  function findCodeFromButton(btn, direction) {
    // Walk from the button upward to find the code block
    // Structure: <div.copilot-code-header> <pre><code>...</code></pre> <div.copilot-code-actions>
    const header = btn.closest(".copilot-code-header");
    if (header) {
      const pre = header.nextElementSibling;
      if (pre && pre.tagName === "PRE") {
        return pre.querySelector("code");
      }
    }
    // Try from actions div (Apply to Editor button)
    const actionsDiv = btn.closest(".copilot-code-actions");
    if (actionsDiv) {
      // Walk backwards through siblings to find the <pre>
      let sibling = actionsDiv.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === "PRE") return sibling.querySelector("code");
        sibling = sibling.previousElementSibling;
      }
    }
    // Fallback: search within the message bubble
    const bubble = btn.closest(".copilot-msg-bubble");
    if (bubble) {
      const allCodes = bubble.querySelectorAll("pre code");
      if (allCodes.length) return allCodes[allCodes.length - 1];
    }
    return null;
  }

  window._copilotCopyCode = function (btn) {
    const codeEl = findCodeFromButton(btn);
    if (!codeEl) return;
    navigator.clipboard.writeText(codeEl.textContent);
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-copy"></i> Copy';
    }, 2000);
  };

  window._copilotApplyCode = function (btn) {
    const codeEl = findCodeFromButton(btn);
    if (!codeEl || !editor) {
      showNotification("Could not find code to apply", "error");
      return;
    }

    const codeText = codeEl.textContent;
    const selection = editor.getSelection();

    // Make sure we have a file open â€” open a new one if needed
    if (!editor.getModel()) {
      showNotification("Open or create a file first", "info");
      return;
    }

    if (selection && !selection.isEmpty()) {
      // Replace selection
      editor.executeEdits("copilot", [
        { range: selection, text: codeText, forceMoveMarkers: true },
      ]);
    } else {
      // Replace entire content
      const model = editor.getModel();
      const fullRange = model.getFullModelRange();
      editor.executeEdits("copilot", [
        { range: fullRange, text: codeText, forceMoveMarkers: true },
      ]);
    }

    btn.innerHTML = '<i class="fas fa-check"></i> Applied!';
    btn.style.background = "linear-gradient(135deg, #059669, #10b981)";
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-check"></i> Apply to Editor';
      btn.style.background = "";
    }, 2500);

    showNotification("âœ… Code applied to editor!", "success");
  };

  window._copilotCreateFile = async function (btn, fileName) {
    const codeEl = findCodeFromButton(btn);
    if (!codeEl) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    const content = codeEl.textContent;
    const success = await window.createAndOpenFile(fileName, content);

    if (success) {
      btn.innerHTML = '<i class="fas fa-check"></i> Created!';
      btn.style.background = "linear-gradient(135deg, #059669, #10b981)";
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-file-export"></i> Create ${fileName}`;
        btn.style.background = "";
      }, 3000);
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-times"></i> Failed';
      setTimeout(() => {
        btn.innerHTML = `<i class="fas fa-file-export"></i> Create ${fileName}`;
      }, 3000);
    }
  };

  // â•â•â• Inline Widget (floating toolbar on code selection) â•â•â•
  function initInlineWidget() {
    if (!editor) return;

    editor.onDidChangeCursorSelection((e) => {
      if (!copilotSettings.inlineEnabled) return;
      clearTimeout(selectionTimeout);

      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) {
        inlineWidget.style.display = "none";
        return;
      }

      selectionTimeout = setTimeout(() => {
        const selectedText = editor
          .getModel()
          ?.getValueInRange(selection);
        if (!selectedText || selectedText.trim().length < 3) {
          inlineWidget.style.display = "none";
          return;
        }

        // Position the widget near the selection
        const endPos = selection.getEndPosition();
        const coords = editor.getScrolledVisiblePosition(endPos);
        const editorDom = editor.getDomNode();
        if (!coords || !editorDom) return;

        const editorRect = editorDom.getBoundingClientRect();
        const x = editorRect.left + coords.left;
        const y = editorRect.top + coords.top + coords.height + 4;

        inlineWidget.style.left = Math.min(x, window.innerWidth - 200) + "px";
        inlineWidget.style.top = Math.min(y, window.innerHeight - 40) + "px";
        inlineWidget.style.display = "flex";
      }, 400);
    });

    // Hide on click outside
    document.addEventListener("mousedown", (e) => {
      if (!inlineWidget.contains(e.target)) {
        inlineWidget.style.display = "none";
      }
    });
  }

  // â•â•â• Inline Suggestions (Ghost Text) â•â•â•
  let inlineSuggestionTimeout = null;
  let currentGhostDecoration = [];

  function initInlineSuggestions() {
    if (!editor) return;

    // Register inline completions provider for all languages
    const supportedLangs = [
      "python", "javascript", "typescript", "java", "cpp", "c",
      "html", "css", "json", "markdown", "plaintext",
    ];

    supportedLangs.forEach((lang) => {
      monaco.languages.registerInlineCompletionsProvider(lang, {
        provideInlineCompletions: async (model, position, context, token) => {
          if (!copilotSettings.inlineEnabled || !copilotSettings.apiKey) {
            return { items: [] };
          }

          // Only trigger after a debounce
          const lineContent = model.getLineContent(position.lineNumber);
          const textBefore = model.getValueInRange({
            startLineNumber: Math.max(1, position.lineNumber - 20),
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          if (textBefore.trim().length < 5) return { items: [] };

          try {
            const prompt = `You are an inline code completion AI. Complete the following ${lang} code. Only output the completion text (the part that comes AFTER what's already written). Do NOT repeat existing code. Do NOT add explanations. Just output the raw completion code.\n\nExisting code:\n${textBefore}`;

            const config = getApiConfig();
            if (!config || !copilotSettings.apiKey) return { items: [] };

            const response = await fetch(config.url, {
              method: "POST",
              headers: config.headers,
              body: JSON.stringify(
                config.buildBody([{ role: "user", content: prompt }])
              ),
              signal: token.onCancellationRequested ? AbortSignal.timeout(5000) : AbortSignal.timeout(5000),
            });

            if (!response.ok) return { items: [] };
            const data = await response.json();
            let completion = config.extractResponse(data);

            // Clean up the completion
            completion = completion
              .replace(/^```\w*\n?/, "")
              .replace(/\n?```$/, "")
              .trim();

            if (!completion) return { items: [] };

            return {
              items: [
                {
                  insertText: completion,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                },
              ],
            };
          } catch {
            return { items: [] };
          }
        },
        freeInlineCompletions: () => {},
      });
    });
  }

  // â•â•â• Status Bar â•â•â•
  function updateCopilotStatus(state) {
    let statusEl = document.getElementById("copilot-status");
    if (!statusEl) {
      // Create copilot status in status bar
      const statusRight = document.querySelector(".status-right");
      if (!statusRight) return;
      statusEl = document.createElement("span");
      statusEl.className = "status-item copilot-status";
      statusEl.id = "copilot-status";
      statusEl.innerHTML =
        '<span class="copilot-status-dot"></span> <i class="fas fa-robot" style="font-size:10px;"></i> Copilot';
      statusEl.addEventListener("click", () =>
        switchSidebarPanel("copilot")
      );
      statusRight.insertBefore(statusEl, statusRight.firstChild);
    }

    const dot = statusEl.querySelector(".copilot-status-dot");
    dot.className = "copilot-status-dot";
    if (state === "loading") dot.classList.add("loading");
    if (state === "error") dot.classList.add("error");
  }

  // â•â•â• Settings UI â•â•â•
  function initSettingsUI() {
    const overlay = document.getElementById("copilot-settings-overlay");
    const closeBtn = document.getElementById("copilot-settings-close");
    const saveBtn = document.getElementById("copilot-save-settings");
    const toggleKeyBtn = document.getElementById("copilot-toggle-key");
    const tempSlider = document.getElementById("copilot-temperature");
    const tempVal = document.getElementById("copilot-temp-val");
    const providerSelect = document.getElementById("copilot-api-provider");

    // Populate from settings
    function populateSettings() {
      document.getElementById("copilot-api-provider").value = copilotSettings.provider;
      document.getElementById("copilot-api-key").value = copilotSettings.apiKey;
      document.getElementById("copilot-model").value = copilotSettings.model;
      document.getElementById("copilot-temperature").value = Math.round(copilotSettings.temperature * 100);
      document.getElementById("copilot-temp-val").textContent = copilotSettings.temperature.toFixed(1);
      document.getElementById("copilot-inline-enabled").checked = copilotSettings.inlineEnabled;
      document.getElementById("copilot-auto-fix").checked = copilotSettings.autoFix;
      updateModelOptions(copilotSettings.provider);
    }

    // Update model options based on provider
    function updateModelOptions(provider) {
      const modelSelect = document.getElementById("copilot-model");
      const models = {
        gemini: [
          { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Fast)" },
          { value: "gemini-2.0-pro", label: "Gemini 2.0 Pro (Powerful)" },
          { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
          { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
        ],
        openai: [
          { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast)" },
          { value: "gpt-4o", label: "GPT-4o (Powerful)" },
          { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
          { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
        ],
        anthropic: [
          { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
          { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
          { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku (Fast)" },
        ],
        openrouter: [
          { value: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (Free)" },
          { value: "meta-llama/llama-3-70b-instruct", label: "Llama 3 70B" },
          { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
          { value: "openai/gpt-4o", label: "GPT-4o" },
        ],
      };

      modelSelect.innerHTML = "";
      (models[provider] || models.gemini).forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
      });
    }

    // Open settings
    document.getElementById("btn-copilot-settings").addEventListener("click", () => {
      populateSettings();
      overlay.style.display = "flex";
    });

    // Close settings
    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });

    // Toggle API key visibility
    toggleKeyBtn.addEventListener("click", () => {
      const input = document.getElementById("copilot-api-key");
      if (input.type === "password") {
        input.type = "text";
        toggleKeyBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
      } else {
        input.type = "password";
        toggleKeyBtn.innerHTML = '<i class="fas fa-eye"></i>';
      }
    });

    // Temperature slider
    tempSlider.addEventListener("input", () => {
      tempVal.textContent = (tempSlider.value / 100).toFixed(1);
    });

    // Provider change
    providerSelect.addEventListener("change", () => {
      updateModelOptions(providerSelect.value);
    });

    // Save settings
    saveBtn.addEventListener("click", () => {
      copilotSettings.provider = document.getElementById("copilot-api-provider").value;
      copilotSettings.apiKey = document.getElementById("copilot-api-key").value;
      copilotSettings.model = document.getElementById("copilot-model").value;
      copilotSettings.temperature = parseInt(document.getElementById("copilot-temperature").value) / 100;
      copilotSettings.inlineEnabled = document.getElementById("copilot-inline-enabled").checked;
      copilotSettings.autoFix = document.getElementById("copilot-auto-fix").checked;
      saveSettings();

      // Update model badge
      const modelNames = {
        "gemini-2.0-flash": "Gemini 2.0 Flash",
        "gemini-2.0-pro": "Gemini 2.0 Pro",
        "gemini-1.5-flash": "Gemini 1.5 Flash",
        "gemini-1.5-pro": "Gemini 1.5 Pro",
        "gpt-4o-mini": "GPT-4o Mini",
        "gpt-4o": "GPT-4o",
        "gpt-4-turbo": "GPT-4 Turbo",
        "gpt-3.5-turbo": "GPT-3.5 Turbo",
        "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
        "claude-3-opus-20240229": "Claude 3 Opus",
        "claude-3-haiku-20240307": "Claude 3 Haiku",
      };
      document.getElementById("copilot-model-badge").textContent =
        modelNames[copilotSettings.model] || copilotSettings.model;

      overlay.style.display = "none";
      showNotification("Copilot settings saved!", "success");
      updateCopilotStatus("ready");
    });
  }

  // â•â•â• Utility â•â•â•
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // â•â•â• Bind Suggestion Buttons â•â•â•
  function bindSuggestionButtons() {
    document.querySelectorAll(".copilot-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prompt = btn.dataset.prompt;
        if (prompt) {
          document.getElementById("copilot-input").value = prompt;
          sendMessage(prompt);
        }
      });
    });
  }

  // â•â•â• Command Palette Integration â•â•â•
  function addCopilotCommands() {
    if (typeof commands !== "undefined" && Array.isArray(commands)) {
      commands.push(
        { label: "AI Copilot: Chat", icon: "fas fa-robot", action: () => switchSidebarPanel("copilot") },
        { label: "AI Copilot: Fix Errors", icon: "fas fa-bug", action: () => executeAction("fix-errors") },
        { label: "AI Copilot: Explain Code", icon: "fas fa-lightbulb", action: () => executeAction("explain") },
        { label: "AI Copilot: Refactor", icon: "fas fa-recycle", action: () => executeAction("refactor") },
        { label: "AI Copilot: Generate Docs", icon: "fas fa-book", action: () => executeAction("generate-docs") },
        { label: "AI Copilot: Generate Tests", icon: "fas fa-vial", action: () => executeAction("generate-tests") },
        { label: "AI Copilot: Code Review", icon: "fas fa-search-plus", action: () => executeAction("review") },
        { label: "AI Copilot: Optimize", icon: "fas fa-tachometer-alt", action: () => executeAction("optimize") },
        { label: "AI Copilot: Settings", icon: "fas fa-sliders-h", action: () => { document.getElementById("copilot-settings-overlay").style.display = "flex"; } },
      );
    }
  }

  // â•â•â• Context Menu Integration â•â•â•
  function addEditorContextMenu() {
    if (!editor) return;

    // Add copilot actions to the editor context menu
    const actions = [
      { id: "copilot.fixErrors", label: "ðŸ¤– Copilot: Fix Errors", action: "fix-errors" },
      { id: "copilot.explain", label: "ðŸ¤– Copilot: Explain", action: "explain" },
      { id: "copilot.refactor", label: "ðŸ¤– Copilot: Refactor", action: "refactor" },
      { id: "copilot.docs", label: "ðŸ¤– Copilot: Generate Docs", action: "generate-docs" },
      { id: "copilot.tests", label: "ðŸ¤– Copilot: Generate Tests", action: "generate-tests" },
      { id: "copilot.review", label: "ðŸ¤– Copilot: Code Review", action: "review" },
    ];

    actions.forEach((a) => {
      editor.addAction({
        id: a.id,
        label: a.label,
        contextMenuGroupId: "9_copilot",
        contextMenuOrder: 1,
        run: () => executeAction(a.action),
      });
    });
  }

  // â•â•â• Auto Error Detection â•â•â•
  function initAutoErrorDetection() {
    if (!editor) return;

    // Monitor for model marker changes (errors/warnings)
    let errorCheckTimeout = null;
    monaco.editor.onDidChangeMarkers(([resource]) => {
      if (!copilotSettings.autoFix) return;
      clearTimeout(errorCheckTimeout);
      errorCheckTimeout = setTimeout(() => {
        const model = editor.getModel();
        if (!model || model.uri.toString() !== resource.toString()) return;

        const markers = monaco.editor.getModelMarkers({ resource });
        const errors = markers.filter(
          (m) => m.severity === monaco.MarkerSeverity.Error
        );

        if (errors.length > 0) {
          // Show a subtle notification
          const errorList = errors
            .slice(0, 3)
            .map(
              (e) =>
                `Line ${e.startLineNumber}: ${e.message}`
            )
            .join("\n");
          
          // Update problems panel count
          const statusErrors = document.getElementById("status-errors");
          if (statusErrors) {
            statusErrors.innerHTML = `<i class="fas fa-times-circle"></i> ${errors.length} <i class="fas fa-exclamation-triangle" style="margin-left:4px"></i> ${markers.length - errors.length}`;
          }
        }
      }, 1500);
    });
  }

  // â•â•â• Keyboard Shortcuts â•â•â•
  function initShortcuts() {
    document.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+Shift+I â€” Toggle Copilot Panel
      if (ctrl && e.shiftKey && e.key === "I") {
        e.preventDefault();
        switchSidebarPanel("copilot");
        document.getElementById("copilot-input")?.focus();
      }

      // Ctrl+Shift+K â€” Quick Fix
      if (ctrl && e.shiftKey && e.key === "K") {
        e.preventDefault();
        executeAction("fix-errors");
      }
    });
  }

  // â•â•â• Extensions Marketplace â•â•â•
  const EXTENSIONS_CATALOG = [
    {
      id: "prettier", name: "Prettier - Code Formatter", publisher: "Prettier",
      desc: "Opinionated code formatter for consistent style across your codebase",
      icon: "fas fa-magic", iconBg: "linear-gradient(135deg, #1a2b34, #c596c7)",
      stars: 4.8, downloads: "32.1M", category: "Formatter",
      features: ["Auto-format on save", "Support for JS, TS, CSS, HTML, JSON, YAML, Markdown", "Configurable rules via .prettierrc", "Integration with ESLint"]
    },
    {
      id: "eslint", name: "ESLint", publisher: "Microsoft",
      desc: "Integrates ESLint into the editor for real-time JavaScript/TypeScript linting",
      icon: "fas fa-exclamation-triangle", iconBg: "linear-gradient(135deg, #4b32c3, #7b68ee)",
      stars: 4.7, downloads: "28.5M", category: "Linter",
      features: ["Real-time error highlighting", "Auto-fix on save", "Supports custom ESLint configs", "Works with TypeScript"]
    },
    {
      id: "python", name: "Python", publisher: "Microsoft",
      desc: "Rich Python language support with IntelliSense, linting, debugging, and Jupyter notebooks",
      icon: "fab fa-python", iconBg: "linear-gradient(135deg, #3776ab, #ffd43b)",
      stars: 4.6, downloads: "95.2M", category: "Language",
      features: ["IntelliSense (Pylance)", "Debugging with breakpoints", "Jupyter notebook support", "Virtual environment management", "Unit test integration"]
    },
    {
      id: "gitlens", name: "GitLens â€” Git Supercharged", publisher: "GitKraken",
      desc: "Supercharge Git inside your editor with blame annotations, history, and more",
      icon: "fas fa-code-branch", iconBg: "linear-gradient(135deg, #0f4c75, #1b9aaa)",
      stars: 4.5, downloads: "21.3M", category: "Git",
      features: ["Inline Git blame annotations", "File and line history", "Commit graph visualization", "Repository comparison", "Interactive rebase editor"]
    },
    {
      id: "dracula", name: "Dracula Official Theme", publisher: "Dracula Theme",
      desc: "A dark theme with vibrant colors for comfortable coding day and night",
      icon: "fas fa-palette", iconBg: "linear-gradient(135deg, #282a36, #bd93f9)",
      stars: 4.9, downloads: "8.7M", category: "Theme",
      features: ["Dark color scheme", "High contrast options", "Syntax highlighting for 100+ languages", "Consistent color palette"]
    },
    {
      id: "liveshare", name: "Live Share", publisher: "Microsoft",
      desc: "Real-time collaborative editing and debugging with your team",
      icon: "fas fa-users", iconBg: "linear-gradient(135deg, #e91e63, #ff5722)",
      stars: 4.4, downloads: "15.8M", category: "Collaboration",
      features: ["Real-time code sharing", "Shared debugging sessions", "Shared terminal access", "Audio calls integration"]
    },
    {
      id: "docker", name: "Docker", publisher: "Microsoft",
      desc: "Build, manage, and deploy containerized applications with Docker",
      icon: "fab fa-docker", iconBg: "linear-gradient(135deg, #0db7ed, #003f8e)",
      stars: 4.5, downloads: "18.4M", category: "DevOps",
      features: ["Dockerfile and docker-compose support", "Container management panel", "Image inspection", "Docker Hub integration"]
    },
    {
      id: "bracket-pair", name: "Bracket Pair Colorizer", publisher: "CoenraadS",
      desc: "Colorize matching brackets for improved code readability",
      icon: "fas fa-brackets-curly", iconBg: "linear-gradient(135deg, #ff6b6b, #ffd93d)",
      stars: 4.3, downloads: "12.1M", category: "Visual",
      features: ["Color matching brackets", "Custom bracket pair colors", "Scope line highlighting", "Works with all languages"]
    },
    {
      id: "tailwindcss", name: "Tailwind CSS IntelliSense", publisher: "Tailwind Labs",
      desc: "Intelligent autocomplete, linting, and previews for Tailwind CSS",
      icon: "fas fa-wind", iconBg: "linear-gradient(135deg, #06b6d4, #0e7490)",
      stars: 4.8, downloads: "9.6M", category: "CSS",
      features: ["Class name autocomplete", "CSS preview on hover", "Linting for common mistakes", "Supports custom configs"]
    },
    {
      id: "rust-analyzer", name: "rust-analyzer", publisher: "rust-lang",
      desc: "A fast and feature-rich language server for Rust development",
      icon: "fas fa-cog", iconBg: "linear-gradient(135deg, #ce422b, #f74c00)",
      stars: 4.7, downloads: "5.2M", category: "Language",
      features: ["Smart code completion", "Go to definition", "Type inference hints", "Cargo integration", "Inline error messages"]
    },
    {
      id: "thunder-client", name: "Thunder Client", publisher: "Ranga Vadhineni",
      desc: "Lightweight REST API client inside your editor â€” no more switching tools",
      icon: "fas fa-bolt", iconBg: "linear-gradient(135deg, #7c3aed, #f59e0b)",
      stars: 4.6, downloads: "7.8M", category: "API Testing",
      features: ["Send HTTP requests", "Environment variables", "Collections & folders", "GraphQL support", "Response history"]
    },
    {
      id: "path-intellisense", name: "Path Intellisense", publisher: "Christian Kohler",
      desc: "Autocomplete filenames and paths as you type for faster navigation",
      icon: "fas fa-file-code", iconBg: "linear-gradient(135deg, #059669, #10b981)",
      stars: 4.4, downloads: "11.3M", category: "Productivity",
      features: ["Auto-complete file paths", "Supports relative and absolute paths", "Works in imports and requires", "Custom path mappings"]
    },
  ];

  const EXT_STORAGE_KEY = "gowtham-ide-extensions";

  function getInstalledExtensions() {
    try {
      return JSON.parse(localStorage.getItem(EXT_STORAGE_KEY)) || [];
    } catch { return []; }
  }

  function saveInstalledExtensions(list) {
    localStorage.setItem(EXT_STORAGE_KEY, JSON.stringify(list));
  }

  function initExtensionsMarketplace() {
    let installed = getInstalledExtensions();
    const marketplaceEl = document.getElementById("ext-marketplace");
    const installedEl = document.getElementById("ext-installed");
    const searchInput = document.getElementById("ext-search");
    const detailEl = document.getElementById("ext-detail");
    const detailContent = document.getElementById("ext-detail-content");
    const installedCountBadge = document.getElementById("installed-count");

    if (!marketplaceEl) return;

    function isInstalled(id) { return installed.includes(id); }

    function updateBadge() {
      if (installedCountBadge) installedCountBadge.textContent = installed.length;
    }

    function createExtCard(ext, showInstall = true) {
      const card = document.createElement("div");
      card.className = "ext-card";
      card.dataset.extId = ext.id;
      const stars = "â˜…".repeat(Math.floor(ext.stars)) + (ext.stars % 1 >= 0.5 ? "Â½" : "");
      const isInst = isInstalled(ext.id);

      card.innerHTML = `
        <div class="ext-card-icon" style="background:${ext.iconBg}"><i class="${ext.icon}"></i></div>
        <div class="ext-card-body">
          <div class="ext-card-name">${ext.name} <i class="fas fa-check-circle ext-verified"></i></div>
          <div class="ext-card-desc">${ext.desc}</div>
          <div class="ext-card-meta">
            <span>${ext.publisher}</span>
            <span><i class="fas fa-download"></i> ${ext.downloads}</span>
            <span class="ext-detail-stars">${stars} ${ext.stars}</span>
          </div>
        </div>
        ${showInstall ? `<div class="ext-card-actions">
          <button class="ext-install-btn${isInst ? ' installed' : ''}" data-ext-id="${ext.id}">
            ${isInst ? '<i class="fas fa-check"></i> Installed' : 'Install'}
          </button>
        </div>` : ''}
      `;

      // Click card to show detail
      card.addEventListener("click", (e) => {
        if (e.target.closest(".ext-install-btn")) return;
        showExtDetail(ext);
      });

      // Install/uninstall button
      const installBtn = card.querySelector(".ext-install-btn");
      if (installBtn) {
        installBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleInstall(ext.id, installBtn);
        });
      }

      return card;
    }

    function toggleInstall(id, btn) {
      if (isInstalled(id)) {
        installed = installed.filter(i => i !== id);
        btn.classList.remove("installed");
        btn.innerHTML = "Install";
        showNotification("Extension uninstalled", "info");
      } else {
        installed.push(id);
        btn.classList.add("installed");
        btn.innerHTML = '<i class="fas fa-check"></i> Installed';
        showNotification("Extension installed successfully!", "success");
      }
      saveInstalledExtensions(installed);
      updateBadge();
      renderInstalled();
      // Update all install buttons for this ext
      document.querySelectorAll(`.ext-install-btn[data-ext-id="${id}"]`).forEach(b => {
        if (isInstalled(id)) {
          b.classList.add("installed");
          b.innerHTML = '<i class="fas fa-check"></i> Installed';
        } else {
          b.classList.remove("installed");
          b.innerHTML = "Install";
        }
      });
    }

    function renderMarketplace(filter = "") {
      marketplaceEl.innerHTML = "";
      const filtered = EXTENSIONS_CATALOG.filter(e =>
        !filter || e.name.toLowerCase().includes(filter.toLowerCase()) ||
        e.desc.toLowerCase().includes(filter.toLowerCase()) ||
        e.category.toLowerCase().includes(filter.toLowerCase()) ||
        e.publisher.toLowerCase().includes(filter.toLowerCase())
      );
      if (filtered.length === 0) {
        marketplaceEl.innerHTML = `<div class="ext-empty"><i class="fas fa-search"></i><p>No extensions found for "${filter}"</p></div>`;
        return;
      }
      filtered.forEach(ext => marketplaceEl.appendChild(createExtCard(ext)));
    }

    function renderInstalled() {
      installedEl.innerHTML = "";
      if (installed.length === 0) {
        installedEl.innerHTML = `<div class="ext-empty"><i class="fas fa-puzzle-piece"></i><p>No extensions installed yet.<br>Browse the Marketplace to find extensions.</p></div>`;
        return;
      }
      installed.forEach(id => {
        const ext = EXTENSIONS_CATALOG.find(e => e.id === id);
        if (ext) installedEl.appendChild(createExtCard(ext));
      });
    }

    function showExtDetail(ext) {
      const isInst = isInstalled(ext.id);
      const stars = "â˜…".repeat(Math.floor(ext.stars)) + (ext.stars % 1 >= 0.5 ? "Â½" : "");
      detailContent.innerHTML = `
        <div class="ext-detail-hero">
          <div class="ext-detail-icon" style="background:${ext.iconBg}"><i class="${ext.icon}"></i></div>
          <div class="ext-detail-info">
            <div class="ext-detail-name">${ext.name}</div>
            <div class="ext-detail-publisher">${ext.publisher} <i class="fas fa-check-circle" style="color:var(--accent);font-size:10px;"></i></div>
            <div class="ext-detail-stats">
              <span><i class="fas fa-download"></i> ${ext.downloads}</span>
              <span class="ext-detail-stars"><i class="fas fa-star"></i> ${ext.stars}</span>
              <span><i class="fas fa-tag"></i> ${ext.category}</span>
            </div>
          </div>
        </div>
        <div style="padding:12px 16px;border-bottom:1px solid var(--border-secondary);">
          <button class="ext-install-btn${isInst ? ' installed' : ''}" data-ext-id="${ext.id}" style="width:100%;padding:8px 16px;font-size:12px;border-radius:6px;">
            ${isInst ? '<i class="fas fa-check"></i> Installed â€” Click to Uninstall' : '<i class="fas fa-download"></i> Install Extension'}
          </button>
        </div>
        <div class="ext-detail-body">
          <div class="ext-detail-section">
            <h4>Description</h4>
            <p>${ext.desc}</p>
          </div>
          <div class="ext-detail-section">
            <h4>Features</h4>
            <ul class="ext-detail-features">
              ${ext.features.map(f => `<li>${f}</li>`).join("")}
            </ul>
          </div>
        </div>
      `;

      // Bind detail install button
      const iBtn = detailContent.querySelector(".ext-install-btn");
      if (iBtn) {
        iBtn.addEventListener("click", () => toggleInstall(ext.id, iBtn));
      }

      // Show detail, hide lists
      marketplaceEl.style.display = "none";
      installedEl.style.display = "none";
      document.querySelector(".ext-tabs").style.display = "none";
      document.querySelector(".ext-search-wrap").style.display = "none";
      detailEl.style.display = "flex";
    }

    // Back from detail
    document.getElementById("ext-detail-back")?.addEventListener("click", () => {
      detailEl.style.display = "none";
      document.querySelector(".ext-tabs").style.display = "";
      document.querySelector(".ext-search-wrap").style.display = "";
      const activeTab = document.querySelector(".ext-tab.active");
      if (activeTab?.dataset.tab === "installed") {
        installedEl.style.display = "flex";
        installedEl.classList.add("active");
      } else {
        marketplaceEl.style.display = "flex";
        marketplaceEl.classList.add("active");
      }
      renderMarketplace(searchInput.value);
      renderInstalled();
    });

    // Tab switching
    document.querySelectorAll(".ext-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".ext-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        if (tab.dataset.tab === "marketplace") {
          marketplaceEl.classList.add("active");
          installedEl.classList.remove("active");
        } else {
          marketplaceEl.classList.remove("active");
          installedEl.classList.add("active");
          renderInstalled();
        }
      });
    });

    // Search
    searchInput?.addEventListener("input", () => {
      renderMarketplace(searchInput.value);
    });

    // Refresh button
    document.getElementById("btn-ext-refresh")?.addEventListener("click", () => {
      renderMarketplace(searchInput.value);
      renderInstalled();
      showNotification("Extensions refreshed", "info");
    });

    // Initial render
    renderMarketplace();
    renderInstalled();
    updateBadge();
  }

  // â•â•â• Initialize Everything â•â•â•
  function initCopilot() {
    // Settings UI
    initSettingsUI();

    // Quick action chips
    document.querySelectorAll(".copilot-action-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        executeAction(chip.dataset.action);
      });
    });

    // Inline widget buttons
    document.querySelectorAll(".copilot-inline-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        inlineWidget.style.display = "none";
        const action = btn.dataset.action;
        if (action === "ask") {
          attachCodeContext();
          switchSidebarPanel("copilot");
          document.getElementById("copilot-input")?.focus();
        } else {
          executeAction(action);
        }
      });
    });

    // Send button
    document.getElementById("copilot-send").addEventListener("click", () => {
      const input = document.getElementById("copilot-input");
      sendMessage(input.value);
    });

    // Input handling
    const inputEl = document.getElementById("copilot-input");
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inputEl.value);
      }
    });

    // Auto-resize textarea
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "36px";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
    });

    // Clear chat
    document.getElementById("btn-copilot-clear").addEventListener("click", clearChat);

    // Close copilot panel
    document.getElementById("btn-copilot-close")?.addEventListener("click", () => {
      switchSidebarPanel("explorer");
    });

    // Context remove
    document.getElementById("copilot-context-remove").addEventListener("click", clearAttachedCode);

    // Suggestion buttons
    bindSuggestionButtons();

    // Editor integrations
    initInlineWidget();
    initInlineSuggestions();
    addEditorContextMenu();
    initAutoErrorDetection();

    // Command palette & shortcuts
    addCopilotCommands();
    initShortcuts();

    // Extensions marketplace
    initExtensionsMarketplace();

    // AI Agents
      initAgents();

    // Voice Assistant
    initVoiceAssistant();

    // Settings Modal Logic
    setTimeout(initSettingsLogic, 500); // Small delay to ensure DOM is ready

    // Status bar
    updateCopilotStatus(copilotSettings.apiKey ? "ready" : "error");

    console.log("🤖 AI Copilot initialized!");
  }

  function initSettingsLogic() {
    const btn = document.getElementById("btn-settings");
    const overlay = document.getElementById("copilot-settings-overlay");
    const closeBtn = document.getElementById("copilot-settings-close");
    const saveBtn = document.getElementById("copilot-save-settings");

    if (!btn || !overlay) return;

    // Show settings
    btn.onclick = (e) => {
      e.preventDefault();
      overlay.style.display = "flex";
      // Sync settings
      document.getElementById("copilot-api-key").value = copilotSettings.apiKey;
      document.getElementById("copilot-api-provider").value = copilotSettings.provider;
      document.getElementById("copilot-model").value = copilotSettings.model;
    };

    if (closeBtn) closeBtn.onclick = () => { overlay.style.display = "none"; };
    
    // Auto-close overlay on click outside
    overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };

    // Modal tabs handled by renderer.js delegator
    // Sidebar position handled by renderer.js delegator
    document.getElementById("setting-sidebar-side")?.addEventListener("change", (e) => {
      const side = e.target.value;
      const main = document.getElementById("main-container");
      if (side === "right") {
        main.style.flexDirection = "row-reverse";
        document.getElementById("activity-bar").style.borderLeft = "1px solid var(--border-color)";
        document.getElementById("activity-bar").style.borderRight = "none";
      } else {
        main.style.flexDirection = "row";
        document.getElementById("activity-bar").style.borderRight = "1px solid var(--border-color)";
        document.getElementById("activity-bar").style.borderLeft = "none";
      }
    });

    // Accent colors
    document.querySelectorAll(".accent-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        const color = dot.dataset.color;
        document.documentElement.style.setProperty("--accent-primary", color);
        document.querySelectorAll(".accent-dot").forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
      });
    });

    // Save
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        copilotSettings.apiKey = document.getElementById("copilot-api-key").value;
        copilotSettings.provider = document.getElementById("copilot-api-provider").value;
        copilotSettings.model = document.getElementById("copilot-model").value;
        saveSettings();
        overlay.style.display = "none";
        showNotification("Settings saved and applied!", "success");
        updateCopilotStatus(copilotSettings.apiKey ? "ready" : "error");
      });
    }
  }

  function initAgents() {
    // Agent cards actions
    document.querySelectorAll(".agent-action-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const card = e.target.closest(".agent-card");
        const agentType = card.dataset.agent;
        launchAgent(agentType);
      });
    });

    // Close button
    document.getElementById("btn-agents-close")?.addEventListener("click", () => {
      switchSidebarPanel("explorer");
    });

    // Refresh button
    document.getElementById("btn-agents-refresh")?.addEventListener("click", () => {
      showNotification("Agents synchronized", "success");
    });
  }

  function launchAgent(type) {
    let prompt = "";
    let name = "";
    
    switch(type) {
      case 'architect':
        name = "Architect Bot";
        prompt = "I'm ready to architect your project. Provide a name and description, and I'll generate the multi-file structure.";
        break;
      case 'web-designer':
        name = "Web Designer";
        prompt = "Web design studio is open! Describe the website you want, and I'll build the HTML, CSS, and JS. I'll also help you preview it instantly using the Live Server.";
        break;
      case 'orchestrator':
        name = "Lead Orchestrator";
        prompt = "MULTI-AGENT ORCHESTRATION MODE: I am now the Lead Architect. I will hire and manage specialized sub-agents to solve your most complex request. What is our high-level objective?";
        break;
      case 'debugger':
        name = "Debug Master";
        prompt = "System scanner active. Please link the broken files or describe the error symptoms.";
        break;
      case 'refactorer':
        name = "Refactor Pro";
        prompt = "Analysis mode engaged. I'll look for code smells and suggest a high-level refactoring plan.";
        break;
    }

    switchSidebarPanel("copilot");
    
    // Header style
    const header = document.querySelector(".copilot-header .sidebar-title");
    if (header) {
      if (!window._origCopilotTitle) window._origCopilotTitle = header.innerHTML;
      header.innerHTML = `<i class="fas fa-brain" style="color:#f472b6;"></i> AGENT: ${name}`;
    }

    addMessage("assistant", `**[AGENT MISSION: ${name.toUpperCase()} ACTIVATED]**\n\n${prompt}`);

    // Fetch project structure for the agent
    attachProjectStructure();

    // Revert header when clear is clicked
    document.getElementById("btn-copilot-clear")?.addEventListener("click", () => {
      if (header && window._origCopilotTitle) header.innerHTML = window._origCopilotTitle;
    }, { once: true });
  }

  async function attachProjectStructure() {
    try {
      const structure = await ipcRenderer.invoke("get-project-structure");
      if (!structure || structure.length === 0) return;
      
      const fileList = structure.map(f => `${f.isDirectory ? '[DIR] ' : '      '}${f.path}`).join('\n');
      const contextText = `\n\n--- PROJECT STRUCTURE ---\n${fileList}\n------------------------\n`;
      
      // We don't show it in UI message but add to the next prompt
      window._agentProjectContext = contextText;
    } catch {}
  }

  // Intercept sendMessage to add context if an agent is active
  const originalSendMessage = sendMessage;
  window.sendMessage = async function(content) {
    let finalContent = content;
    if (window._agentProjectContext) {
      finalContent = content + window._agentProjectContext;
      window._agentProjectContext = null; // Use once
    }
    const response = await originalSendMessage(finalContent);
    
    // Optionally speak response if enabled (default true for now)
    if (response) speakMessage(response);
    return response;
  };

  // --- Voice Assistant ---
  let recognition = null;
  function initVoiceAssistant() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      document.getElementById("btn-copilot-voice")?.remove();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    const overlay = document.getElementById("copilot-voice-overlay");
    const transcriptEl = document.getElementById("voice-transcript-live");

    recognition.onstart = () => {
      if (overlay) overlay.style.display = "flex";
      if (transcriptEl) transcriptEl.textContent = "Listening...";
    };

    recognition.onresult = (event) => {
      let current = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        current += event.results[i][0].transcript;
      }
      if (transcriptEl) transcriptEl.textContent = current;
    };

    recognition.onend = () => {
      const final = transcriptEl ? transcriptEl.textContent : "";
      if (overlay) overlay.style.display = "none";
      if (final && final !== "Listening..." && final.length > 2) {
        document.getElementById("copilot-input").value = final;
        sendMessage(final);
      }
    };

    recognition.onerror = () => {
      if (overlay) overlay.style.display = "none";
      showNotification("Voice capture failed", "error");
    };

    document.getElementById("btn-copilot-voice")?.addEventListener("click", () => {
      try { recognition.start(); } catch {}
    });

    document.getElementById("btn-voice-stop")?.addEventListener("click", () => {
      recognition.stop();
    });
  }

  function speakMessage(text) {
    if (!window.speechSynthesis) return;
    // Clean text: remove code blocks, markdown symbols
    const clean = text.replace(/```[\s\S]*?```/g, " [I've written a code block for you] ")
                      .replace(/([#*`_-])/g, "")
                      .slice(0, 300); // Limit length for now
    
    const ut = new SpeechSynthesisUtterance(clean);
    ut.rate = 1.05;
    ut.pitch = 1.0;
    speechSynthesis.speak(ut);
  }

  // Wait for editor to be ready, then init
  const waitForEditor = setInterval(() => {
    if (typeof editor !== "undefined" && editor && typeof monaco !== "undefined") {
      clearInterval(waitForEditor);
      setTimeout(initCopilot, 300);
    }
  }, 100);
  // â• â• â•  Project-wide Bug Scanner â• â• â• 
  window.scanProjectForBugs = async function() {
    if (!copilotSettings.apiKey) {
      showNotification("Please set your API Key in Settings first", "error");
      return;
    }
    
    // Switch to copilot panel
    if (typeof switchSidebarPanel === 'function') switchSidebarPanel("copilot");
    
    addMessage("user", "ðŸ” Scan my entire project for potential bugs, security vulnerabilities, and code quality issues.");
    
    const root = await ipcRenderer.invoke("get-project-structure");
    if (!root || root.length === 0) {
      addMessage("assistant", "I couldn't find any files to scan. Make sure you have a folder open.");
      return;
    }
    
    const fileHighlights = [];
    // Only scan top 10 relevant files to avoid context limits
    const relevantFiles = root.filter(f => !f.isDirectory && (f.path.endsWith('.py') || f.path.endsWith('.js') || f.path.endsWith('.java'))).slice(0, 10);
    
    for (const f of relevantFiles) {
      const content = await ipcRenderer.invoke("read-file", f.path);
      if (content) {
        fileHighlights.push(`--- File: ${f.path} ---\n${content.substring(0, 2000)}`);
      }
    }
    
    const prompt = `I need a project-wide bug audit. Here are some key files from the project:\n\n${fileHighlights.join('\n\n')}\n\nPlease identify specific bugs, logic errors, or security risks. Format your response with clear sections and actionable fixes.`;
    
    await sendMessage(prompt);
  };
})();


