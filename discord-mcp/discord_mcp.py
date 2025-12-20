#!/usr/bin/env python3
"""
InfiniteRealms Discord MCP Server

A Model Context Protocol server that enables Claude Code to interact
with Discord for alpha testing feedback and announcements.
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import Optional

import aiohttp
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# Load .env from the script's directory
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

# Configure logging to stderr (never stdout - it corrupts MCP protocol)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger("discord-mcp")

# Discord API configuration
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
DISCORD_GUILD_ID = os.getenv("DISCORD_GUILD_ID")
BASE_URL = "https://discord.com/api/v10"

if not DISCORD_TOKEN:
    logger.warning("DISCORD_TOKEN not set - Discord operations will fail")
if not DISCORD_GUILD_ID:
    logger.warning("DISCORD_GUILD_ID not set - some operations may fail")

# Initialize MCP server
mcp = FastMCP("infiniterealms-discord")


async def discord_request(
    method: str,
    endpoint: str,
    json_data: Optional[dict] = None
) -> dict:
    """Make an authenticated request to the Discord API."""
    headers = {
        "Authorization": f"Bot {DISCORD_TOKEN}",
        "Content-Type": "application/json",
    }

    url = f"{BASE_URL}{endpoint}"

    async with aiohttp.ClientSession() as session:
        async with session.request(
            method,
            url,
            headers=headers,
            json=json_data
        ) as response:
            if response.status == 204:
                return {"success": True}

            try:
                data = await response.json()
            except:
                data = {"raw": await response.text()}

            if response.status >= 400:
                return {
                    "error": True,
                    "status": response.status,
                    "message": data.get("message", str(data))
                }

            return data


@mcp.tool()
async def get_server_info() -> str:
    """Get information about the Discord server (guild)."""
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request("GET", f"/guilds/{DISCORD_GUILD_ID}")

    if "error" in data:
        return f"Error: {data['message']}"

    return json.dumps({
        "name": data.get("name"),
        "id": data.get("id"),
        "member_count": data.get("approximate_member_count"),
        "description": data.get("description"),
        "owner_id": data.get("owner_id"),
    }, indent=2)


@mcp.tool()
async def list_channels() -> str:
    """List all text channels in the Discord server."""
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request("GET", f"/guilds/{DISCORD_GUILD_ID}/channels")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    # Filter to text channels and format nicely
    channels = []
    for ch in data:
        if ch.get("type") == 0:  # 0 = text channel
            channels.append({
                "id": ch["id"],
                "name": ch["name"],
                "topic": ch.get("topic"),
                "category": ch.get("parent_id"),
            })

    return json.dumps(channels, indent=2)


@mcp.tool()
async def send_message(channel_id: str, content: str) -> str:
    """
    Send a message to a Discord channel.

    Args:
        channel_id: The ID of the channel to send to
        content: The message content to send
    """
    if not content.strip():
        return "Error: Message content cannot be empty"

    data = await discord_request(
        "POST",
        f"/channels/{channel_id}/messages",
        {"content": content}
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return f"Message sent successfully (ID: {data.get('id')})"


@mcp.tool()
async def read_messages(channel_id: str, limit: int = 10) -> str:
    """
    Read recent messages from a Discord channel.

    Args:
        channel_id: The ID of the channel to read from
        limit: Number of messages to retrieve (1-100, default 10)
    """
    limit = max(1, min(100, limit))

    data = await discord_request(
        "GET",
        f"/channels/{channel_id}/messages?limit={limit}"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    messages = []
    for msg in data:
        messages.append({
            "id": msg["id"],
            "author": msg["author"]["username"],
            "content": msg["content"],
            "timestamp": msg["timestamp"],
        })

    return json.dumps(messages, indent=2)


@mcp.tool()
async def create_channel(name: str, topic: Optional[str] = None, category_id: Optional[str] = None) -> str:
    """
    Create a new text channel in the Discord server.

    Args:
        name: The name for the new channel (will be lowercased, spaces become hyphens)
        topic: Optional description/topic for the channel
        category_id: Optional category ID to place the channel under
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    channel_data = {
        "name": name,
        "type": 0,  # Text channel
    }

    if topic:
        channel_data["topic"] = topic
    if category_id:
        channel_data["parent_id"] = category_id

    data = await discord_request(
        "POST",
        f"/guilds/{DISCORD_GUILD_ID}/channels",
        channel_data
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return f"Channel #{data['name']} created successfully (ID: {data['id']})"


@mcp.tool()
async def get_user_info(user_id: str) -> str:
    """
    Get information about a Discord user.

    Args:
        user_id: The ID of the user to look up
    """
    data = await discord_request("GET", f"/users/{user_id}")

    if "error" in data:
        return f"Error: {data['message']}"

    return json.dumps({
        "id": data.get("id"),
        "username": data.get("username"),
        "display_name": data.get("global_name"),
        "bot": data.get("bot", False),
    }, indent=2)


@mcp.tool()
async def search_members(query: str, limit: int = 10) -> str:
    """
    Search for server members by username.

    Args:
        query: The username to search for
        limit: Maximum number of results (1-100, default 10)
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    limit = max(1, min(100, limit))

    data = await discord_request(
        "GET",
        f"/guilds/{DISCORD_GUILD_ID}/members/search?query={query}&limit={limit}"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    members = []
    for member in data:
        user = member.get("user", {})
        members.append({
            "id": user.get("id"),
            "username": user.get("username"),
            "display_name": user.get("global_name"),
            "nickname": member.get("nick"),
            "joined_at": member.get("joined_at"),
        })

    return json.dumps(members, indent=2)


@mcp.tool()
async def send_dm(user_id: str, content: str) -> str:
    """
    Send a direct message to a user.

    Args:
        user_id: The ID of the user to message
        content: The message content to send
    """
    if not content.strip():
        return "Error: Message content cannot be empty"

    # First, create a DM channel
    dm_channel = await discord_request(
        "POST",
        "/users/@me/channels",
        {"recipient_id": user_id}
    )

    if "error" in dm_channel:
        return f"Error creating DM channel: {dm_channel['message']}"

    # Then send the message
    data = await discord_request(
        "POST",
        f"/channels/{dm_channel['id']}/messages",
        {"content": content}
    )

    if "error" in data:
        return f"Error sending DM: {data['message']}"

    return f"DM sent successfully to user {user_id}"


@mcp.tool()
async def add_reaction(channel_id: str, message_id: str, emoji: str) -> str:
    """
    Add a reaction to a message.

    Args:
        channel_id: The channel containing the message
        message_id: The ID of the message to react to
        emoji: The emoji to react with (e.g., "👍" or custom emoji format)
    """
    # URL encode the emoji for the API
    import urllib.parse
    encoded_emoji = urllib.parse.quote(emoji)

    data = await discord_request(
        "PUT",
        f"/channels/{channel_id}/messages/{message_id}/reactions/{encoded_emoji}/@me"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return f"Reaction {emoji} added successfully"


@mcp.tool()
async def delete_message(channel_id: str, message_id: str) -> str:
    """
    Delete a message from a channel.

    Args:
        channel_id: The channel containing the message
        message_id: The ID of the message to delete
    """
    data = await discord_request(
        "DELETE",
        f"/channels/{channel_id}/messages/{message_id}"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return "Message deleted successfully"


@mcp.tool()
async def get_channel_by_name(name: str) -> str:
    """
    Find a channel by its name.

    Args:
        name: The name of the channel to find (without #)
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request("GET", f"/guilds/{DISCORD_GUILD_ID}/channels")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    name_lower = name.lower().replace("#", "")

    for ch in data:
        if ch.get("name", "").lower() == name_lower:
            return json.dumps({
                "id": ch["id"],
                "name": ch["name"],
                "type": ch["type"],
                "topic": ch.get("topic"),
            }, indent=2)

    return f"No channel found with name '{name}'"


# ============================================================
# Extended Discord Management Tools
# ============================================================

@mcp.tool()
async def create_category(name: str) -> str:
    """
    Create a new category channel to organize text channels.

    Args:
        name: The name for the category
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request(
        "POST",
        f"/guilds/{DISCORD_GUILD_ID}/channels",
        {
            "name": name,
            "type": 4,  # 4 = category channel
        }
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return json.dumps({
        "success": True,
        "category_id": data["id"],
        "name": data["name"],
        "message": f"Category '{data['name']}' created successfully"
    }, indent=2)


@mcp.tool()
async def list_categories() -> str:
    """List all category channels in the Discord server."""
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request("GET", f"/guilds/{DISCORD_GUILD_ID}/channels")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    categories = []
    for ch in data:
        if ch.get("type") == 4:  # 4 = category
            categories.append({
                "id": ch["id"],
                "name": ch["name"],
                "position": ch.get("position"),
            })

    return json.dumps(categories, indent=2)


@mcp.tool()
async def move_channel_to_category(channel_id: str, category_id: str) -> str:
    """
    Move a channel into a category.

    Args:
        channel_id: The ID of the channel to move
        category_id: The ID of the category to move it to
    """
    data = await discord_request(
        "PATCH",
        f"/channels/{channel_id}",
        {"parent_id": category_id}
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return f"Channel moved to category successfully"


@mcp.tool()
async def create_invite(
    channel_id: str,
    max_age: int = 86400,
    max_uses: int = 0,
    unique: bool = True
) -> str:
    """
    Create an invite link for the server.

    Args:
        channel_id: The channel to create the invite for
        max_age: Duration in seconds before expiry (0 = never, default 86400 = 24 hours)
        max_uses: Max number of uses (0 = unlimited)
        unique: If true, creates a new unique invite each time
    """
    data = await discord_request(
        "POST",
        f"/channels/{channel_id}/invites",
        {
            "max_age": max_age,
            "max_uses": max_uses,
            "unique": unique,
        }
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return json.dumps({
        "code": data["code"],
        "url": f"https://discord.gg/{data['code']}",
        "max_age": data.get("max_age"),
        "max_uses": data.get("max_uses"),
        "expires_at": data.get("expires_at"),
    }, indent=2)


@mcp.tool()
async def list_roles() -> str:
    """List all roles in the Discord server."""
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request("GET", f"/guilds/{DISCORD_GUILD_ID}/roles")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    roles = []
    for role in data:
        roles.append({
            "id": role["id"],
            "name": role["name"],
            "color": role.get("color"),
            "position": role.get("position"),
            "mentionable": role.get("mentionable"),
        })

    # Sort by position (higher = more important)
    roles.sort(key=lambda r: r["position"], reverse=True)

    return json.dumps(roles, indent=2)


@mcp.tool()
async def create_role(
    name: str,
    color: Optional[int] = None,
    mentionable: bool = True,
    hoist: bool = False
) -> str:
    """
    Create a new role in the server.

    Args:
        name: The name for the role
        color: Integer color value (e.g., 0xFF5733 for orange). Use 0 for default.
        mentionable: Whether the role can be @mentioned
        hoist: Whether to display role members separately in the sidebar
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    role_data = {
        "name": name,
        "mentionable": mentionable,
        "hoist": hoist,
    }
    if color is not None:
        role_data["color"] = color

    data = await discord_request(
        "POST",
        f"/guilds/{DISCORD_GUILD_ID}/roles",
        role_data
    )

    if "error" in data:
        return f"Error: {data['message']}"

    return json.dumps({
        "success": True,
        "role_id": data["id"],
        "name": data["name"],
        "message": f"Role '{data['name']}' created successfully"
    }, indent=2)


@mcp.tool()
async def assign_role(user_id: str, role_id: str) -> str:
    """
    Assign a role to a user.

    Args:
        user_id: The ID of the user
        role_id: The ID of the role to assign
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request(
        "PUT",
        f"/guilds/{DISCORD_GUILD_ID}/members/{user_id}/roles/{role_id}"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return f"Role assigned successfully to user {user_id}"


@mcp.tool()
async def remove_role(user_id: str, role_id: str) -> str:
    """
    Remove a role from a user.

    Args:
        user_id: The ID of the user
        role_id: The ID of the role to remove
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    data = await discord_request(
        "DELETE",
        f"/guilds/{DISCORD_GUILD_ID}/members/{user_id}/roles/{role_id}"
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return f"Role removed successfully from user {user_id}"


@mcp.tool()
async def set_channel_read_only(channel_id: str, role_id: Optional[str] = None) -> str:
    """
    Make a channel read-only for everyone (or a specific role).
    Useful for announcement channels.

    Args:
        channel_id: The ID of the channel
        role_id: Optional role ID. If not provided, uses @everyone role.
    """
    if not DISCORD_GUILD_ID:
        return "Error: DISCORD_GUILD_ID not configured"

    # Use @everyone role (same ID as guild) if no role specified
    target_role = role_id or DISCORD_GUILD_ID

    # Permission overwrites:
    # deny SEND_MESSAGES (0x800) = 2048
    data = await discord_request(
        "PUT",
        f"/channels/{channel_id}/permissions/{target_role}",
        {
            "type": 0,  # 0 = role
            "deny": "2048",  # SEND_MESSAGES
            "allow": "0",
        }
    )

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return "Channel set to read-only successfully"


@mcp.tool()
async def delete_channel(channel_id: str) -> str:
    """
    Delete a channel.

    Args:
        channel_id: The ID of the channel to delete
    """
    data = await discord_request("DELETE", f"/channels/{channel_id}")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['message']}"

    return "Channel deleted successfully"


@mcp.tool()
async def edit_channel(
    channel_id: str,
    name: Optional[str] = None,
    topic: Optional[str] = None,
    position: Optional[int] = None
) -> str:
    """
    Edit a channel's settings.

    Args:
        channel_id: The ID of the channel to edit
        name: New name for the channel
        topic: New topic/description for the channel
        position: New position in the channel list
    """
    update_data = {}
    if name is not None:
        update_data["name"] = name
    if topic is not None:
        update_data["topic"] = topic
    if position is not None:
        update_data["position"] = position

    if not update_data:
        return "Error: No changes specified"

    data = await discord_request("PATCH", f"/channels/{channel_id}", update_data)

    if "error" in data:
        return f"Error: {data['message']}"

    return f"Channel updated successfully"


def main():
    """Run the MCP server."""
    logger.info("Starting InfiniteRealms Discord MCP Server")
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
