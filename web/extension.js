import { app } from "../../scripts/app.js";

/**
 * ComfyUI-Local-Gallery Extension
 * Adds a "G" button to the main ComfyUI menu to open the local gallery.
 */
app.registerExtension({
    name: "Comfy.LocalGallery",
    async setup() {
        // Function to create the button
        const createGalleryButton = (container) => {
            if (container.querySelector('.gallery-nav-btn')) return;

            const btn = document.createElement("button");
            btn.className = "gallery-nav-btn";
            btn.textContent = "G";
            btn.title = "Local Gallery";
            
            // Basic styling to match the menu
            Object.assign(btn.style, {
                fontWeight: "bold",
                color: "#6366f1",
                cursor: "pointer",
                border: "none",
                background: "none",
                padding: "2px 5px",
                fontSize: "14px"
            });
            
            btn.onclick = () => {
                window.open("/gallery", "_blank");
            };

            // Try to find the Lora Manager "L" button to place it next to it
            const buttons = Array.from(container.querySelectorAll("button"));
            const loraBtn = buttons.find(b => b.textContent === "L" || (b.title && b.title.includes("Lora Manager")));
            
            if (loraBtn) {
                loraBtn.parentNode.insertBefore(btn, loraBtn.nextSibling);
            } else {
                container.appendChild(btn);
            }
        };

        // 1. Classic UI (Floating Menu)
        const menu = document.querySelector(".comfy-menu");
        if (menu) {
            createGalleryButton(menu);
        }

        // 2. New UI (Top Bar / Sidebars)
        // In newer versions, we might need to watch for the menu appearing
        const observer = new MutationObserver((mutations) => {
            const menu = document.querySelector(".comfy-menu") || document.querySelector(".comfyui-menu");
            if (menu) createGalleryButton(menu);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }
});
