import { useState, useEffect, useRef, useCallback } from 'react'
import type { WSEvent } from '../types'

/**
 * WebSocket hook — connects to the Flow Kit agent dashboard WS endpoint.
 *
 * In Electron: connects to ws://127.0.0.1:8100/ws/dashboard
 * In browser dev: connects relative to window.location.host (proxied by Vite)
 */

const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;

function getWsUrl(): string {
  if (isElectron) {
    return 'ws://127.0.0.1:8100/ws/dashboard';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/dashboard`;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const unmountedRef = useRef(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [backendHealthy, setBackendHealthy] = useState(false)

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
    }

    const url = getWsUrl();
    let ws: WebSocket;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.error('WebSocket creation failed:', e);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setIsConnected(true);
      retriesRef.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        setLastEvent(event);
        // Dispatch CustomEvent to window so standard event listeners receive it
        if (event && event.type) {
          window.dispatchEvent(new CustomEvent(event.type, { detail: event }));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setIsConnected(false);
      wsRef.current = null;
      
      // Do not try to reconnect if backend is not healthy
      if (!backendHealthy) return;

      const delay = Math.min(1000 * 2 ** retriesRef.current, 15000);
      retriesRef.current++;
      
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [backendHealthy]);

  // Monitor Python Agent status
  useEffect(() => {
    unmountedRef.current = false;

    if (isElectron && window.electronAPI) {
      const api = window.electronAPI;
      
      // Get initial healthy state
      api.getPythonStatus().then((s) => {
        if (unmountedRef.current) return;
        setBackendHealthy(s.healthy);
      });

      const unsubStatus = api.onPythonStatusChange((s) => {
        if (unmountedRef.current) return;
        setBackendHealthy(s.healthy);
      });

      const unsubReady = api.onPythonReady(() => {
        if (unmountedRef.current) return;
        setBackendHealthy(true);
      });

      const unsubError = api.onPythonError(() => {
        if (unmountedRef.current) return;
        setBackendHealthy(false);
      });

      return () => {
        unmountedRef.current = true;
        unsubStatus();
        unsubReady();
        unsubError();
        if (wsRef.current) {
          wsRef.current.close();
        }
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      };
    } else {
      // Browser fallback: check via relative endpoint
      let browserPollInterval: ReturnType<typeof setInterval>;
      
      const checkBrowserHealth = async () => {
        try {
          const res = await fetch('/health');
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
              setBackendHealthy(true);
              return;
            }
          }
          setBackendHealthy(false);
        } catch (e) {
          setBackendHealthy(false);
        }
      };

      checkBrowserHealth();
      browserPollInterval = setInterval(checkBrowserHealth, 5000);

      return () => {
        unmountedRef.current = true;
        clearInterval(browserPollInterval);
        if (wsRef.current) {
          wsRef.current.close();
        }
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, []);

  // Connect / disconnect on health changes
  useEffect(() => {
    if (backendHealthy) {
      connect();
    } else {
      setIsConnected(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
  }, [backendHealthy, connect]);

  return { isConnected, lastEvent };
}
