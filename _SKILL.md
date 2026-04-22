---
name: semantius
description: CLI for the Semantius platform, providing access to Semantius MCP servers (crud, cube) for interacting with your Semantius organization's data and tools.
---

# semantius

Access Semantius platform services through the command line. semantius connects to the Semantius MCP servers configured for your organization.

## Commands

| Command | Output |
|---------|--------|
| `semantius` | List all servers and tools |
| `semantius info <server>` | Show server tools and parameters |
| `semantius info <server> <tool>` | Get tool JSON schema |
| `semantius grep "<pattern>"` | Search tools by name |
| `semantius call <server> <tool>` | Call tool (reads JSON from stdin if no args) |
| `semantius call <server> <tool> '<json>'` | Call tool with arguments |

**Both formats work:** `<server> <tool>` or `<server>/<tool>`

## Workflow

1. **Discover**: `semantius` → see available servers
2. **Explore**: `semantius info <server>` → see tools with parameters
3. **Inspect**: `semantius info <server> <tool>` → get full JSON schema
4. **Execute**: `semantius call <server> <tool> '<json>'` → run with arguments

## Examples

```bash
# List all servers
semantius

# With descriptions  
semantius -d

# See server tools
semantius info crud

# Get tool schema (both formats work)
semantius info crud create_record
semantius info crud/create_record

# Call tool
semantius call crud create_record '{"name": "My Record"}'

# Pipe from stdin (no '-' needed!)
cat args.json | semantius call crud create_record

# Search for tools
semantius grep "*record*"

# Output is raw text (pipe-friendly)
semantius call cube query '{"mdx": "SELECT ..."}' | head -10
```

## Advanced Chaining

```bash
# Chain: search tools → call first match
semantius grep "*create*"

# Multi-server aggregation
{
  semantius info crud
  semantius info cube
}

# Save to file
semantius call crud get_record '{"id": "123"}' > output.txt
```

**Note:** `call` outputs raw text content directly (no jq needed for text extraction)

## Options

| Flag | Purpose |
|------|---------|
| `-d` | Include descriptions |
| `-md` | Dump full documentation as markdown (README, SKILL, all tools) |
| `-c <path>` | Specify config file |

## Common Errors

| Wrong Command | Error | Fix |
|---------------|-------|-----|
| `semantius server tool` | AMBIGUOUS_COMMAND | Use `call server tool` or `info server tool` |
| `semantius run server tool` | UNKNOWN_SUBCOMMAND | Use `call` instead of `run` |
| `semantius list` | UNKNOWN_SUBCOMMAND | Use `info` instead of `list` |
| `semantius call server` | MISSING_ARGUMENT | Add tool name |
| `semantius call server tool {bad}` | INVALID_JSON | Use valid JSON with quotes |

## Exit Codes

- `0`: Success
- `1`: Client error (bad args, missing config)
- `2`: Server error (tool failed)
- `3`: Network error
