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

# ─── Step 2: Build Python Agent (optional, requires PyInstaller) ─
if [ -f "$SCRIPT_DIR/build-python.sh" ]; then
    read -p "Build Python agent binary with PyInstaller? [y/N] " yn
    if [[ "$yn" =~ ^[Yy]$ ]]; then
        echo ""
        echo "🐍 Building Python agent binary..."
        bash "$SCRIPT_DIR/build-python.sh"
    else
        echo "⚠️  Skipping Python binary build (will use system Python)"
    fi
fi

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
