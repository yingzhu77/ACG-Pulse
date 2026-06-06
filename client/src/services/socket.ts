import { io, Socket } from 'socket.io-client';
import type { FeedItem } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });
  }
  return socket;
}

export function subscribeToGames(games: string[]): void {
  getSocket().emit('subscribe:games', games);
}

export function onNewItem(callback: (item: FeedItem) => void): () => void {
  const s = getSocket();
  s.on('item:new', callback);
  return () => s.off('item:new', callback);
}

export function onNotification(callback: (notification: { title: string; content: string; importance?: string }) => void): () => void {
  const s = getSocket();
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

export interface ReanalyzeProgress {
  total: number;
  analyzed: number;
  failed: number;
  percent: number;
}

export function onReanalyzeProgress(callback: (progress: ReanalyzeProgress) => void): () => void {
  const s = getSocket();
  s.on('reanalyze:progress', callback);
  return () => s.off('reanalyze:progress', callback);
}

export function onReanalyzeDone(callback: (result: { total: number; analyzed: number; failed: number }) => void): () => void {
  const s = getSocket();
  s.on('reanalyze:done', callback);
  return () => s.off('reanalyze:done', callback);
}

export function onReanalyzeError(callback: (error: { error: string }) => void): () => void {
  const s = getSocket();
  s.on('reanalyze:error', callback);
  return () => s.off('reanalyze:error', callback);
}
