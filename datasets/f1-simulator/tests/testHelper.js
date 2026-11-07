/**
 * testHelper.js
 * Cross-platform utilities for running headless Chrome and E2E browser tests
 * in local environments (Windows, macOS, Linux) and CI/CD pipelines (GitHub Actions).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'google-chrome';
}

export function getTempProfileDir(prefix = 'chrome-e2e') {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

export async function connectToChromePage(debugPort, targetUrlSubstring = '', maxRetries = 35) {
  let wsUrl = '';
  let pageTab = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (resp.ok) {
        const tabs = await resp.json();
        pageTab = tabs.find(t =>
          t.type === 'page' &&
          (!targetUrlSubstring || (t.url && t.url.includes(targetUrlSubstring)))
        );
        if (!pageTab && !targetUrlSubstring) {
          pageTab = tabs.find(t => t.type === 'page');
        }
        if (pageTab?.webSocketDebuggerUrl) {
          wsUrl = pageTab.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (_) {
      // Chrome remote debugging port not responding yet
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!pageTab || !wsUrl) {
    throw new Error(`Failed to connect to headless Chrome page on port ${debugPort} after ${maxRetries} attempts`);
  }

  const WebSocket = (await import('ws')).default;
  let cleanWsUrl = wsUrl;
  if (cleanWsUrl.includes('//localhost:')) {
    cleanWsUrl = cleanWsUrl.replace('//localhost:', '//127.0.0.1:');
  }
  const ws = new WebSocket(cleanWsUrl);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  // Enable Runtime domain to query readyState
  await new Promise((resolve) => {
    const id = 999901;
    const onMsg = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', onMsg);
          resolve();
        }
      } catch (_) {}
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.enable' }));
    setTimeout(() => {
      ws.off('message', onMsg);
      resolve();
    }, 500);
  });

  // Wait for DOM readyState to be interactive or complete
  for (let i = 0; i < 40; i++) {
    try {
      const readyState = await new Promise((resolve, reject) => {
        const checkId = 999910 + i;
        const onMsg = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.id === checkId) {
              ws.off('message', onMsg);
              if (msg.error) reject(msg.error);
              else resolve(msg.result?.result?.value);
            }
          } catch (_) {}
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({
          id: checkId,
          method: 'Runtime.evaluate',
          params: { expression: 'document.readyState', returnByValue: true }
        }));
        setTimeout(() => {
          ws.off('message', onMsg);
          resolve(null);
        }, 500);
      });

      if (readyState === 'complete' || readyState === 'interactive') {
        break;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }

  ws.pageTab = pageTab;
  ws.ws = ws;
  return ws;
}
