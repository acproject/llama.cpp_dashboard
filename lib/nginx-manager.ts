import { NginxConfig, NginxUpstream, NginxUpstreamServer, LlamaService } from '@/types'
import { getJson, setJson, KEYS } from './minimemory'
import { writeFile, mkdir, open, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// Default Nginx configuration
const DEFAULT_NGINX_CONFIG: NginxConfig = {
  upstreams: [],
  replicaGroup: null,
  nodeProxyBase: process.env.DASHBOARD_PROXY_BASE || 'http://127.0.0.1:3000',
  serverPort: 8080,
  proxyTimeout: 300,
  proxyBufferSize: '128k',
}

/**
 * Get current Nginx configuration
 */
export async function getNginxConfig(): Promise<NginxConfig> {
  const config = await getJson<NginxConfig>(KEYS.NGINX_CONFIG)
  return { ...DEFAULT_NGINX_CONFIG, ...(config || {}) }
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
  const dashboardProxyBase = (
    config.nodeProxyBase ||
    process.env.DASHBOARD_PROXY_BASE ||
    'http://127.0.0.1:3000'
  ).replace(/\/+$/, '')
  
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
  lines.push('        client_body_buffer_size 10M;')
  lines.push(`        proxy_read_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_send_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_connect_timeout ${config.proxyTimeout}s;`)
  lines.push(`        proxy_buffer_size ${config.proxyBufferSize};`)
  lines.push(`        proxy_buffers 4 ${config.proxyBufferSize};`)
  lines.push('')
  
  lines.push('        rewrite ^/v1/v1/(.*)$ /v1/$1 break;')
  lines.push('        location = /v1/models {')
  lines.push(`            proxy_pass ${dashboardProxyBase}/api/openai/models;`)
  lines.push('            proxy_http_version 1.1;')
  lines.push('            proxy_set_header Host $host;')
  lines.push('            proxy_set_header X-Real-IP $remote_addr;')
  lines.push('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
  lines.push('            proxy_set_header X-Forwarded-Proto $scheme;')
  lines.push('            set $auth_header $http_authorization;')
  lines.push('            if ($auth_header = "") {')
  lines.push('                set $auth_header "Bearer $http_api_key";')
  lines.push('            }')
  lines.push('            proxy_set_header Authorization $auth_header;')
  lines.push('            proxy_set_header api-key $http_api_key;')
  lines.push('        }')
  lines.push('        location ^~ /v1/ {')
  lines.push(`            proxy_pass ${dashboardProxyBase}/api/openai/v1/;`)
  lines.push('            proxy_http_version 1.1;')
  lines.push('            proxy_set_header Host $host;')
  lines.push('            proxy_set_header X-Real-IP $remote_addr;')
  lines.push('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
  lines.push('            proxy_set_header X-Forwarded-Proto $scheme;')
  lines.push('            set $auth_header $http_authorization;')
  lines.push('            if ($auth_header = "") {')
  lines.push('                set $auth_header "Bearer $http_api_key";')
  lines.push('            }')
  lines.push('            proxy_set_header Authorization $auth_header;')
  lines.push('            proxy_set_header api-key $http_api_key;')
  lines.push('            proxy_request_buffering off;')
  lines.push('            proxy_buffering off;')
  lines.push('            proxy_cache off;')
  lines.push('            proxy_set_header X-Accel-Buffering no;')
  lines.push('        }')
  lines.push('        location / {')
  lines.push(`            proxy_pass ${dashboardProxyBase};`)
  lines.push('            proxy_http_version 1.1;')
  lines.push('            proxy_set_header Host $host;')
  lines.push('            proxy_set_header X-Real-IP $remote_addr;')
  lines.push('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
  lines.push('            proxy_set_header X-Forwarded-Proto $scheme;')
  lines.push('            proxy_set_header Connection "";')
  lines.push('            set $auth_header $http_authorization;')
  lines.push('            if ($auth_header = "") {')
  lines.push('                set $auth_header "Bearer $http_api_key";')
  lines.push('            }')
  lines.push('            proxy_set_header Authorization $auth_header;')
  lines.push('            proxy_set_header api-key $http_api_key;')
  lines.push('            proxy_request_buffering off;')
  lines.push('            proxy_buffering off;')
  lines.push('            proxy_cache off;')
  lines.push('            proxy_set_header X-Accel-Buffering no;')
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

export interface WriteNginxFilesResult {
  nginxConfPath: string
  servicesSnapshotPath: string
}

export interface ReadNginxLogResult {
  logPath: string
  content: string
}

export async function readNginxLog(
  type: 'access' | 'error',
  lines: number
): Promise<ReadNginxLogResult> {
  const logPath =
    type === 'access'
      ? (process.env.NGINX_ACCESS_LOG_PATH || '/var/log/nginx/access.log')
      : (process.env.NGINX_ERROR_LOG_PATH || '/var/log/nginx/error.log')

  const maxLines = Number.isFinite(lines) ? Math.max(1, Math.min(2000, Math.floor(lines))) : 200
  const fh = await open(logPath, 'r')
  try {
    const stat = await fh.stat()
    const size = stat.size
    const maxBytes = 512 * 1024
    const start = Math.max(0, size - maxBytes)
    const readLen = size - start
    const buf = Buffer.alloc(readLen)
    await fh.read(buf, 0, readLen, start)
    const text = buf.toString('utf8')
    const all = text.split('\n')
    const tail = all.slice(Math.max(0, all.length - maxLines)).join('\n')
    return { logPath, content: tail }
  } finally {
    await fh.close()
  }
}

export interface SudoExecResult {
  command: string
  args: string[]
  exitCode: number | null
  stdout: string
  stderr: string
}

function isAllowedNginxTargetPath(targetPath: string): boolean {
  if (!targetPath.startsWith('/etc/nginx/')) return false
  return /^\/etc\/nginx\/(sites-enabled|sites-available|conf\.d)\/[A-Za-z0-9._-]+$/.test(targetPath)
}

async function runSudo(password: string, command: string, args: string[]): Promise<SudoExecResult> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-S', '-p', '', command, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('close', (code) => {
      resolve({
        command,
        args,
        exitCode: code,
        stdout,
        stderr,
      })
    })

    child.stdin.write(`${password}\n`)
    child.stdin.end()
  })
}

