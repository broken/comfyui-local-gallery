from server import PromptServer
from aiohttp import web
import os

WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}

import folder_paths

# Add a redirect route for /gallery
@PromptServer.instance.routes.get("/gallery")
async def gallery_redirect(request):
    raise web.HTTPFound("/extensions/comfyui-local-gallery/index.html")

# Add an API to get the current output directory path
@PromptServer.instance.routes.get("/api/gallery/output_path")
async def get_output_path(request):
    return web.json_response({"path": os.path.abspath(folder_paths.get_output_directory())})

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS"]
