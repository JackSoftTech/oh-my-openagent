import { type Dirent, promises as fs } from "fs"
import { join } from "path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../shared/frontmatter"
import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import { getClaudeConfigDir } from "../shared/claude-config-dir"
import type { AgentCategory, AgentCost, DelegationTrigger, AgentPromptMetadata } from "./types"

export const MARKDOWN_AGENT_FILENAME = "AGENT.md"

/**
 * Frontmatter schema for markdown-defined agents.
 * Users create <name>/AGENT.md directories with YAML frontmatter to define agent configuration.
 */
export interface AgentMarkdownConfig {
  /** Agent name (required) */
  name: string
  /** Agent mode: primary, subagent, or all */
  mode?: "primary" | "subagent" | "all"
  /** Category for grouping in prompt sections */
  category?: AgentCategory
  /** Cost classification for Tool Selection table */
  cost?: AgentCost
  /** Domain triggers for Delegation Table */
  triggers?: DelegationTrigger[]
  /** When to use this agent */
  useWhen?: string[]
  /** When NOT to use this agent */
  avoidWhen?: string[]
  /** Key triggers that should appear in Phase 0 */
  keyTrigger?: string
  /** Nickname/alias used in prompt */
  promptAlias?: string
  /** Dedicated prompt section */
  dedicatedSection?: string
  /** Agent description */
  description?: string
  /** Model override */
  model?: string
  /** Temperature setting */
  temperature?: number
  /** Fallback models */
  fallback_models?: string | string[]
  /** Tools to restrict */
  tools?: string[]
  /** Variant name */
  variant?: string
}

/**
 * Parsed markdown agent with metadata and body content
 */
export interface MarkdownAgentSource {
  name: string
  description: string
  config: AgentMarkdownConfig
  instructions: string
  filePath: string
  metadata?: AgentPromptMetadata
}

/**
 * Discover all markdown-defined agents from standard locations
 */
export async function discoverMarkdownAgents(directory?: string): Promise<MarkdownAgentSource[]> {
  const [
    opencodeProjectAgents,
    opencodeGlobalAgents,
    projectAgents,
    userAgents,
  ] = await Promise.all([
    discoverMarkdownAgentsInDir(join(directory ?? process.cwd(), ".opencode", "agents")),
    discoverMarkdownAgentsInDir(join(getOpenCodeConfigDir({ binary: "opencode" }), "agents")),
    discoverMarkdownAgentsInDir(join(directory ?? process.cwd(), ".claude", "agents")),
    discoverMarkdownAgentsInDir(join(getClaudeConfigDir(), "agents")),
  ])

  // Priority: opencode-project > opencode > project > user
  return [...opencodeProjectAgents, ...opencodeGlobalAgents, ...projectAgents, ...userAgents]
}

/**
 * Discover markdown agents in a specific directory
 */
async function discoverMarkdownAgentsInDir(agentsDir: string): Promise<MarkdownAgentSource[]> {
  const agents: MarkdownAgentSource[] = []

  let dirEntries: Dirent[]
  try {
    dirEntries = await fs.readdir(agentsDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) {
      continue
    }

    const filePath = join(agentsDir, entry.name, MARKDOWN_AGENT_FILENAME)
    const agent = await parseMarkdownAgentFromPath(filePath)
    if (agent) {
      agents.push(agent)
    }
  }

  return agents
}

/**
 * Parse a markdown agent file from a specific path
 */
async function parseMarkdownAgentFromPath(filePath: string): Promise<MarkdownAgentSource | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8")
    return parseMarkdownAgent(content, filePath)
  } catch {
    return null
  }
}

/**
 * Parse markdown agent content (frontmatter + body)
 */
export function parseMarkdownAgent(content: string, filePath: string): MarkdownAgentSource | null {
  const { data, body } = parseFrontmatter<AgentMarkdownConfig>(content)

  if (!data.name) {
    return null
  }

  const instructions = body.trim()
  const config = data

  // Build metadata if applicable
  let metadata: AgentPromptMetadata | undefined
  if (config.category || config.cost || config.triggers || config.useWhen || config.avoidWhen || config.keyTrigger || config.dedicatedSection) {
    metadata = {
      category: config.category ?? "specialist",
      cost: config.cost ?? "EXPENSIVE",
      triggers: config.triggers ?? [],
      useWhen: config.useWhen,
      avoidWhen: config.avoidWhen,
      keyTrigger: config.keyTrigger,
      dedicatedSection: config.dedicatedSection,
      promptAlias: config.promptAlias,
    }
  }

  return {
    name: data.name,
    description: data.description ?? `Custom agent: ${data.name}`,
    config,
    instructions,
    filePath,
    metadata,
  }
}

/**
 * Convert a markdown agent source to an AgentConfig
 */
export function convertMarkdownToAgentConfig(
  source: MarkdownAgentSource,
  defaultModel: string
): AgentConfig {
  const { config, instructions, metadata } = source

  // Build tool restrictions if tools are specified
  const restrictions: Record<string, boolean> = {}
  if (config.tools) {
    for (const tool of config.tools) {
      restrictions[tool] = false // false = denied
    }
  }

  const agentConfig: AgentConfig = {
    description: config.description ?? source.description,
    model: config.model ?? defaultModel,
    temperature: config.temperature ?? 0.1,
    prompt: instructions,
    // If mode is not specified, default to "subagent" for custom agents
    mode: config.mode ?? "subagent",
  }

  // Add restrictions if specified
  if (Object.keys(restrictions).length > 0) {
    agentConfig.tools = restrictions
  }

  // Add fallback_models if specified
  if (config.fallback_models) {
    agentConfig.fallback_models = Array.isArray(config.fallback_models)
      ? config.fallback_models
      : [config.fallback_models]
  }

  // Store metadata for prompt generation (used by Sisyphus)
  if (metadata) {
    // Store in an internal property - this won't be sent to the model
    // but can be accessed by the agent builder
    ;(agentConfig as Record<string, unknown>).promptMetadata = metadata
  }

  return agentConfig
}

/**
 * Load all markdown agents and convert to AgentConfig map
 */
export async function loadMarkdownAgents(
  directory?: string,
  defaultModel: string = "claude-sonnet-4-6"
): Promise<Record<string, AgentConfig>> {
  const sources = await discoverMarkdownAgents(directory)
  const result: Record<string, AgentConfig> = {}

  for (const source of sources) {
    const config = convertMarkdownToAgentConfig(source, defaultModel)
    result[source.name] = config
  }

  return result
}
