import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TARGET_WIDGET_NAMES = new Set([
    "ckpt_name", "unet_name", "model_name",
    "seed", "noise_seed", "steps", "cfg", "sampler_name", "scheduler",
    "text", "string"
]);

app.registerExtension({
    name: "ComfyUI.LocalGallery.WorkflowSync",

    setup() {
        api.addEventListener("gallery_registry_refresh", () => {
            this.refreshRegistry();
        });
    },

    async refreshRegistry() {
        try {
            const workflowNodes = [];
            const nodes = app.graph._nodes;

            if (!nodes) return;

            for (const node of nodes) {
                if (!node) continue;

                const widgetNames = Array.isArray(node.widgets)
                    ? node.widgets
                          .map((widget) => widget?.name)
                          .filter((name) => typeof name === "string" && name.length > 0)
                    : [];

                const hasTargetWidget = widgetNames.some((name) => TARGET_WIDGET_NAMES.has(name));

                if (!hasTargetWidget) continue;

                workflowNodes.push({
                    node_id: node.id,
                    title: node.title || node.comfyClass,
                    type: node.comfyClass,
                    comfy_class: node.comfyClass,
                    widgets: widgetNames,
                    color: node.color,
                    bgcolor: node.bgcolor,
                    outputs: Array.isArray(node.outputs) ? node.outputs.map(o => o.type) : []
                });
            }

            await fetch("/api/gallery/register-nodes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nodes: workflowNodes }),
            });
        } catch (error) {
            console.error("Local Gallery: Error refreshing workflow registry", error);
        }
    }
});
