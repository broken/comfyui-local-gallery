import { app } from "../../scripts/app.js";

/**
 * ComfyUI-Local-Gallery
 * Modern Action Bar implementation for newer ComfyUI versions.
 */
app.registerExtension({
    name: "Comfy.LocalGallery",
    actionBarButtons: [
        {
            icon: "icon-[mdi--alpha-g-box] size-5",
            tooltip: "Launch Local Gallery",
            onClick: () => {
                window.open(`${window.location.origin}/gallery`, "_blank");
            }
        }
    ]
});
