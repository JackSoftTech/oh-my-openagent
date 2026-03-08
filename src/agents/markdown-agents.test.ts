import { describe, test, expect } from "bun:test"
import { parseMarkdownAgent, convertMarkdownToAgentConfig, type MarkdownAgentSource } from "./markdown-agents"

describe("parseMarkdownAgent", () => {
  test("parses valid markdown with frontmatter", () => {
    const content = `---
name: my-agent
mode: subagent
category: specialist
description: My custom agent
model: claude-sonnet-4-6
temperature: 0.2
---

# Agent Instructions
You are a specialized agent that does X.
`

    const result = parseMarkdownAgent(content, "/test/my-agent/AGENT.md")

    expect(result).not.toBeNull()
    expect(result?.name).toBe("my-agent")
    expect(result?.config.mode).toBe("subagent")
    expect(result?.config.category).toBe("specialist")
    expect(result?.config.description).toBe("My custom agent")
    expect(result?.config.model).toBe("claude-sonnet-4-6")
    expect(result?.config.temperature).toBe(0.2)
    expect(result?.instructions).toBe("# Agent Instructions\nYou are a specialized agent that does X.")
    expect(result?.filePath).toBe("/test/my-agent/AGENT.md")
  })

  test("returns null when name is missing", () => {
    const content = `---
mode: subagent
description: Agent without name
---

Instructions here.
`

    const result = parseMarkdownAgent(content, "/test/agent/AGENT.md")

    expect(result).toBeNull()
  })

  test("parses without frontmatter using name as filename", () => {
    const content = `You are a simple agent.`

    const result = parseMarkdownAgent(content, "/test/simple/AGENT.md")

    expect(result).toBeNull()
  })

  test("parses tool restrictions", () => {
    const content = `---
name: restricted-agent
tools:
  - write
  - edit
---

You are restricted.
`

    const result = parseMarkdownAgent(content, "/test/restricted/AGENT.md")

    expect(result).not.toBeNull()
    expect(result?.config.tools).toEqual(["write", "edit"])
  })

  test("parses fallback models", () => {
    const content = `---
name: fallback-agent
fallback_models:
  - gpt-5.4
  - claude-opus-4-6
---

Agent with fallbacks.
`

    const result = parseMarkdownAgent(content, "/test/fallback/AGENT.md")

    expect(result).not.toBeNull()
    expect(result?.config.fallback_models).toEqual(["gpt-5.4", "claude-opus-4-6"])
  })

  test("parses fallback models as string", () => {
    const content = `---
name: single-fallback-agent
fallback_models: gpt-5.4
---

Single fallback.
`

    const result = parseMarkdownAgent(content, "/test/single-fallback/AGENT.md")

    expect(result).not.toBeNull()
    expect(result?.config.fallback_models).toBe("gpt-5.4")
  })

  test("builds prompt metadata when fields present", () => {
    const content = `---
name: metadata-agent
category: exploration
cost: FREE
useWhen:
  - multiple searches
avoidWhen:
  - single keyword
keyTrigger: "2+ modules involved"
---

Agent with metadata.
`

    const result = parseMarkdownAgent(content, "/test/metadata/AGENT.md")

    expect(result).not.toBeNull()
    expect(result?.metadata).toBeDefined()
    expect(result?.metadata?.category).toBe("exploration")
    expect(result?.metadata?.cost).toBe("FREE")
    expect(result?.metadata?.useWhen).toEqual(["multiple searches"])
    expect(result?.metadata?.avoidWhen).toEqual(["single keyword"])
    expect(result?.metadata?.keyTrigger).toBe("2+ modules involved")
  })
})

describe("convertMarkdownToAgentConfig", () => {
  const baseSource: MarkdownAgentSource = {
    name: "test-agent",
    description: "Test agent description",
    config: {
      name: "test-agent",
    },
    instructions: "You are a test agent.",
    filePath: "/test/test-agent/AGENT.md",
  }

  test("converts to AgentConfig with defaults", () => {
    const result = convertMarkdownToAgentConfig(baseSource, "claude-sonnet-4-6")

    expect(result.description).toBe("Test agent description")
    expect(result.model).toBe("claude-sonnet-4-6")
    expect(result.temperature).toBe(0.1)
    expect(result.prompt).toBe("You are a test agent.")
    expect(result.mode).toBe("subagent")
  })

  test("uses config values over defaults", () => {
    const source: MarkdownAgentSource = {
      ...baseSource,
      config: {
        name: "custom-agent",
        model: "gpt-5.4",
        temperature: 0.5,
        description: "Custom description",
      },
    }

    const result = convertMarkdownToAgentConfig(source, "claude-sonnet-4-6")

    expect(result.model).toBe("gpt-5.4")
    expect(result.temperature).toBe(0.5)
    expect(result.description).toBe("Custom description")
  })

  test("adds tool restrictions when specified", () => {
    const source: MarkdownAgentSource = {
      ...baseSource,
      config: {
        name: "restricted",
        tools: ["write", "edit"],
      },
    }

    const result = convertMarkdownToAgentConfig(source, "claude-sonnet-4-6")

    expect(result.tools).toEqual({ write: false, edit: false })
  })

  test("converts fallback_models to array", () => {
    const source: MarkdownAgentSource = {
      ...baseSource,
      config: {
        name: "with-fallback",
        fallback_models: "gpt-5.4",
      },
    }

    const result = convertMarkdownToAgentConfig(source, "claude-sonnet-4-6")

    expect(result.fallback_models).toEqual(["gpt-5.4"])
  })

  test("passes through fallback_models array", () => {
    const source: MarkdownAgentSource = {
      ...baseSource,
      config: {
        name: "with-fallbacks",
        fallback_models: ["gpt-5.4", "claude-opus-4-6"],
      },
    }

    const result = convertMarkdownToAgentConfig(source, "claude-sonnet-4-6")

    expect(result.fallback_models).toEqual(["gpt-5.4", "claude-opus-4-6"])
  })

  test("stores metadata in promptMetadata", () => {
    const source: MarkdownAgentSource = {
      ...baseSource,
      metadata: {
        category: "specialist",
        cost: "EXPENSIVE",
        triggers: [{ domain: "Test", trigger: "test trigger" }],
      },
    }

    const result = convertMarkdownToAgentConfig(source, "claude-sonnet-4-6")

    const metadata = (result as Record<string, unknown>).promptMetadata
    expect(metadata).toBeDefined()
    expect((metadata as { category: string }).category).toBe("specialist")
  })
})
