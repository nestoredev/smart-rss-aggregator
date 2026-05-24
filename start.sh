#!/bin/bash
# ==============================================================================
# SMART RSS AGGREGATOR - AUTONOMOUS BOOTSTRAP & LAUNCHER
# Designed for macOS Sequoia / M-Series Apple Silicon Macs
# Runs completely non-interactively with zero user interaction required.
# ==============================================================================
set -e

echo "=================================================================="
echo "          SMART RSS AGGREGATOR - AUTONOMOUS BOOTSTRAP"
echo "=================================================================="

# Ensure working directory is the script's folder
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# 1. Install dependencies
echo "[1/4] Verifying and installing Python dependencies..."
pip3 install --quiet beautifulsoup4 feedparser fastapi pydantic uvicorn

# 2. Build Swift Bridge if missing
if [ ! -f "llm-bridge" ]; then
    echo "[2/4] Compiling Swift local LLM bridge..."
    cd bridge
    swift build -c release --quiet
    cp .build/release/llm-bridge ../llm-bridge
    cd ..
else
    echo "[2/4] Swift bridge 'llm-bridge' already compiled."
fi

# 3. Ad-hoc Codesign helper
echo "[3/4] Applying ad-hoc codesignature on Swift bridge..."
codesign -s - --force llm-bridge

# 4. Launch Services
echo "[4/4] Launching aggregator services..."

# Check if there are active processes on port 5005 and kill them to prevent conflicts
EXISTING_PID=$(lsof -t -i:5005 2>/dev/null || true)
if [ ! -z "$EXISTING_PID" ]; then
    echo "Cleaning up stale processes running on port 5005 (PID: $EXISTING_PID)..."
    kill -9 $EXISTING_PID 2>/dev/null || true
fi

# Kill any existing background worker
EXISTING_WORKER=$(ps aux | grep -i "backend.worker" | grep -v "grep" | awk '{print $2}' || true)
if [ ! -z "$EXISTING_WORKER" ]; then
    echo "Cleaning up stale background worker processes..."
    kill -9 $EXISTING_WORKER 2>/dev/null || true
fi

if command -v tmux &> /dev/null; then
    echo "tmux detected! Launching services inside a detached tmux session named 'aggregator'..."
    
    # Kill any existing tmux session named 'aggregator'
    tmux kill-session -t aggregator 2>/dev/null || true
    
    # Start web server in pane 1
    tmux new-session -d -s aggregator -n "app" "python3 -m backend.app"
    
    # Start worker in pane 2 (splits horizontally)
    tmux split-window -h -t aggregator "python3 -m backend.worker"
    
    echo "✅ Services successfully running inside tmux!"
    echo "   To monitor logs: tmux attach -t aggregator"
else
    echo "tmux not detected. Starting services as background processes using nohup..."
    
    # Start FastAPI Web Server
    nohup python3 -m backend.app > server.log 2>&1 &
    echo "✅ FastAPI Server started (PID: $!). Logs: server.log"
    
    # Start LLM Task Worker
    nohup python3 -m backend.worker > worker.log 2>&1 &
    echo "✅ Task Worker started (PID: $!). Logs: worker.log"
fi

echo "=================================================================="
echo "🎉 Aggregator is active! Access from iPad or browser at:"
echo "👉 http://localhost:5005"
echo "=================================================================="
