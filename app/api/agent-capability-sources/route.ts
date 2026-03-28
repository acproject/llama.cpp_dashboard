import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { OpenSourceCapabilityCatalogItem } from '@/types'

const AGENCY_ROOT = path.join(process.cwd(), 'docs', 'agency-agents')
const CLI_ANYTHING_ROOT = path.join(process.cwd(), 'docs', 'CLI-Anything')
const CLI_REGISTRY_PATH = path.join(CLI_ANYTHING_ROOT, 'registry.json')

type AgencyFrontmatter = {
  name?: string
  description?: string
  color?: string
  emoji?: string
  vibe?: string
  services: Array<{
    name: string
    url?: string
    tier?: string
  }>
}

type CliAnythingRegistry = {
  meta?: {
    repo?: string
    description?: string
    updated?: string
  }
  clis?: Array<{
    name?: string
    display_name?: string
    version?: string
    description?: string
    requires?: string | null
    homepage?: string | null
    install_cmd?: string
    entry_point?: string
    skill_md?: string | null
    category?: string
    contributor?: string
    contributor_url?: string
  }>
}

export async function GET() {
  try {
    const [agencyAgents, cliAnything] = await Promise.all([
      loadAgencyAgentCatalog(),
      loadCliAnythingCatalog(),
    ])
    const items = [...agencyAgents, ...cliAnything].sort((a, b) => {
      if (a.sourceType !== b.sourceType) {
        return a.sourceType.localeCompare(b.sourceType)
      }
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category)
      }
      return a.title.localeCompare(b.title)
    })

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: items.length,
        summary: {
          agencyAgents: agencyAgents.length,
          cliAnything: cliAnything.length,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

async function loadAgencyAgentCatalog(): Promise<OpenSourceCapabilityCatalogItem[]> {
  const files = await collectMarkdownFiles(AGENCY_ROOT)
  const items = await Promise.all(files.map((filePath) => loadAgencyAgentItem(filePath)))
  return items.filter((item): item is OpenSourceCapabilityCatalogItem => Boolean(item))
}

async function loadAgencyAgentItem(filePath: string): Promise<OpenSourceCapabilityCatalogItem | null> {
  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = parseAgencyFrontmatter(raw)
  if (!parsed.name || !parsed.description) return null

  const relativePath = path.relative(AGENCY_ROOT, filePath).replaceAll(path.sep, '/')
  const category = relativePath.split('/')[0] || 'specialized'
  const slug = relativePath.replace(/\.md$/i, '')
  const fileName = path.basename(slug)
  const keywordParts = fileName
    .split(/[-_]/)
    .map((part) => normalizeToken(part))
    .filter(Boolean)
  const serviceNames = parsed.services.map((service) => normalizeToken(service.name)).filter(Boolean)

  return {
    sourceType: 'agency-agent',
    slug,
    title: parsed.name,
    description: parsed.description,
    category,
    repoUrl: 'https://github.com/msitarzewski/agency-agents',
    docsPath: relativePath,
    capabilities: uniqueStrings([
      `agency:${category}`,
      ...keywordParts,
    ]),
    tools: uniqueStrings(serviceNames),
    promptExcerpt: extractPromptExcerpt(raw),
    metadata: {
      color: parsed.color,
      emoji: parsed.emoji,
      vibe: parsed.vibe,
      services: parsed.services,
    },
  }
}

async function loadCliAnythingCatalog(): Promise<OpenSourceCapabilityCatalogItem[]> {
  const raw = await fs.readFile(CLI_REGISTRY_PATH, 'utf8')
  const parsed = JSON.parse(raw) as CliAnythingRegistry
  const repoUrl = parsed.meta?.repo || 'https://github.com/HKUDS/CLI-Anything'

  return (parsed.clis || [])
    .filter((item) => item.name && item.display_name)
    .map((item) => {
      const name = item.name as string
      const displayName = item.display_name as string
      const category = item.category || 'general'
      const entryPoint = normalizeToken(item.entry_point)

      return {
        sourceType: 'cli-anything' as const,
        slug: name,
        title: displayName,
        description: item.description || undefined,
        category,
        repoUrl,
        homepage: item.homepage || undefined,
        docsPath: item.skill_md || undefined,
        capabilities: uniqueStrings([
          'cli',
          `cli:${category}`,
          normalizeToken(category),
          normalizeToken(name),
        ]),
        tools: uniqueStrings([
          normalizeToken(name),
          entryPoint,
        ]),
        metadata: {
          version: item.version,
          requires: item.requires || undefined,
          installCmd: item.install_cmd,
          entryPoint: item.entry_point,
          skillMd: item.skill_md || undefined,
          contributor: item.contributor,
          contributorUrl: item.contributor_url,
        },
      } satisfies OpenSourceCapabilityCatalogItem
    })
}

async function collectMarkdownFiles(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) return []
      return await collectMarkdownFiles(entryPath)
    }
    if (!entry.isFile()) return []
    if (!entry.name.endsWith('.md')) return []
    if (entry.name.toLowerCase() === 'readme.md') return []
    return [entryPath]
  }))

  return nested.flat()
}

function parseAgencyFrontmatter(content: string): AgencyFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  const frontmatter = match?.[1] || ''
  const lines = frontmatter.split('\n')
  const parsed: AgencyFrontmatter = { services: [] }
  let currentService: AgencyFrontmatter['services'][number] | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === 'services:') {
      currentService = null
      continue
    }

    if (trimmed.startsWith('- name:')) {
      currentService = {
        name: trimmed.slice('- name:'.length).trim(),
      }
      parsed.services.push(currentService)
      continue
    }

    if (currentService && trimmed.startsWith('url:')) {
      currentService.url = trimmed.slice('url:'.length).trim()
      continue
    }

    if (currentService && trimmed.startsWith('tier:')) {
      currentService.tier = trimmed.slice('tier:'.length).trim()
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key === 'name') parsed.name = value
    if (key === 'description') parsed.description = value
    if (key === 'color') parsed.color = value
    if (key === 'emoji') parsed.emoji = value
    if (key === 'vibe') parsed.vibe = value
  }

  return parsed
}

function extractPromptExcerpt(content: string): string | undefined {
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, '')
  const lines = withoutFrontmatter.split('\n')
  const excerptLines: string[] = []
  let collecting = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (collecting && excerptLines.length > 0) break
      continue
    }
    if (trimmed.startsWith('#')) {
      if (collecting && excerptLines.length > 0) break
      collecting = true
      continue
    }
    if (!collecting) continue
    if (trimmed.startsWith('```')) break
    excerptLines.push(trimmed)
    if (excerptLines.join(' ').length >= 280) break
  }

  const excerpt = excerptLines.join(' ').trim()
  return excerpt || undefined
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function normalizeToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || undefined
}
