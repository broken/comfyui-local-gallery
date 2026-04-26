from server import PromptServer
from aiohttp import web
import os

WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}

# Add a redirect route for /gallery
@PromptServer.instance.routes.get("/gallery")
async def gallery_redirect(request):
    raise web.HTTPFound("/extensions/comfyui-local-gallery/index.html")

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS"]
