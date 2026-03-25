import { NginxConfig, NginxUpstream, NginxUpstreamServer, LlamaService } from '@/types'
import { getJson, setJson, KEYS } from './minimemory'

// Default Nginx configuration
const DEFAULT_NGINX_CONFIG: NginxConfig = {
  upstreams: [],
  serverPort: 8080,
  proxyTimeout: 300,
  proxyBufferSize: '128k',
}

/**
 * Get current Nginx configuration
 */
export async function getNginxConfig(): Promise<NginxConfig> {
  const config = await getJson<NginxConfig>(KEYS.NGINX_CONFIG)
  return config || DEFAULT_NGINX_CONFIG
}

/**
 * Update Nginx configuration
 */
export async function setNginxConfig(config: Partial<NginxConfig>): Promise<NginxConfig> {
  const current = await getNginxConfig()
  const updated = { ...current, ...config }
  await setJson(KEYS.NGINX_CONFIG, updated)
  return updated
}

/**
 * Generate nginx.conf content from configuration
 */
export function generateNginxConfig(config: NginxConfig): string {
  const lines: string[] = []
  
  // Worker processes
  lines.push('worker_processes auto;')
  lines.push('error_log /var/log/nginx/error.log warn;')
  lines.push('pid /var/run/nginx.pid;')
  lines.push('')
  
  // Events block
  lines.push('events {')
  lines.push('    worker_connections 1024;')
  lines.push('    use epoll;')
  lines.push('    multi_accept on;')
  lines.push('}')
  lines.push('')
  
  // HTTP block
  lines.push('http {')
  lines.push('    include /etc/nginx/mime.types;')
  lines.push('    default_type application/octet-stream;')
  lines.push('    log_format main \'$remote_addr - $remote_user [$time_local] "$request" \'')
  lines.push('                      \'$status $body_bytes_sent "$http_referer" \'')
  lines.push('                      \'"$http_user_agent" "$http_x_forwarded_for"\';')
  lines.push('    access_log /var/log/nginx/access.log main;')
  lines.push('    sendfile on;')
  lines.push('    tcp_nopush on;')
  lines.push('    tcp_nodelay on;')
  lines.push('    keepalive_timeout 65;')
  lines.push('    types_hash_max_size 2048;')
  lines.push('')
  
  // Upstreams
  for (const upstream of config.upstreams) {
    lines.push(`    upstream ${upstream.name} {`)
    
    // Load balancing method
    switch (upstream.loadBalancingMethod) {
      case 'least-conn':
        lines.push('        least_conn;')
        break
      case 'ip-hash':
        lines.push('        ip_hash;')
        break
      // round-robin is default, no directive needed
    }
    
    if (upstream.keepalive) {
      lines.push(`        keepalive ${upstream.keepalive};`)
    }
    
    // Servers
    for (const server of upstream.servers) {
      let serverLine = `        server ${server.host}:${server.port}`
      const params: string[] = []
      
      if (server.weight !== 1) {
        params.push(`weight=${server.weight}`)
      }
      if (server.maxFails) {
        params.push(`max_fails=${server.maxFails}`)
      }
      if (server.failTimeout) {
        params.push(`fail_timeout=${server.failTimeout}`)
      }
      if (server.backup) {
        params.push('backup')
      }
      
      if (params.length > 0) {
        serverLine += ' ' + params.join(' ')
      }
      serverLine += ';'
      lines.push(serverLine)
    }
    
    lines.push('    }')
    lines.push('')
  }
  
  // Server block
  lines.push('    server {')
  lines.push(`        listen ${config.serverPort};`)
  lines.push('        server_name _;')
  lines.push('')
  
  // Client settings
  lines.push(`        client_max_body_size 100M;`)
  lines.push(`        proxy_read_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_send_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_connect_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_buffer_size ${config.proxyBufferSize};`)
  lines.push(`        proxy_buffers 4 ${config.proxyBufferSize};`)
  lines.push('')
  
  // Default location - route to first upstream or llama_backend
  const defaultUpstream = config.upstreams[0]?.name || 'llama_backend'
  lines.push('        location / {')
  lines.push(`            proxy_pass http://${defaultUpstream};`)
  lines.push('            proxy_http_version 1.1;')
  lines.push('            proxy_set_header Host $host;')
  lines.push('            proxy_set_header X-Real-IP $remote_addr;')
  lines.push('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
  lines.push('            proxy_set_header X-Forwarded-Proto $scheme;')
  lines.push('            proxy_set_header Connection "";')
  lines.push('        }')
  lines.push('')
  
  // Health check endpoint
  lines.push('        location /nginx-health {')
  lines.push('            return 200 "healthy\\n";')
  lines.push('            add_header Content-Type text/plain;')
  lines.push('        }')
  
  // Additional config
  if (config.additionalConfig) {
    lines.push('')
    lines.push('        ' + config.additionalConfig.split('\n').join('\n        '))
  }
  
  lines.push('    }')
  lines.push('}')
  
  return lines.join('\n')
}

/**
 * Create upstream configuration from services
 */
export function createUpstreamFromServices(
  name: string,
  services: LlamaService[],
  loadBalancingMethod: 'round-robin' | 'least-conn' | 'ip-hash' = 'round-robin'
): NginxUpstream {
  const servers: NginxUpstreamServer[] = services.map(service => ({
    serviceId: service.id,
    host: service.host,
    port: service.port,
    weight: service.weight,
    maxFails: 3,
    failTimeout: '30s',
  }))
  
  return {
    name,
    servers,
    loadBalancingMethod,
    keepalive: 32,
  }
}

/**
 * Sync services to Nginx upstream configuration
 */
export async function syncServicesToNginx(
  services: LlamaService[]
): Promise<NginxConfig> {
  const config = await getNginxConfig()
  
  // Create default upstream from all online services
  const onlineServices = services.filter(s => s.status === 'online')
  const defaultUpstream = createUpstreamFromServices('llama_backend', onlineServices)
  
  // Update or add upstream
  const existingIndex = config.upstreams.findIndex(u => u.name === 'llama_backend')
  if (existingIndex >= 0) {
    config.upstreams[existingIndex] = defaultUpstream
  } else {
    config.upstreams.push(defaultUpstream)
  }
  
  // Save configuration
  await setNginxConfig(config)
  
  return config
}

/**
 * Save configuration backup
 */
export async function saveBackup(config: NginxConfig): Promise<string> {
  const backupId = `backup-${Date.now()}`
  await setJson(KEYS.NGINX_BACKUP(backupId), config)
  return backupId
}

/**
 * Validate Nginx configuration (syntax check)
 */
export function validateNginxConfig(configContent: string): { valid: boolean; error?: string } {
  // Basic validation
  if (!configContent.includes('worker_processes')) {
    return { valid: false, error: 'Missing worker_processes directive' }
  }
  if (!configContent.includes('events {')) {
    return { valid: false, error: 'Missing events block' }
  }
  if (!configContent.includes('http {')) {
    return { valid: false, error: 'Missing http block' }
  }
  if (!configContent.includes('server {')) {
    return { valid: false, error: 'Missing server block' }
  }
  
  // Check for balanced braces
  let braceCount = 0
  for (const char of configContent) {
    if (char === '{') braceCount++
    if (char === '}') braceCount--
    if (braceCount < 0) {
      return { valid: false, error: 'Unbalanced braces' }
    }
  }
  if (braceCount !== 0) {
    return { valid: false, error: 'Unbalanced braces' }
  }
  
  return { valid: true }
}
