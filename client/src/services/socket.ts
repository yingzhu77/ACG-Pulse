import { io, Socket } from 'socket.io-client';
import type { FeedItem } from './api';

let socket: Socket | null = null;
let connecting = false;

/** 获取 socket 实例（不自动连接） */
export function getSocket(): Socket | null {
  return socket;
}

/** 延迟建立连接，仅在需要时调用 */
export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (!socket && !connecting) {
    connecting = true;
    socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });
    socket.on('disconnect', () => { connecting = false; });
  }
  return socket!;
}

export function subscribeToGames(games: string[]): void {
  const s = connectSocket();
  if (s.connected) {
    s.emit('subscribe:games', games);
  } else {
    s.once('connect', () => s.emit('subscribe:games', games));
  }
}

export function onNewItem(callback: (item: FeedItem) => void): () => void {
  const s = connectSocket();
  s.on('item:new', callback);
  return () => s.off('item:new', callback);
}

export function onNotification(callback: (notification: { title: string; content: string; importance?: string }) => void): () => void {
  const s = connectSocket();
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

export function onCommunityUpdate(callback: (data: { totalTopics: number; timestamp: string }) => void): () => void {
  const s = connectSocket();
  s.on('community:update', callback);
  return () => s.off('community:update', callback);
}
