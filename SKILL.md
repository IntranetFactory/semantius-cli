---
name: semantius-mcp
description: Interface for MCP (Model Context Protocol) servers via CLI. Use when you need to interact with external tools, APIs, or data sources through MCP servers.
---

# MCP-CLI

Access MCP servers through the command line. MCP enables interaction with external systems like GitHub, filesystems, databases, and APIs.

## Commands

| Command | Output |
|---------|--------|
| `semantius-mcp` | List all servers and tools |
| `semantius-mcp info <server>` | Show server tools and parameters |
| `semantius-mcp info <server> <tool>` | Get tool JSON schema |
| `semantius-mcp grep "<pattern>"` | Search tools by name |
| `semantius-mcp call <server> <tool>` | Call tool (reads JSON from stdin if no args) |
| `semantius-mcp call <server> <tool> '<json>'` | Call tool with arguments |

**Both formats work:** `<server> <tool>` or `<server>/<tool>`

## Workflow

1. **Discover**: `semantius-mcp` → see available servers
2. **Explore**: `semantius-mcp info <server>` → see tools with parameters
3. **Inspect**: `semantius-mcp info <server> <tool>` → get full JSON schema
4. **Execute**: `semantius-mcp call <server> <tool> '<json>'` → run with arguments

## Examples

```bash
# List all servers
semantius-mcp

# With descriptions  
semantius-mcp -d

# See server tools
semantius-mcp info filesystem

# Get tool schema (both formats work)
semantius-mcp info filesystem read_file
semantius-mcp info filesystem/read_file

# Call tool
semantius-mcp call filesystem read_file '{"path": "./README.md"}'

# Pipe from stdin (no '-' needed!)
cat args.json | semantius-mcp call filesystem read_file

# Search for tools
semantius-mcp grep "*file*"

# Output is raw text (pipe-friendly)
semantius-mcp call filesystem read_file '{"path": "./file"}' | head -10
```

## Advanced Chaining

```bash
# Chain: search files → read first match
semantius-mcp call filesystem search_files '{"path": ".", "pattern": "*.md"}' \
  | head -1 \
  | xargs -I {} semantius-mcp call filesystem read_file '{"path": "{}"}'

# Loop: process multiple files
semantius-mcp call filesystem list_directory '{"path": "./src"}' \
  | while read f; do semantius-mcp call filesystem read_file "{\"path\": \"$f\"}"; done

# Conditional: check before reading
semantius-mcp call filesystem list_directory '{"path": "."}' \
  | grep -q "README" \
  && semantius-mcp call filesystem read_file '{"path": "./README.md"}'

# Multi-server aggregation
{
  semantius-mcp call github search_repositories '{"query": "mcp", "per_page": 3}'
  semantius-mcp call filesystem list_directory '{"path": "."}'
}

# Save to file
semantius-mcp call github get_file_contents '{"owner": "x", "repo": "y", "path": "z"}' > output.txt
```

**Note:** `call` outputs raw text content directly (no jq needed for text extraction)

## Options

| Flag | Purpose |
|------|---------|
| `-d` | Include descriptions |
| `-c <path>` | Specify config file |

## Common Errors

| Wrong Command | Error | Fix |
|---------------|-------|-----|
| `semantius-mcp server tool` | AMBIGUOUS_COMMAND | Use `call server tool` or `info server tool` |
| `semantius-mcp run server tool` | UNKNOWN_SUBCOMMAND | Use `call` instead of `run` |
| `semantius-mcp list` | UNKNOWN_SUBCOMMAND | Use `info` instead of `list` |
| `semantius-mcp call server` | MISSING_ARGUMENT | Add tool name |
| `semantius-mcp call server tool {bad}` | INVALID_JSON | Use valid JSON with quotes |

## Exit Codes

- `0`: Success
- `1`: Client error (bad args, missing config)
- `2`: Server error (tool failed)
- `3`: Network error