export interface ApplySystemNginxResult {
  targetPath: string
  installed: SudoExecResult
  test: SudoExecResult
  reload: SudoExecResult
}

export async function applySystemNginxConfig(
  sudoPassword: string,
  config: NginxConfig,
  targetPath?: string
): Promise<ApplySystemNginxResult> {
  const resolvedTargetPath =
    targetPath ||
    process.env.NGINX_SYSTEM_SITE_PATH ||
    '/etc/nginx/sites-enabled/llama-orchestrator'

  if (!isAllowedNginxTargetPath(resolvedTargetPath)) {
    throw new Error('Invalid targetPath')
  }

  const tmpPath = path.join(os.tmpdir(), `llama-orchestrator-${randomUUID()}.conf`)
  const content = generateNginxConfig(config)
  await writeFile(tmpPath, content, 'utf8')

  try {
    const installed = await runSudo(sudoPassword, 'install', ['-m', '0644', tmpPath, resolvedTargetPath])
    if (installed.exitCode !== 0) {
      return {
        targetPath: resolvedTargetPath,
        installed,
        test: { command: 'nginx', args: ['-t'], exitCode: null, stdout: '', stderr: '' },
        reload: { command: 'nginx', args: ['-s', 'reload'], exitCode: null, stdout: '', stderr: '' },
      }
    }

    const test = await runSudo(sudoPassword, 'nginx', ['-t'])
    if (test.exitCode !== 0) {
      return { targetPath: resolvedTargetPath, installed, test, reload: { command: 'nginx', args: ['-s', 'reload'], exitCode: null, stdout: '', stderr: '' } }
    }

    const reload = await runSudo(sudoPassword, 'nginx', ['-s', 'reload'])
    return { targetPath: resolvedTargetPath, installed, test, reload }
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

export async function writeNginxFiles(
  config: NginxConfig,
  services: LlamaService[]
): Promise<WriteNginxFilesResult> {
  const projectNginxDir = path.join(process.cwd(), 'nginx')
  await mkdir(projectNginxDir, { recursive: true })

  const nginxConfPath = process.env.NGINX_CONF_PATH || path.join(projectNginxDir, 'nginx.conf')
  const servicesSnapshotPath = process.env.NGINX_SERVICES_PATH || path.join(projectNginxDir, 'synced-services.json')

  const nginxConf = generateNginxConfig(config)
  await writeFile(nginxConfPath, nginxConf, 'utf8')

  const snapshot = {
    updatedAt: Date.now(),
    serverPort: config.serverPort,
    services: services.map(s => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      weight: s.weight,
      status: s.status,
      enabled: s.enabled !== false,
      model: s.model,
    })),
  }
  await writeFile(servicesSnapshotPath, JSON.stringify(snapshot, null, 2), 'utf8')

  return { nginxConfPath, servicesSnapshotPath }
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
  
  const eligible = services.filter(s => s.status === 'online' && s.enabled !== false)
  const stableEligible = [...eligible].sort((a, b) => (a.id || '').localeCompare(b.id || ''))

  const group = (config.replicaGroup || '').trim()
  let upstreamServices: LlamaService[] = []

  if (group) {
    upstreamServices = stableEligible.filter(s => (s.replicaGroup || '').trim() === group)
  } else {
    const primaries = stableEligible.filter(s => Boolean(s.primaryReplica))
    upstreamServices = (primaries[0] ? [primaries[0]] : (stableEligible[0] ? [stableEligible[0]] : []))
  }

  const existing = config.upstreams.find(u => u.name === 'llama_backend')
  const lb = existing?.loadBalancingMethod || 'round-robin'
  const defaultUpstream = createUpstreamFromServices('llama_backend', upstreamServices, lb)
  
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
