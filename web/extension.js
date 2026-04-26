import { app } from "../../scripts/app.js";

const GALLERY_ICON = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" stroke-width="2"/>
    <path d="M15 9H11C9.89543 9 9 9.89543 9 11V13C9 14.1046 9.89543 15 11 15H15V13H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

app.registerExtension({
    name: "Comfy.LocalGallery",
    async setup() {
        // We use a small interval to ensure the button is rendered so we can inject the icon
        const injectIcon = () => {
            const btns = document.querySelectorAll('button[tooltip="Launch Local Gallery"]');
            btns.forEach(btn => {
                const iconSpan = btn.querySelector('.comfyui-icon, span');
                if (iconSpan && !iconSpan.dataset.galleryIconSet) {
                    iconSpan.innerHTML = GALLERY_ICON;
                    iconSpan.style.color = "#6366f1"; // Nice bright indigo
                    iconSpan.dataset.galleryIconSet = "true";
                }
            });
        };

        setInterval(injectIcon, 500);
    },
    actionBarButtons: [
        {
            icon: "icon-placeholder", // Class used for identification
            tooltip: "Launch Local Gallery",
            onClick: () => {
                window.open(`${window.location.origin}/gallery`, "_blank");
            }
        }
    ]
});
