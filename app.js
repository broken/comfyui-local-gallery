// App State
const state = {
    images: [], // { file, url, data: { name, model, loras, prompt, raw } }
    filteredImages: [],
    models: new Set(),
    loras: new Set(),
    isScanning: false,
    
    // Filters
    searchQuery: '',
    selectedModel: '',
    selectedLora: ''
};

// DOM Elements
const els = {
    btnSelect: document.getElementById('select-folder-btn'),
    searchInput: document.getElementById('search-input'),
    modelFilter: document.getElementById('model-filter'),
    loraFilter: document.getElementById('lora-filter'),
    galleryGrid: document.getElementById('gallery-grid'),
    loadingSpinner: document.getElementById('loading-spinner'),
    statusText: document.getElementById('status-text'),
    
    // Modal
    modal: document.getElementById('image-modal'),
    btnCloseModal: document.getElementById('close-modal-btn'),
    modalImage: document.getElementById('modal-image'),
    modalFilename: document.getElementById('modal-filename'),
    modalModel: document.getElementById('modal-model'),
    modalLoras: document.getElementById('modal-loras'),
    modalPositive: document.getElementById('modal-positive'),
    modalRawJson: document.getElementById('modal-raw-json'),
    modalPromptBadge: document.getElementById('modal-prompt-badge')
};

// Initialization
function init() {
    els.btnSelect.addEventListener('click', handleFolderSelection);
    els.searchInput.addEventListener('input', handleFilterChange);
    els.modelFilter.addEventListener('change', handleFilterChange);
    els.loraFilter.addEventListener('change', handleFilterChange);
    els.btnCloseModal.addEventListener('click', closeModal);
    
    // Close modal on escape or clicking backdrop
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
    els.modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeModal();
    });
}

// Extract specific nodes from ComfyUI Workflow/Prompt JSON
function extractComfyUIMetadata(jsonStr) {
    const result = {
        model: 'Unknown',
        loras: [],
        positivePrompt: '',
        raw: null
    };

    try {
        const data = JSON.parse(jsonStr);
        result.raw = data;

        // The prompt JSON in ComfyUI has node IDs as keys, and node specs as values
        // Let's iterate over nodes
        const nodes = Object.values(data);
        
        let positiveText = [];

        nodes.forEach(node => {
            if (!node.class_type) return;

            // Extract Base Model
            if (node.class_type === 'CheckpointLoaderSimple' || node.class_type.includes('Checkpoint')) {
                if (node.inputs && node.inputs.ckpt_name) {
                    result.model = node.inputs.ckpt_name;
                }
            }

            // Extract LoRAs
            if (node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly') {
                if (node.inputs && node.inputs.lora_name) {
                    result.loras.push(node.inputs.lora_name);
                }
            }

            // Extract Prompts (heuristics: looking for CLIPTextEncode)
            if (node.class_type === 'CLIPTextEncode') {
                if (node.inputs && typeof node.inputs.text === 'string') {
                    // Usually there's positive and negative. Heuristic: positive is often the larger one or connected to specific inputs
                    positiveText.push(node.inputs.text);
                }
            }
        });

        if (positiveText.length > 0) {
            // Just join them for display, or pick the first one
            result.positivePrompt = positiveText.join('\n\n--- Also found ---\n');
        } else {
            result.positivePrompt = "No positive prompt string found (or custom node used).";
        }

    } catch (e) {
        console.error("Failed to parse ComfyUI JSON", e);
    }
    
    return result;
}

