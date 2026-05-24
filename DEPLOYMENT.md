# Smart RSS Aggregator - Mac Mini Server Deployment Guide

This guide provides step-by-step instructions to port, install, and run the **Smart RSS Aggregator** on a headless or desktop Mac Mini server. 

Since this app utilizes macOS's local **Apple Intelligence Neural Framework** (`LanguageModelSession`), there are unique sandboxing and compilation constraints that must be followed.

---

## 💻 System Prerequisites

Before deploying to the Mac Mini, ensure the server meets these exact specifications:
1. **Hardware:** Mac Mini with Apple Silicon (M1, M2, M3, M4 series or higher). Intel-based Macs are **not** supported.
2. **OS Version:** macOS Sequoia 15.0 or 26.0+ with Xcode Command Line Tools installed.
3. **Apple Intelligence Active:** Apple Intelligence **must be enabled** in the Mac Mini's *System Settings* (downloading the local neural models is required for the local LLM bridge to function).
4. **Interactive Session Access:** You must have terminal access to the Mac Mini (either locally or via SSH).

---

## ⚡ The Autonomous Way (Zero-Interaction Installation)

We have included a fully automated launcher script `start.sh` in the root of the project. This script installs all python dependencies, compiles the SPM Swift neural bridge, applies the ad-hoc security codesignature, clean-restarts port conflicts, and launches both services cleanly in the background:

```bash
# Clone the repository onto your Mac Mini server and execute:
./start.sh
```

**What the script does automatically:**
1. Installs all required Python dependencies silently (`pip3 install --quiet ...`).
2. Compiles the SPM Swift LLM bridge if not already compiled.
3. Registers the required ad-hoc codesignature (`codesign -s - --force llm-bridge`) so it can access macOS local language models securely.
4. Auto-detects if `tmux` is installed. If so, it boots both the FastAPI web server and task worker inside a detached tmux session named `aggregator` to bypass background daemon model sandboxing blocks. If not, it falls back to background processes using `nohup`.
5. Cleanly prunes and restarts any stale processes running on port `5005` to prevent conflicts.

---

## 🛠️ Step-by-Step Porting & Setup

On your new Mac Mini server, open Terminal (or SSH into it) and execute these instructions. You can give these exact steps to a local **Antigravity** coding assistant on the Mac Mini to automate the installation:

### Step 1: Clone the Codebase
Clone your repository to a directory on your Mac Mini server (e.g. `~/Developer/smart-rss-aggregator`):
```bash
git clone <your-github-repo-url> ~/Developer/smart-rss-aggregator
cd ~/Developer/smart-rss-aggregator
```

### Step 2: Install Python Dependencies
Ensure Python 3 is installed, then install the lightweight parsing and web dependencies:
```bash
pip3 install beautifulsoup4 feedparser fastapi pydantic uvicorn
```
*(No heavy machine-learning packages are required. TF-IDF similarity clustering is written in pure Python to keep installation under 3 seconds!)*

### Step 3: Compile the Swift Neural Bridge
Build the command-line bridge using Swift Package Manager. This links Xcode's native `FoundationModels` framework:
```bash
cd bridge
swift build -c release
cp .build/release/llm-bridge ../llm-bridge
cd ..
```
*(Alternatively, simply run `make` inside the `bridge/` directory).*

### Step 4: Ad-Hoc Codesign the Subprocess
To satisfy Gatekeeper and the macOS security sandbox when importing local neural frameworks, you **must** ad-hoc codesign the compiled binary:
```bash
codesign -s - --force llm-bridge
```

---

## 🚀 Running the Aggregator on the Server (Headless/SSH)

> [!CAUTION]
> **CRITICAL SANDBOX RESTRICTION: The TTY Rule**
> macOS completely blocks access to on-device LLMs (`LanguageModelSession`) in headless background daemon processes (such as standard `launchd` or `systemd` scripts), killing the process with a `SIGKILL` (exit code 137).
> 
> To bypass this sandboxing block, the **Task Worker** (`worker.py`) **MUST** be run in an interactive foreground session with TTY focus. We use `tmux` (Terminal Multiplexer) to keep this session alive after you disconnect from SSH.

### Step 5: Install and Setup `tmux`
On the Mac Mini, install `tmux` (using Homebrew):
```bash
brew install tmux
```

### Step 6: Start the Services in `tmux`

1. **Launch a new tmux session named `aggregator`:**
   ```bash
   tmux new -s aggregator
   ```
2. **Split the pane horizontally** (press `Ctrl+B`, then release and press `%`) or open a new window (press `Ctrl+B`, then `C`).
3. **In Pane 1 (Start the FastAPI Web Server):**
   ```bash
   python3 -m backend.app
   ```
   *(This starts Uvicorn hosting on port `5005`)*
4. **Switch to Pane 2** (press `Ctrl+B`, then the arrow keys) **and start the interactive LLM Task Worker:**
   ```bash
   python3 -m backend.worker
   ```
   *(This polls the SQLite database, crawls feeds, runs scraping, and calls the Swift Apple Intelligence bridge)*
5. **Detach from the tmux session** (press `Ctrl+B`, then press `D`).
   * *Your services are now running completely in the background, and will stay alive even if you close the terminal or log out of SSH!*

*To re-attach to the session at any time to inspect logs, run:*
```bash
tmux attach -t aggregator
```

---

## 📶 iPad & Remote Network Access

To access the gorgeous dashboard from your iPad or other devices in your house:

1. **Install Tailscale:** Install [Tailscale](https://tailscale.com/) on both the Mac Mini and your iPad. This creates a secure, private, zero-configuration local network.
2. **Find the Tailscale IP:** Copy the private Tailscale IP of your Mac Mini (e.g. `100.75.12.83`).
3. **Open on iPad:** Open Safari on your iPad and load:
   ```text
   http://<MAC_MINI_TAILSCALE_IP>:5005
   ```
4. **Incognito/Private Tab Tip:** The first time you load the app, load it in a **Private Browsing / Incognito** tab. This completely bypasses aggressive Safari browser caching and guarantees the local `tailwind.js` asset and stylesheet load correctly.
