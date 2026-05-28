"""
build/agent_entry.py — PyInstaller entry point for the Flow Kit Python agent.

This file is used by PyInstaller as the entry point instead of agent/main.py
because PyInstaller needs a single-file entry point without package discovery.
"""
import sys
import os

# Ensure the agent package can be found when running as a bundle
if getattr(sys, 'frozen', False):
    # Running as PyInstaller bundle
    bundle_dir = sys._MEIPASS
    sys.path.insert(0, bundle_dir)

    # Set up data directory from environment (set by Electron)
    data_dir = os.environ.get('FLOW_AGENT_DIR', os.path.join(os.path.expanduser('~'), '.flowkit'))
    os.makedirs(data_dir, exist_ok=True)
    os.environ.setdefault('FLOW_AGENT_DIR', data_dir)

import uvicorn
from agent.main import app
from agent.config import API_HOST, API_PORT

if __name__ == '__main__':
    uvicorn.run(
        app,
        host=API_HOST,
        port=API_PORT,
        log_level='info',
        # Don't use reload in bundled mode
        reload=False,
    )
