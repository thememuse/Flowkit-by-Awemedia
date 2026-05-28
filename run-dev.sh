#!/usr/bin/env bash
# ============================================================
# run-dev.sh — Start Flow Kit in development mode
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=================================================="
echo "  Flow Kit — Development Mode"
echo "=================================================="
echo ""

# Check venv exists
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "ERROR: Python venv not found."
    echo "Run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Check node modules
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "Installing root node modules..."
    cd "$SCRIPT_DIR" && npm install
fi

if [ ! -d "$SCRIPT_DIR/dashboard/node_modules" ]; then
    echo "Installing dashboard node modules..."
    cd "$SCRIPT_DIR/dashboard" && npm install && cd ..
fi

echo "Starting in development mode..."
echo ""
echo "  • Vite dev server will start on http://localhost:5173"
echo "  • Electron will launch after Vite is ready"
echo "  • Python agent will auto-start"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

cd "$SCRIPT_DIR"

# Set venv Python as default for Electron to find
export PATH="$SCRIPT_DIR/venv/bin:$PATH"

# Run everything with concurrently
npm run dev
