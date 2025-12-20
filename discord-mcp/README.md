# InfiniteRealms Discord MCP Server

A Model Context Protocol (MCP) server that enables Claude Code to interact with Discord for alpha testing feedback and announcements.

## Setup

1. Copy `.env.example` to `.env` and fill in your Discord credentials
2. Install dependencies: `uv pip install -e .`
3. Run: `uv run discord_mcp.py`

## Available Tools

- `get_server_info` - Get Discord server details
- `list_channels` - List all text channels
- `send_message` - Send a message to a channel
- `read_messages` - Read recent messages from a channel
- `create_channel` - Create a new text channel
- `get_user_info` - Look up user by ID
- `search_members` - Search for server members
- `send_dm` - Send a direct message
- `add_reaction` - Add reaction to a message
- `delete_message` - Delete a message
- `get_channel_by_name` - Find channel by name

## Configuration

Set these environment variables:

- `DISCORD_TOKEN` - Your Discord bot token
- `DISCORD_GUILD_ID` - Your Discord server ID
