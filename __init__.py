import os
import json
from server import PromptServer
from aiohttp import web
import folder_paths

WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}

import asyncio

# Global in-memory registry
_workflow_registry = {"nodes": {}, "update_event": asyncio.Event()}

# Add a redirect route for /gallery
@PromptServer.instance.routes.get("/gallery")
async def gallery_redirect(request):
    raise web.HTTPFound("/extensions/comfyui-local-gallery/index.html")

# Add an API to get the current output directory path
@PromptServer.instance.routes.get("/api/gallery/output_path")
async def get_output_path(request):
    return web.json_response({"path": os.path.abspath(folder_paths.get_output_directory())})

@PromptServer.instance.routes.post("/api/gallery/register-nodes")
async def register_nodes(request):
    try:
        data = await request.json()
        nodes = data.get("nodes", [])
        
        registry = {}
        for node in nodes:
            node_id = node.get("node_id")
            if node_id is not None:
                registry[str(node_id)] = node
                
        _workflow_registry["nodes"] = registry
        _workflow_registry["update_event"].set()
        _workflow_registry["update_event"].clear()
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get("/api/gallery/get-registry")
async def get_registry(request):
    try:
        # Trigger a refresh from the frontend
        PromptServer.instance.send_sync("gallery_registry_refresh", {})
        
        # Wait for the frontend to report back (timeout 2s)
        try:
            await asyncio.wait_for(_workflow_registry["update_event"].wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass # Return whatever we have if it times out
            
        return web.json_response({"success": True, "nodes": _workflow_registry["nodes"]})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS"]
