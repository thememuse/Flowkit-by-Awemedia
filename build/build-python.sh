#!/usr/bin/env bash
# ============================================================
# build/build-python.sh — Build Python agent with PyInstaller
# Creates: resources/agent-mac/agent (standalone binary)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/resources/agent-mac"

echo "=================================================="
echo "  Flow Kit — Python Agent Build (macOS)"
echo "=================================================="
echo ""
echo "Project root: $PROJECT_ROOT"
echo "Output dir:   $OUTPUT_DIR"
echo ""

# Check for Python 3
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found. Install Python 3.10+ first."
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python version: $PY_VER"

# Activate venv if it exists
VENV="$PROJECT_ROOT/venv"
if [ -d "$VENV" ]; then
    echo "Activating venv: $VENV"
    source "$VENV/bin/activate"
else
    echo "WARNING: No venv found. Creating one..."
    python3 -m venv "$VENV"
    source "$VENV/bin/activate"
    pip install -q --upgrade pip
    pip install -q -r "$PROJECT_ROOT/requirements.txt"
fi

# Install PyInstaller if not present
if ! python3 -c "import PyInstaller" 2>/dev/null; then
    echo "Installing PyInstaller..."
    pip install -q pyinstaller
fi

echo "PyInstaller version: $(python3 -m PyInstaller --version)"

# Clean previous build
rm -rf "$PROJECT_ROOT/build-pyinstaller" "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo ""
echo "Building Python agent binary..."

# Run PyInstaller
cd "$PROJECT_ROOT"
python3 -m PyInstaller \
    --onedir \
    --name agent \
    --distpath "$OUTPUT_DIR" \
    --workpath "$PROJECT_ROOT/build-pyinstaller" \
    --specpath "$PROJECT_ROOT/build" \
    --noconfirm \
    --clean \
    --hidden-import "aiosqlite" \
    --hidden-import "uvicorn.logging" \
    --hidden-import "uvicorn.loops" \
    --hidden-import "uvicorn.loops.auto" \
    --hidden-import "uvicorn.protocols" \
    --hidden-import "uvicorn.protocols.http" \
    --hidden-import "uvicorn.protocols.http.auto" \
    --hidden-import "uvicorn.protocols.websockets" \
    --hidden-import "uvicorn.protocols.websockets.auto" \
    --hidden-import "uvicorn.lifespan" \
    --hidden-import "uvicorn.lifespan.on" \
    --hidden-import "fastapi" \
    --hidden-import "pydantic" \
    --hidden-import "websockets" \
    --hidden-import "aiohttp" \
    --hidden-import "httpx" \
    --hidden-import "anthropic" \
    --hidden-import "email_validator" \
    --hidden-import "anyio" \
    --hidden-import "starlette" \
    --add-data "$PROJECT_ROOT/agent/models.json:agent" \
    --collect-all "uvicorn" \
    --collect-all "fastapi" \
    --collect-all "starlette" \
    "build/agent_entry.py"

# Check output
BINARY="$OUTPUT_DIR/agent/agent"
if [ -f "$BINARY" ]; then
    echo ""
    echo "✅ Build successful!"
    echo "   Binary: $BINARY"
    echo "   Size: $(du -sh "$OUTPUT_DIR/agent" | cut -f1)"

    # Make executable
    chmod +x "$BINARY"

    # Quick sanity check
    echo ""
    echo "Testing binary..."
    timeout 3 "$BINARY" --help 2>/dev/null || true
    echo "Binary is executable ✓"
else
    echo ""
    echo "❌ Build FAILED: binary not found at $BINARY"
    exit 1
fi

# Clean up PyInstaller work files
rm -rf "$PROJECT_ROOT/build-pyinstaller"

echo ""
echo "=================================================="
echo "  macOS agent build complete!"
echo "  Output: $OUTPUT_DIR/agent/"
echo "=================================================="
