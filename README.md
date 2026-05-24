# Smart RSS Aggregator (Apple Intelligence Local)

An elegant, personal, 100% local, self-hosted RSS reader and "smart aggregator" designed to run locally on Apple Silicon Mac systems. 

It accepts website domains, automatically discovers their underlying RSS feeds, tracks crawled articles, clusters similar stories within a 6-hour window (using a lightweight pure-Python TF-IDF and Cosine Similarity parser), and uses a compiled Swift helper to bridge data to macOS's native **Foundation Models** local LLM framework to consolidate coverage into a unified, rich "Master Story" entry.

---

## Technical Stack & Highlights

1. **Swift LLM Bridge (`bridge/`):**
   - Directly executes macOS local LLM (`LanguageModelSession`) from the command line using Swift Package Manager compiled binaries.
   - Accepts JSON-serialized input feeds from standard input, runs inference locally, validates JSON format conformity, and prints structured JSON payloads to standard output.
2. **FastAPI Web Server (`backend/`):**
   - FastAPI handles incoming requests, serves REST endpoints for feed additions, deletions, listings, and manual synchronization.
   - Integrates a background thread performing hourly automated crawls.
   - Dynamically serves the assets and index of our frontend dashboard.
3. **Pure-Python Similarity Clustering (`backend/clustering.py`):**
   - Implements native, zero-dependency tokenization, Stop Words filtering, Term Frequency (TF), Inverse Document Frequency (IDF), and Cosine Similarity.
   - Pairs related feeds using a single-linkage agglomerative clustering model within the 6-hour window.
4. **SQLite Local Storage (`reader.db`):**
   - Tracks feeds, crawled article attributes, and generated consolidated master stories, maintaining perfect foreign key relational bindings.
5. **Glassmorphic Single-Page UI (`frontend/`):**
   - Modern, gorgeous dark-mode dashboard styled with Google Fonts (Outfit & Plus Jakarta Sans) and Tailwind CSS.
   - Dynamically highlights merged stories, presents clear summaries, and exposes high-fidelity callout cards for differing news angles/perspectives.

---

## Project Structure

```text
smart-rss-aggregator/
├── backend/
│   ├── app.py              # FastAPI application & REST routing
│   ├── database.py         # SQLite models & database interface
│   ├── discovery.py        # RSS crawler & HTML auto-discovery
│   ├── clustering.py       # Local TF-IDF Cosine text similarity
│   └── sync.py             # Hourly background scheduler & Swift bridge executor
├── bridge/
│   ├── Sources/
│   │   └── main.swift      # Swift LanguageModelSession CLI logic
│   ├── Package.swift       # Swift Package Manager manifest
│   └── Makefile            # Native compilation rules
├── frontend/
│   ├── index.html          # Scannable glassmorphic SPA dashboard
│   └── assets/
│       └── app.js          # Clientside UI state manager
├── llm-bridge              # Compiled Swift helper binary (added during build)
├── reader.db               # SQLite database file (created on runtime)
└── README.md               # User guide & operations manual
```

---

## System Requirements

- **Processor:** Apple Silicon Mac (M1, M2, M3, M4, or later series).
- **Operating System:** macOS Sequoia 15.0 / macOS 26.0 or newer.
- **AI Core:** Apple Intelligence must be activated in your Mac System Settings (guarantees the native `LanguageModelSession` has access to the local on-device models).
- **Tooling:** Xcode Command Line Tools installed (run `xcode-select --install` if needed) and Python 3.9+.

---

## 🚀 Zero-Interaction Quick Start (Autonomous Bootstrapping)

For a fully automated, zero-interaction setup and startup, you can skip the manual installation steps and run the autonomous bootstrap launcher script directly from the project root:

```bash
./start.sh
```

**What this script does autonomously:**
1. Installs all required Python dependencies silently.
2. Compiles the Swift local LLM bridge if not already compiled.
3. Automatically registers the required ad-hoc codesignature on the compiled binary.
4. Auto-detects if `tmux` is installed. If so, it boots both the FastAPI web server and task worker inside a detached tmux session named `aggregator` to bypass background daemon model sandboxing blocks. If not, it falls back to background processes using `nohup`.
5. Cleanly prunes and restarts any stale processes running on port `5005` to prevent conflicts.

---

## Step 1: Compiling the Swift LLM Bridge

To compile the Swift command-line helper using optimized SPM building and link it to the project root:

```bash
cd bridge
make
```

*This creates the executable `llm-bridge` in your main project folder. To clean build files, you can run `make clean`.*

---

## Step 2: Setting up Python Environment & Dependencies

1. Navigate to the project root and create a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
2. Install the necessary Python packages:
   ```bash
   pip install fastapi uvicorn feedparser beautifulsoup4 requests pydantic
   ```

---

## Step 3: Launching the Aggregator Server

Start the FastAPI application. It runs locally on port `5005`:

```bash
python3 -m backend.app
```

Now, open your web browser and navigate to:
👉 **[http://localhost:5005](http://localhost:5005)**

---

## How It Works Under the Hood

1. **Feed Auto-Discovery:** When you enter a website domain (e.g. `techcrunch.com`), the app crawls the page's HTML, parses `<link rel="alternate">` metadata tags to discover the actual feed path, fetches the XML content to capture the feed title, and registers the feed.
2. **Synchronization:** The background synchronization pipeline crawls all saved feeds, extracts plain text from descriptions, checks for newly crawled articles in the last 6 hours, and groups similar articles using the TF-IDF clustering module.
3. **Consolidation & Differing Perspectives:**
   - **Single Articles:** Passed to `llm-bridge` to generate a 2-3 bullet point local summary.
   - **Merged Articles (Multiple sources):** Passed to `llm-bridge`. Apple Intelligence generates a cohesive title, a bullet-point summary referencing inline sources (e.g., `[TechCrunch]`), and critically analyzes and reports differing editorial perspectives, editorial stances, or price/date discrepancies in the "Differing Perspectives" callout box.
4. **Resiliency Fallback:** If the `llm-bridge` fails or is run on a device where local models are loading or unavailable, the backend automatically intercepts the exception, triggers a clean structured mock summary fallback, and populates the dashboard, keeping the interface 100% functional at all times.