// Parse PNG chunks
// Reads ArrayBuffer of a file to extract tEXt/iTXt chunks containing prompt data
async function parsePNG(file) {
    const defaultData = { name: file.name, model: 'Unknown', loras: [], positivePrompt: 'No metadata found', raw: null };
    
    try {
        // Lightweight chunk parser
        const arrayBuffer = await file.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        
        // Check PNG signature: 137 80 78 71 13 10 26 10
        if (dataView.getUint32(0) !== 0x89504e47 || dataView.getUint32(4) !== 0x0d0a1a0a) {
            return defaultData;
        }

        let offset = 8;
        while (offset < arrayBuffer.byteLength) {
            const length = dataView.getUint32(offset);
            const type = String.fromCharCode(
                dataView.getUint8(offset + 4),
                dataView.getUint8(offset + 5),
                dataView.getUint8(offset + 6),
                dataView.getUint8(offset + 7)
            );
            
            // If we hit IDAT (image data), ComfyUI metadata is usually before it. 
            if (type === 'tEXt' || type === 'iTXt') {
                // Read the chunk data
                const chunkDataView = new Uint8Array(arrayBuffer, offset + 8, length);
                const decoder = new TextDecoder('utf-8'); // mostly ascii/utf-8
                
                // tEXt chunk formatting: Keyword (null separator) Text string
                if (type === 'tEXt') {
                    // Find null byte
                    let nullIdx = 0;
                    for (let i = 0; i < chunkDataView.length; i++) {
                        if (chunkDataView[i] === 0) {
                            nullIdx = i;
                            break;
                        }
                    }
                    const keyword = decoder.decode(chunkDataView.subarray(0, nullIdx));
                    const textStr = decoder.decode(chunkDataView.subarray(nullIdx + 1));
                    
                    if (keyword === 'prompt' || keyword === 'workflow') {
                        // Usually 'prompt' has the actual gen data we want based on Comfy execution
                        return { ...defaultData, ...extractComfyUIMetadata(textStr) };
                    }
                }
            } else if (type === 'IEND') {
                break;
            }
            
            // offset + length + type(4) + length(4) + crc(4)
            offset += 12 + length;
        }
        
    } catch (e) {
        console.warn(`Failed to parse PNG metadata for ${file.name}`, e);
    }
    
    return defaultData;
}

async function handleFolderSelection() {
    try {
        // Unfortunately standard web permissions don't allow setting an absolute default path 
        // with the File System Access API due to security. We use 'id' to remember the last choice.
        const dirHandle = await window.showDirectoryPicker({
            id: 'comfyui-gallery', 
            mode: 'read',
            startIn: 'pictures' // We can only give generic hints like 'pictures' or 'documents'
        });
        
        els.statusText.textContent = `Scanning directory: ${dirHandle.name}...`;
        els.btnSelect.disabled = true;
        els.loadingSpinner.classList.remove('hidden');
        els.galleryGrid.innerHTML = '';
        
        // Clear state
        state.images = [];
        state.models.clear();
        state.loras.clear();
        
        // Scan directory
        await scanDirectory(dirHandle);
        
        // Populate UI
        updateFiltersUI();
        state.filteredImages = [...state.images];
        renderGallery();
        
        // Enable controls
        els.searchInput.disabled = false;
        els.modelFilter.disabled = false;
        els.loraFilter.disabled = false;
        els.btnSelect.disabled = false;
        
        els.statusText.textContent = `Loaded ${state.images.length} images from ${dirHandle.name}.`;
        
    } catch (err) {
        console.error(err);
        if (err.name !== 'AbortError') {
            els.statusText.textContent = `Error: ${err.message}. Please select a valid folder.`;
        } else {
            els.statusText.textContent = 'Folder selection cancelled. (Hint: Select D:\\ai\\...\\output)';
        }
        els.btnSelect.disabled = false;
    } finally {
        els.loadingSpinner.classList.add('hidden');
    }
}

async function scanDirectory(dirHandle) {
    // Note: To prevent browser freezing on thousands of files, we perform some batching and yielding
    let filesBatch = [];
    
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.png')) {
            const file = await entry.getFile();
            filesBatch.push(file);
            
            // Give UI a chance to breathe every 50 files
            if (filesBatch.length >= 50) {
                await processBatch(filesBatch);
                filesBatch = [];
            }
        }
    }
    
    if (filesBatch.length > 0) {
        await processBatch(filesBatch);
    }
}

async function processBatch(filesBatch) {
    const parsePromises = filesBatch.map(async file => {
        const url = URL.createObjectURL(file);
        const metadata = await parsePNG(file);
        
        // Add to global sets
        if (metadata.model && metadata.model !== 'Unknown') {
            state.models.add(metadata.model);
        }
        metadata.loras.forEach(l => state.loras.add(l));
        
        return {
            file,
            url,
            data: metadata
        };
    });
    
    const results = await Promise.all(parsePromises);
    state.images.push(...results);
    els.statusText.textContent = `Found ${state.images.length} images... please wait...`;
}

function updateFiltersUI() {
    // Models
    const models = Array.from(state.models).sort();
    els.modelFilter.innerHTML = '<option value="">All Models</option>';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        // Show just the filename if it's a path
        option.textContent = model.includes('/') ? model.split('/').pop() : (model.includes('\\') ? model.split('\\').pop() : model);
        els.modelFilter.appendChild(option);
    });

    // LoRAs
    const loras = Array.from(state.loras).sort();
    els.loraFilter.innerHTML = '<option value="">All LoRAs</option>';
    loras.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora;
        option.textContent = lora;
        els.loraFilter.appendChild(option);
    });
}

