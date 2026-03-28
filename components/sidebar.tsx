'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Activity, 
  Server, 
  Bug, 
  Settings, 
  Globe,
  LayoutDashboard,
  Bot,
  Route,
  Database,
  MessagesSquare
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { name: '总览', href: '/', icon: LayoutDashboard },
  { name: '聊天', href: '/chat', icon: MessagesSquare },
  { name: '服务监控', href: '/monitor', icon: Activity },
  { name: '服务管理', href: '/services', icon: Server },
  { name: '运行态', href: '/runs', icon: Route },
  { name: 'Agent注册', href: '/agents', icon: Bot },
  { name: 'RAG管理', href: '/rag', icon: Database },
  { name: '服务调试', href: '/debug', icon: Bug },
  { name: '调度配置', href: '/config', icon: Settings },
  { name: 'Nginx配置', href: '/nginx', icon: Globe },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-card border-r">
      <div className="flex h-16 items-center gap-2 px-6 border-b">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-sm">OW</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold">llama.cpp</h1>
          <p className="text-xs text-muted-foreground">Orchestrator Dashboard</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>
      <div className="border-t p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>MiniMemory: 6379</span>
        </div>
      </div>
    </div>
  )
}
