import { app } from "../../scripts/app.js";

const BUTTON_TOOLTIP = "Launch Local Gallery";

const getGalleryIcon = () => {
    return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
    `;
};

app.registerExtension({
    name: "Comfy.LocalGallery",
    async setup() {
        const replaceButtonIcon = () => {
            const buttons = document.querySelectorAll(`button[aria-label="${BUTTON_TOOLTIP}"]`);
            buttons.forEach(button => {
                if (button.classList.contains('gallery-style-applied')) return;

                button.classList.add('gallery-style-applied');
                button.innerHTML = getGalleryIcon();
                button.style.borderRadius = '6px';
                button.style.padding = '6px';
                button.style.backgroundColor = '#6366f1';
                button.style.display = 'flex';
                button.style.alignItems = 'center';
                button.style.justifyContent = 'center';
                button.style.border = 'none';
                button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                
                const svg = button.querySelector('svg');
                if (svg) {
                    svg.style.width = '18px';
                    svg.style.height = '18px';
                    svg.style.color = 'white';
                }
            });
            
            // Continue checking in case ComfyUI re-renders the menu
            requestAnimationFrame(replaceButtonIcon);
        };

        requestAnimationFrame(replaceButtonIcon);
    },
    actionBarButtons: [
        {
            icon: "pi pi-image", // Fallback class
            tooltip: BUTTON_TOOLTIP,
            onClick: () => {
                window.open(`${window.location.origin}/gallery`, "_blank");
            }
        }
    ]
});