function handleFilterChange() {
    state.searchQuery = els.searchInput.value.toLowerCase();
    state.selectedModel = els.modelFilter.value;
    state.selectedLora = els.loraFilter.value;
    
    state.filteredImages = state.images.filter(img => {
        // Search Filter
        const matchesSearch = img.data.name.toLowerCase().includes(state.searchQuery) ||
                              img.data.model.toLowerCase().includes(state.searchQuery) ||
                              img.data.loras.some(l => l.toLowerCase().includes(state.searchQuery));
                              
        // Model Filter (exact match on full path inside state)
        const matchesModel = !state.selectedModel || img.data.model === state.selectedModel;
        
        // LoRA Filter
        const matchesLora = !state.selectedLora || img.data.loras.includes(state.selectedLora);
        
        return matchesSearch && matchesModel && matchesLora;
    });
    
    renderGallery();
}

function renderGallery() {
    els.galleryGrid.innerHTML = '';
    
    if (state.filteredImages.length === 0) {
        els.galleryGrid.innerHTML = `
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <h2>No results found</h2>
                <p>Try adjusting your search or filters.</p>
            </div>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();
    
    // Performance optimization: Render visibly, rely on native lazy loading
    state.filteredImages.forEach(img => {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.onclick = () => openImageModal(img);
        
        const shortModelName = img.data.model === 'Unknown' ? 'Unknown Base Model' : 
            (img.data.model.includes('/') ? img.data.model.split('/').pop() : (img.data.model.includes('\\') ? img.data.model.split('\\').pop() : img.data.model));
        
        // Create inner HTML
        card.innerHTML = `
            <div class="card-image-wrap">
                <img src="${img.url}" loading="lazy" alt="${img.data.name}">
            </div>
            <div class="card-overlay">
                <div class="card-title">${img.data.name}</div>
                <div class="card-model">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A2 2 0 0 1 18.2 18H5.8A2 2 0 0 1 4 16.2V7.8A2 2 0 0 1 5.8 6h12.4a2 2 0 0 1 1.8 1.8v8.4z"></path><polyline points="10 11 12 13 14 11"></polyline></svg>
                    ${shortModelName}
                </div>
                ${img.data.loras.length > 0 ? `<div class="card-model">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    ${img.data.loras.length} LoRA(s)
                </div>` : ''}
            </div>
        `;
        
        fragment.appendChild(card);
    });
    
    els.galleryGrid.appendChild(fragment);
}

function openImageModal(img) {
    els.modalImage.src = img.url;
    els.modalFilename.textContent = img.data.name;
    
    const shortModelName = img.data.model === 'Unknown' ? 'Unknown Pattern' : 
        (img.data.model.includes('/') ? img.data.model.split('/').pop() : (img.data.model.includes('\\') ? img.data.model.split('\\').pop() : img.data.model));
    els.modalModel.textContent = shortModelName;
    
    // Render LoRAs
    if (img.data.loras.length > 0) {
        els.modalLoras.innerHTML = img.data.loras.map(l => `<li class="lora-tag">${l}</li>`).join('');
    } else {
        els.modalLoras.innerHTML = '<li style="color:#a0a5b1; font-size:0.9rem;">No LoRAs detected</li>';
    }
    
    els.modalPositive.textContent = img.data.positivePrompt || 'None';
    
    if (img.data.raw) {
        els.modalRawJson.textContent = JSON.stringify(img.data.raw, null, 2);
    } else {
        els.modalRawJson.textContent = 'No ComfyUI generation data found in this file.';
    }

    if (img.data.raw) {
        els.modalPromptBadge.textContent = 'Found';
        els.modalPromptBadge.style.backgroundColor = '#22c55e'; // green
    } else {
        els.modalPromptBadge.textContent = 'Missing';
        els.modalPromptBadge.style.backgroundColor = '#ef4444'; // red
    }

    els.modal.classList.remove('hidden');
}

function closeModal() {
    els.modal.classList.add('hidden');
    // Note: Intentionally not clearing els.modalImage.src to prevent flicker on rapid close/open,
    // though we could to free up memory if users view many very large images. URL.createObjectURL manages memory fine on its own mostly.
}

// Boot
document.addEventListener('DOMContentLoaded', init);
