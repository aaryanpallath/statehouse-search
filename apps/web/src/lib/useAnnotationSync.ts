'use client';
import { useEffect, useRef, useState } from 'react';
import type { ServerMessage } from '@statehouse/core/hub';

function wsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}:4000/ws`;
}

/**
 * Subscribes this tab to live annotation events for a bill over WebSocket, reconnecting with
 * exponential backoff. `onEvent` is called for annotation.created / annotation.deleted messages.
 */
export function useAnnotationSync(billId: string, onEvent: (msg: ServerMessage) => void): { connected: boolean; peers: number } {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        socket?.send(JSON.stringify({ type: 'subscribe', billId }));
      };
      socket.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === 'subscribed' || msg.type === 'presence') setPeers(msg.peers);
        else if (msg.type === 'annotation.created' || msg.type === 'annotation.deleted') handler.current(msg);
      };
      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [billId]);

  return { connected, peers };
}
