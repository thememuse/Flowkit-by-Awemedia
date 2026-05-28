# Flow Kit — Electron Desktop App

## 🖥️ Tổng quan

Flow Kit là ứng dụng desktop AI video production, kết hợp:
- **Python Agent** (FastAPI + SQLite) — Backend xử lý dữ liệu và queue
- **React Dashboard** — Giao diện quản lý projects, pipeline, gallery
- **Chrome Extension** — Bridge kết nối tới Google Flow API

---

## 📦 Cài đặt (End Users)

### macOS
1. Download `Flow Kit-x.x.x-arm64.dmg` (Apple Silicon) hoặc `Flow Kit-x.x.x-x64.dmg` (Intel)
2. Mở file DMG → kéo **Flow Kit** vào **Applications**
3. Mở Flow Kit từ Applications

**Lần đầu mở:**
- macOS có thể hiện cảnh báo "unidentified developer"
- Vào **System Preferences → Security & Privacy → Open Anyway**

### Windows
1. Download `Flow Kit Setup x.x.x.exe`
2. Chạy installer → Follow hướng dẫn
3. Launch từ Desktop shortcut hoặc Start Menu

---

## 🔧 Yêu cầu

### Tất cả platforms
- **Chrome** browser (để sử dụng Extension)
- Internet connection (để kết nối Google Flow)

### Nếu KHÔNG dùng bundled Python (dev mode)
- **Python 3.10+** — [python.org](https://www.python.org/downloads/)
- **ffmpeg** — macOS: `brew install ffmpeg` | Windows: [ffmpeg.org](https://ffmpeg.org/download.html)

---

## 🚀 Setup Chrome Extension

**Bắt buộc** — Chrome Extension là cầu nối để generate ảnh/video qua Google Flow.

1. Mở Chrome → vào `chrome://extensions`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked** → chọn thư mục `extension/` trong source code (hoặc download từ Releases)
4. Mở **Google Flow**: [labs.google/fx/tools/flow](https://labs.google/fx/tools/flow)
5. Đăng nhập tài khoản Google
6. Extension icon sẽ chuyển màu xanh → connected!

---

## 🛠️ Development Setup

### Prerequisites
```bash
# macOS
brew install node python@3.12 ffmpeg

# Windows (PowerShell as Admin)
winget install -e --id OpenJS.NodeJS
winget install -e --id Python.Python.3.12
```

### Install dependencies
```bash
# Root (Electron)
npm install

# Dashboard
cd dashboard && npm install && cd ..

# Python agent
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Run in development mode
```bash
# Method 1: Use npm scripts (recommended)
npm run dev

# Method 2: Manual
# Terminal 1: Start Vite dev server
cd dashboard && npm run dev

# Terminal 2: Start Python agent
python -m agent.main

# Terminal 3: Start Electron (after Vite is ready)
FLOWKIT_DEV=1 npx electron .
```

---

## 📦 Build Production App

### macOS (.dmg)
```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Build
npm run dist:mac

# Output: dist-electron/Flow Kit-x.x.x-arm64.dmg
```

### Windows (.exe installer)
```bash
# On Windows, or via GitHub Actions
npm run dist:win

# Output: dist-electron/Flow Kit Setup x.x.x.exe
```

### Build with bundled Python (recommended for distribution)
```bash
# macOS
bash build/build-python.sh
npm run dist:mac

# Windows  
build\build-python.bat
npm run dist:win
```

---

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                    Flow Kit Desktop App                      │
│                                                              │
│  ┌──────────────────┐    ┌─────────────────────────────┐   │
│  │  Main Process    │    │   Renderer (BrowserWindow)   │   │
│  │  electron/main   │IPC │                             │   │
│  │                  │◄──►│   React Dashboard UI        │   │
│  │  - Spawn Python  │    │   - Projects, Pipeline      │   │
│  │  - System tray   │    │   - Gallery, Logs           │   │
│  │  - App lifecycle │    │                             │   │
│  └──────────────────┘    └─────────────────────────────┘   │
│           │ spawn                    │ HTTP/WS               │
│           ▼                          ▼                       │
│  ┌──────────────────┐    ┌─────────────────────────────┐   │
│  │  Python Agent    │    │   :8100 REST + :8100/ws     │   │
│  │  FastAPI+SQLite  │◄───│   /ws/dashboard             │   │
│  │  :8100 + :9222   │    └─────────────────────────────┘   │
│  └──────────────────┘                                       │
│           │ WebSocket :9222                                  │
└───────────┼─────────────────────────────────────────────────┘
            │
     ┌──────▼──────┐
     │Chrome Ext   │ ← Load vào Chrome thủ công
     │(extension/) │ ← Cần Google Flow tab
     └─────────────┘
```

---

## 📁 Cấu trúc thư mục

```
flowkit/
├── agent/              # Python FastAPI backend
├── dashboard/          # React frontend  
├── extension/          # Chrome extension
├── electron/           # Electron main process
│   ├── main.js         # App lifecycle, BrowserWindow
│   ├── python-manager.js # Spawn & manage Python
│   ├── preload.js      # IPC bridge to renderer
│   └── tray.js         # System tray
├── build/              # Build scripts & config
│   ├── electron-builder.yml
│   ├── build-python.sh  # macOS PyInstaller
│   ├── build-python.bat # Windows PyInstaller
│   ├── agent_entry.py  # PyInstaller entry point
│   ├── entitlements.mac.plist
│   └── resources/      # App icons
├── resources/          # Bundled Python binary (after build)
│   ├── agent-mac/      # macOS binary
│   └── agent-win/      # Windows binary
├── package.json        # Root Electron config
└── README-ELECTRON.md  # This file
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLOWKIT_DEV` | `0` | Set to `1` for dev mode (loads Vite dev server) |
| `FLOW_AGENT_DIR` | `~/.flowkit` | Directory for DB + output files |
| `API_HOST` | `127.0.0.1` | Agent API host |
| `API_PORT` | `8100` | Agent API port |
| `ANTHROPIC_API_KEY` | | For AI video review feature |
| `SUNO_API_KEY` | | For music generation |

---

## 🐛 Troubleshooting

### "Python not found" error
- Install Python 3.10+: [python.org](https://www.python.org)
- Or use bundled version: `bash build/build-python.sh && npm run dist:mac`

### Extension not connecting
1. Make sure Chrome extension is loaded (chrome://extensions)
2. Make sure Google Flow tab is open and you're logged in
3. Check extension popup for connection status

### Agent won't start
- Check logs in System Tray → "Open Log File"
- Try "Restart Python Agent" from tray menu
- Verify port 8100 is not in use: `lsof -i :8100`

### Windows: "Windows protected your PC"
- Click "More info" → "Run anyway"
- Or right-click installer → Properties → Unblock
