import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'online':
      return 'text-green-500'
    case 'offline':
      return 'text-gray-500'
    case 'starting':
    case 'stopping':
      return 'text-yellow-500'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-gray-500'
  }
}

export function getStatusBgColor(status: string): string {
  switch (status) {
    case 'online':
      return 'bg-green-500'
    case 'offline':
      return 'bg-gray-500'
    case 'starting':
    case 'stopping':
      return 'bg-yellow-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-gray-500'
  }
}
