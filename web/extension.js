import { app } from "../../scripts/app.js";

/**
 * ComfyUI-Local-Gallery Extension
 * Adds a "G" button to the main ComfyUI menu to open the local gallery.
 */
app.registerExtension({
    name: "Comfy.LocalGallery",
    async setup() {
        console.log("[Local Gallery] Extension loading...");

        const createGalleryButton = (container) => {
            if (container.querySelector('.gallery-nav-btn')) return;

            const btn = document.createElement("button");
            btn.className = "gallery-nav-btn";
            btn.textContent = "G";
            btn.title = "Local Gallery";
            
            // Stronger styling to ensure it stands out in the menu
            Object.assign(btn.style, {
                fontWeight: "bold",
                color: "#6366f1",
                cursor: "pointer",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                background: "rgba(99, 102, 241, 0.1)",
                borderRadius: "4px",
                margin: "0 4px",
                padding: "2px 8px",
                fontSize: "14px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s"
            });

            btn.onmouseover = () => {
                btn.style.background = "rgba(99, 102, 241, 0.3)";
                btn.style.borderColor = "rgba(99, 102, 241, 0.6)";
            };
            btn.onmouseout = () => {
                btn.style.background = "rgba(99, 102, 241, 0.1)";
                btn.style.borderColor = "rgba(99, 102, 241, 0.3)";
            };
            
            btn.onclick = () => {
                window.open("/gallery", "_blank");
            };

            container.appendChild(btn);
            console.log("[Local Gallery] Button added to menu");
        };

        const findAndAttach = () => {
            // Target containers for various ComfyUI versions (ordered by preference)
            const selectors = [
                ".comfyui-menu .comfyui-button-container", // New UI Top Bar
                ".comfy-menu-actions", // Classic UI Actions
                ".comfy-menu", // Classic UI Main
                ".comfyui-menu", // New UI General
                ".comfyui-body-topbar" // Alternative Top Bar
            ];
            
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) {
                    createGalleryButton(el);
                    return true;
                }
            }
            return false;
        };

        // Check frequently for the first few seconds as the UI settles
        let attempts = 0;
        const interval = setInterval(() => {
            if (findAndAttach() || attempts > 20) {
                clearInterval(interval);
            }
            attempts++;
        }, 500);
    }
});
