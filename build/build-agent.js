#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] || 'current';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function buildMac() {
  if (process.platform !== 'darwin') {
    throw new Error('Cannot build macOS agent on this OS. Run this on macOS.');
  }
  run('bash', ['build/build-python.sh']);
}

function buildWin() {
  if (process.platform !== 'win32') {
    throw new Error('Cannot build Windows agent on this OS. Run this on Windows.');
  }
  run('build\\build-python.bat', []);
}

try {
  if (target === 'current') {
    if (process.platform === 'darwin') buildMac();
    else if (process.platform === 'win32') buildWin();
    else throw new Error(`No bundled agent build script for platform ${process.platform}.`);
  } else if (target === 'mac') {
    buildMac();
  } else if (target === 'win') {
    buildWin();
  } else if (target === 'all') {
    throw new Error('Agent binaries are platform-native. Build mac on macOS and win on Windows separately.');
  } else {
    throw new Error(`Unknown agent build target: ${target}`);
  }

  const output = process.platform === 'darwin'
    ? path.join(root, 'resources', 'agent-mac', 'agent', 'agent')
    : path.join(root, 'resources', 'agent-win', 'agent', 'agent.exe');
  if (!fs.existsSync(output)) {
    throw new Error(`Agent build did not produce expected binary: ${output}`);
  }
} catch (error) {
  console.error(`[build-agent] ${error.message}`);
  process.exit(1);
}
