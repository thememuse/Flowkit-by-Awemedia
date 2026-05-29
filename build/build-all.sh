#!/usr/bin/env bash
# ============================================================
# build/build-all.sh — Full build: dashboard + electron package
# Usage: ./build/build-all.sh [mac|win|all]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TARGET="${1:-mac}"

echo "=================================================="
echo "  Flow Kit — Full Build ($TARGET)"
echo "=================================================="
echo ""

# ─── Step 1: Build React Dashboard ──────────────────────────
echo "📦 Building React dashboard..."
cd "$PROJECT_ROOT/dashboard"
BUILD_TARGET=electron npm run build
echo "   Dashboard built → dashboard/dist/"

# ─── Step 2: Build Python Agent (required so packaged app does not use stale bundled code) ─
echo ""
echo "🐍 Building Python agent binary..."
case "$TARGET" in
    mac)
        node "$SCRIPT_DIR/build-agent.js" mac
        ;;
    win)
        node "$SCRIPT_DIR/build-agent.js" win
        ;;
    all)
        node "$SCRIPT_DIR/build-agent.js" all
        ;;
esac

# ─── Step 3: Package with electron-builder ──────────────────
echo ""
echo "🔨 Packaging Electron app..."
cd "$PROJECT_ROOT"

case "$TARGET" in
    mac)
        npx electron-builder --mac
        ;;
    win)
        npx electron-builder --win
        ;;
    all)
        npx electron-builder --mac --win
        ;;
    *)
        echo "Unknown target: $TARGET (use mac, win, or all)"
        exit 1
        ;;
esac

echo ""
echo "=================================================="
echo "  Build complete! → dist-electron/"
echo "=================================================="
ls -la "$PROJECT_ROOT/dist-electron/" 2>/dev/null || true
