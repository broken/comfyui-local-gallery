// App State
const state = {
    images: [], // { file, url, data: { name, model, loras, prompt, raw } }
    filteredImages: [],
    models: new Set(),
    loras: new Set(),
    isScanning: false,
    
    // Filters
    searchQuery: '', // Global search box
    filenameQuery: '', // Dedicated filename box
    selectedModel: '',
    selectedLora: '',
    sortBy: 'date-desc', // Default sort
    
    // Directory Management
    currentDirHandle: null,
    currentActiveImg: null,
    watchInterval: null,
    isChecking: false
};

// DOM Elements
const els = {
    btnSelect: document.getElementById('select-folder-btn'),
    searchInput: document.getElementById('search-input'),
    filenameFilter: document.getElementById('filename-filter'),
    modelFilter: document.getElementById('model-filter'),
    loraFilter: document.getElementById('lora-filter'),
    sortFilter: document.getElementById('sort-filter'),
    autoUpdateCb: document.getElementById('auto-update-cb'),
    galleryGrid: document.getElementById('gallery-grid'),
    resultsCount: document.getElementById('results-count'),
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
    modalPromptBadge: document.getElementById('modal-prompt-badge'),
    btnDelete: document.getElementById('delete-image-btn')
};

// --- IDB Storage for Folder Caching ---
const dbName = 'ComfyUIGalleryDB';
const storeName = 'handles';

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveHandle(handle) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(handle, 'lastDirectory');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function loadHandle() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get('lastDirectory');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
// ------------------------------------

// Initialization
async function init() {
    els.btnSelect.addEventListener('click', handleFolderSelection);
    els.searchInput.addEventListener('input', handleFilterChange);
    els.filenameFilter.addEventListener('input', handleFilterChange);
    els.modelFilter.addEventListener('change', handleFilterChange);
    els.loraFilter.addEventListener('change', handleFilterChange);
    els.sortFilter.addEventListener('change', handleFilterChange);
    els.autoUpdateCb.addEventListener('change', toggleAutoUpdate);
    els.btnDelete.addEventListener('click', deleteImage);
    els.btnCloseModal.addEventListener('click', closeModal);
    
    // Close modal on escape or clicking backdrop
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'ArrowLeft') navigateImage(-1);
        if (e.key === 'ArrowRight') navigateImage(1);
    });
    els.modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeModal();
    });
    
    // Attempt Auto-load
    try {
        const cachedHandle = await loadHandle();
        if (cachedHandle) {
            // Verify permission
            const permission = await cachedHandle.queryPermission({ mode: 'read' });
            if (permission === 'granted') {
                els.statusText.textContent = "Automatically reusing cached folder...";
                await processDirectory(cachedHandle);
            } else {
                // If permission dropped (e.g. browser restart), we can ask for it when they click the button, 
                // but let's change the button text to make it easy
                els.btnSelect.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Re-open ${cachedHandle.name}`;
                els.statusText.textContent = `Click to re-authorize access to '${cachedHandle.name}'`;
                
                // Override click handler for this specific situation
                const oldBtn = els.btnSelect;
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);
                els.btnSelect = newBtn;
                
                els.btnSelect.addEventListener('click', async () => {
                    const reqPerm = await cachedHandle.requestPermission({ mode: 'read' });
                    if (reqPerm === 'granted') {
                        // Reset button
                        els.btnSelect.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder`;
                        els.btnSelect.addEventListener('click', handleFolderSelection);
                        await processDirectory(cachedHandle);
                    }
                });
            }
        }
    } catch (e) {
        console.warn("Could not load cached directory handle", e);
    }
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

        // Determine if it's workflow (has .nodes array) or prompt (nodes are top level object values)
        let nodes = [];
        if (data.nodes && Array.isArray(data.nodes)) {
            nodes = data.nodes;
        } else {
            nodes = Object.values(data);
        }
        
        let positiveText = [];
        let standardModel = 'Unknown';
        let customModel = null;
        let standardLoras = [];
        let customLoras = [];

        nodes.forEach(node => {
            if (!node || typeof node !== 'object') return;
            
            const classType = node.class_type || node.type || '';
            const title = node.title || '';
            
            if (!classType) return;

            // Helper to get widgets
            const wValues = node.widgets_values || node.widget_values || (node.inputs && (node.inputs.widgets_values || node.inputs.widget_values));
            const lowerTitle = title.toLowerCase();

            // Extract Base Model
            if (lowerTitle === 'checkpoint' || lowerTitle.includes('checkpoint') || lowerTitle === 'ckpt' || lowerTitle.includes('ckpt')) {
                // User specifies only looking in widget_values
                if (wValues && Array.isArray(wValues)) {
                    // Flatten since it may be an array of arrays
                    const flatValues = wValues.flat(Infinity);
                    const strVal = flatValues.find(v => typeof v === 'string' && (v.includes('/') || v.includes('\\') || v.endsWith('.safetensors')));
                    if (strVal) customModel = strVal.replace(/\.safetensors$/i, '');
                }
            } else if (classType.includes('Model Cycler')) {
                // Fallback for Model Cycler
                if (wValues && Array.isArray(wValues)) {
                    const cyclerVal = wValues.find(v => v && typeof v === 'object' && v.current_model_name);
                    if (cyclerVal) customModel = cyclerVal.current_model_name.replace(/\.safetensors$/i, '');
                }
            } else if (classType === 'CheckpointLoaderSimple' || classType.includes('Checkpoint')) {
                if (node.inputs && node.inputs.ckpt_name) {
                    standardModel = node.inputs.ckpt_name.replace(/\.safetensors$/i, '');
                } else if (wValues && Array.isArray(wValues)) {
                    const flatValues = wValues.flat(Infinity);
                    const strVal = flatValues.find(v => typeof v === 'string');
                    if (strVal) standardModel = strVal.replace(/\.safetensors$/i, '');
                }
            }

            // Extract LoRAs
            if (lowerTitle === 'lora stack' || lowerTitle.includes('lora stack')) {
                if (wValues && Array.isArray(wValues)) {
                    const traverse = (item) => {
                        if (Array.isArray(item)) {
                            // If the first element is a string and looks like a Lora path
                            if (item.length > 0 && typeof item[0] === 'string' && item[0].trim().toLowerCase() !== 'none' && 
                               (item[0].includes('.safetensors') || item[0].includes('/') || item[0].includes('\\'))) {
                                customLoras.push(item[0].trim().replace(/\.safetensors$/i, ''));
                            } else {
                                // Otherwise, search recursively into this array
                                item.forEach(traverse);
                            }
                        } else if (typeof item === 'string' && item.includes('.safetensors')) {
                            // Fallback for strings containing comma-separated formats
                            const parts = item.split(',');
                            const loraName = parts[0].trim();
                            if (loraName && loraName.toLowerCase() !== 'none') {
                                customLoras.push(loraName.replace(/\.safetensors$/i, ''));
                            }
                        }
                    };
                    traverse(wValues);
                }
            } else if (classType.includes('Lora Cycler')) {
                // Fallback for Lora Cycler
                if (wValues && Array.isArray(wValues)) {
                    const cyclerVal = wValues.find(v => v && typeof v === 'object' && v.current_lora_name);
                    if (cyclerVal && cyclerVal.current_lora_name.toLowerCase() !== 'none') {
                        customLoras.push(cyclerVal.current_lora_name.replace(/\.safetensors$/i, ''));
                    }
                }
            } else if (classType === 'LoraLoader' || classType === 'LoraLoaderModelOnly') {
                if (node.inputs && node.inputs.lora_name) {
                    standardLoras.push(node.inputs.lora_name.replace(/\.safetensors$/i, ''));
                } else if (wValues && Array.isArray(wValues)) {
                    const flatValues = wValues.flat(Infinity);
                    const strVal = flatValues.find(v => typeof v === 'string');
                    if (strVal) standardLoras.push(strVal.replace(/\.safetensors$/i, ''));
                }
            }

            // Extract Prompts (heuristics: looking for CLIPTextEncode)
            if (classType === 'CLIPTextEncode') {
                if (node.inputs && typeof node.inputs.text === 'string') {
                    positiveText.push(node.inputs.text);
                } else if (wValues && Array.isArray(wValues) && typeof wValues[0] === 'string') {
                    positiveText.push(wValues[0]);
                }
            }
        });

        // Resolve Overrides
        result.model = customModel || standardModel;
        result.loras = customLoras.length > 0 ? customLoras : standardLoras;

        if (positiveText.length > 0) {
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
        const arrayBuffer = await file.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        
        // Check PNG signature: 137 80 78 71 13 10 26 10
        if (dataView.getUint32(0) !== 0x89504e47 || dataView.getUint32(4) !== 0x0d0a1a0a) {
            return defaultData;
        }

        let offset = 8;
        let promptMetadata = null;
        let workflowMetadata = null;
        let rawJson = {};

        while (offset < arrayBuffer.byteLength) {
            const length = dataView.getUint32(offset);
            const type = String.fromCharCode(
                dataView.getUint8(offset + 4),
                dataView.getUint8(offset + 5),
                dataView.getUint8(offset + 6),
                dataView.getUint8(offset + 7)
            );
            
            if (type === 'tEXt' || type === 'iTXt') {
                const chunkDataView = new Uint8Array(arrayBuffer, offset + 8, length);
                const decoder = new TextDecoder('utf-8'); 
                
                if (type === 'tEXt') {
                    let nullIdx = 0;
                    for (let i = 0; i < chunkDataView.length; i++) {
                        if (chunkDataView[i] === 0) {
                            nullIdx = i;
                            break;
                        }
                    }
                    const keyword = decoder.decode(chunkDataView.subarray(0, nullIdx));
                    const textStr = decoder.decode(chunkDataView.subarray(nullIdx + 1));
                    
                    if (keyword === 'prompt') {
                        promptMetadata = extractComfyUIMetadata(textStr);
                        try { rawJson.prompt = JSON.parse(textStr); } catch(e){}
                    } else if (keyword === 'workflow') {
                        workflowMetadata = extractComfyUIMetadata(textStr);
                        try { rawJson.workflow = JSON.parse(textStr); } catch(e){}
                    }
                }
            } else if (type === 'IEND') {
                break;
            }
            offset += 12 + length;
        }

        if (promptMetadata || workflowMetadata) {
            const merged = { ...defaultData };
            
            const getBest = (key, defaultVal) => {
                let vP = promptMetadata ? promptMetadata[key] : null;
                let vW = workflowMetadata ? workflowMetadata[key] : null;
                
                if (key === 'loras') {
                    const combined = new Set([...(vP || []), ...(vW || [])]);
                    return Array.from(combined);
                }
                
                if (vP && vP !== defaultVal) return vP;
                if (vW && vW !== defaultVal) return vW;
                return defaultVal;
            };

            merged.model = getBest('model', 'Unknown');
            merged.loras = getBest('loras', []);
            merged.positivePrompt = getBest('positivePrompt', 'No metadata found');
            merged.raw = rawJson;
            
            return merged;
        }
        
    } catch (e) {
        console.warn(`Failed to parse PNG metadata for ${file.name}`, e);
    }
    
    return defaultData;
}

async function processDirectory(dirHandle) {
    els.btnSelect.disabled = true;
    els.loadingSpinner.classList.remove('hidden');
    els.galleryGrid.innerHTML = '';
    
    // Clear state
    state.images = [];
    state.models.clear();
    state.loras.clear();
    if (state.watchInterval) clearInterval(state.watchInterval);
    
    // Scan directory
    state.currentDirHandle = dirHandle;
    await scanDirectory(dirHandle);
    
    // Populate UI
    updateFiltersUI();
    handleFilterChange();
    
    // Enable controls
    els.searchInput.disabled = false;
    els.filenameFilter.disabled = false;
    els.modelFilter.disabled = false;
    els.loraFilter.disabled = false;
    els.sortFilter.disabled = false;
    els.autoUpdateCb.disabled = false;
    els.btnSelect.disabled = false;
    
    // Restore default button text in case it was the "Re-open" button
    els.btnSelect.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder`;
    // Ensure the main listener is attached
    els.btnSelect.removeEventListener('click', handleFolderSelection);
    els.btnSelect.addEventListener('click', handleFolderSelection);
    
    els.statusText.textContent = `Loaded ${state.images.length} images from ${dirHandle.name}.`;
    els.loadingSpinner.classList.add('hidden');
    
    // Start background watcher if enabled
    if (els.autoUpdateCb.checked) {
        state.watchInterval = setInterval(checkDirectoryForChanges, 15000);
    }
}

function toggleAutoUpdate() {
    if (els.autoUpdateCb.checked) {
        if (!state.watchInterval && state.currentDirHandle) {
            state.watchInterval = setInterval(checkDirectoryForChanges, 15000);
            els.statusText.textContent = "Auto-update enabled (15s).";
        }
    } else {
        if (state.watchInterval) {
            clearInterval(state.watchInterval);
            state.watchInterval = null;
            els.statusText.textContent = "Auto-update disabled.";
        }
    }
}

// Background poller for auto-updates
async function checkDirectoryForChanges() {
    if (!state.currentDirHandle || state.isChecking) return;
    state.isChecking = true;
    
    try {
        const currentFileNames = new Set(state.images.map(img => img.data.name));
        let newFiles = [];
        let foundNames = new Set();
        
        for await (const entry of state.currentDirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.png')) {
                foundNames.add(entry.name);
                if (!currentFileNames.has(entry.name)) {
                    const file = await entry.getFile();
                    newFiles.push(file);
                }
            }
        }
        
        let changed = false;
        
        // Handle deletions outside of the app
        const deletedNames = [...currentFileNames].filter(name => !foundNames.has(name));
        if (deletedNames.length > 0) {
            state.images = state.images.filter(img => !deletedNames.includes(img.data.name));
            changed = true;
        }
        
        // Handle additions
        if (newFiles.length > 0) {
            await processBatch(newFiles, true); 
            changed = true;
        }
        
        if (changed) {
            updateFiltersUI();
            handleFilterChange();
            els.statusText.textContent = `Auto-updated. Loaded ${state.images.length} images from ${state.currentDirHandle.name}.`;
        }
    } catch (err) {
        // Handle permission loss gracefully (e.g., folder moved or browser revoked read access)
        console.warn("Background watcher lost permission or error:", err);
        if (state.watchInterval) {
            clearInterval(state.watchInterval);
            state.watchInterval = null;
        }
        els.statusText.textContent = "Auto-update paused. Click 'Select Folder' to reconnect.";
    } finally {
        state.isChecking = false;
    }
}

async function handleFolderSelection() {
    try {
        const dirHandle = await window.showDirectoryPicker({
            id: 'comfyui-gallery', 
            mode: 'read',
            startIn: 'pictures' 
        });
        
        els.statusText.textContent = `Scanning directory: ${dirHandle.name}...`;
        
        // Save for next reload
        await saveHandle(dirHandle);
        
        await processDirectory(dirHandle);
        
    } catch (err) {
        console.error(err);
        if (err.name !== 'AbortError') {
            els.statusText.textContent = `Error: ${err.message}. Please select a valid folder.`;
        } else {
            els.statusText.textContent = 'Folder selection cancelled.';
        }
        els.btnSelect.disabled = false;
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

async function processBatch(filesBatch, silent = false) {
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
            lastModified: file.lastModified,
            data: metadata
        };
    });
    
    const results = await Promise.all(parsePromises);
    state.images.push(...results);
    if (!silent) els.statusText.textContent = `Found ${state.images.length} images... please wait...`;
}

function updateFiltersUI() {
    const getDisplayName = (pathStr) => pathStr.includes('/') ? pathStr.split('/').pop() : (pathStr.includes('\\') ? pathStr.split('\\').pop() : pathStr);
    
    // Save current selections
    const currentModel = els.modelFilter.value;
    const currentLora = els.loraFilter.value;

    // Models (case-insensitive alphabetical sort by display name)
    const models = Array.from(state.models).sort((a, b) => {
        return getDisplayName(a).toLowerCase().localeCompare(getDisplayName(b).toLowerCase());
    });
    
    els.modelFilter.innerHTML = '<option value="">All Models</option>';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        // Show just the filename if it's a path
        option.textContent = getDisplayName(model);
        els.modelFilter.appendChild(option);
    });
    
    // Restore model if still exists
    if (models.includes(currentModel)) els.modelFilter.value = currentModel;

    // LoRAs (case-insensitive alphabetical sort by display name)
    const loras = Array.from(state.loras).sort((a, b) => {
        return getDisplayName(a).toLowerCase().localeCompare(getDisplayName(b).toLowerCase());
    });
    els.loraFilter.innerHTML = '<option value="">All LoRAs</option>';
    
    // Add "No LoRA" option
    const noLoraOption = document.createElement('option');
    noLoraOption.value = '__no_lora__';
    noLoraOption.textContent = 'No LoRA';
    els.loraFilter.appendChild(noLoraOption);

    loras.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora;
        option.textContent = getDisplayName(lora); // Show just filename if path exists
        els.loraFilter.appendChild(option);
    });
    
    // Restore Lora if still exists
    if (loras.includes(currentLora) || currentLora === '__no_lora__') els.loraFilter.value = currentLora;
}

function handleFilterChange() {
    state.searchQuery = els.searchInput.value.toLowerCase();
    state.filenameQuery = els.filenameFilter.value.toLowerCase();
    state.selectedModel = els.modelFilter.value;
    state.selectedLora = els.loraFilter.value;
    state.sortBy = els.sortFilter.value;
    
    state.filteredImages = state.images.filter(img => {
        // Global Search Filter
        const matchesSearch = !state.searchQuery || 
                              img.data.name.toLowerCase().includes(state.searchQuery) ||
                              img.data.model.toLowerCase().includes(state.searchQuery) ||
                              img.data.loras.some(l => l.toLowerCase().includes(state.searchQuery));
                              
        // Specific Filename Filter
        const matchesFilename = !state.filenameQuery || img.data.name.toLowerCase().includes(state.filenameQuery);
                              
        // Model Filter (exact match on full path inside state)
        const matchesModel = !state.selectedModel || img.data.model === state.selectedModel;
        
        // LoRA Filter
        const matchesLora = !state.selectedLora ? true : 
                          (state.selectedLora === '__no_lora__' ? img.data.loras.length === 0 : img.data.loras.includes(state.selectedLora));
        
        return matchesSearch && matchesFilename && matchesModel && matchesLora;
    });
    
    // Apply Sorting
    state.filteredImages.sort((a, b) => {
        if (state.sortBy === 'date-desc') {
            return b.lastModified - a.lastModified;
        } else if (state.sortBy === 'date-asc') {
            return a.lastModified - b.lastModified;
        } else if (state.sortBy === 'name-asc') {
            return a.data.name.localeCompare(b.data.name);
        } else if (state.sortBy === 'name-desc') {
            return b.data.name.localeCompare(a.data.name);
        }
        return 0;
    });
    
    renderGallery();
}

function renderGallery() {
    els.galleryGrid.innerHTML = '';
    
    // Update results count
    if (state.images.length > 0) {
        els.resultsCount.style.display = 'block';
        els.resultsCount.textContent = `${state.filteredImages.length} result${state.filteredImages.length !== 1 ? 's' : ''}`;
    } else {
        els.resultsCount.style.display = 'none';
    }
    
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
                ${img.data.loras.length === 1 ? `<div class="card-model" title="${img.data.loras[0]}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    ${img.data.loras[0].length > 25 ? img.data.loras[0].substring(0, 25) + '...' : img.data.loras[0]}
                </div>` : img.data.loras.length > 1 ? `<div class="card-model">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    ${img.data.loras.length} LoRAs
                </div>` : ''}
            </div>
        `;
        
        fragment.appendChild(card);
    });
    
    els.galleryGrid.appendChild(fragment);
}

function openImageModal(img) {
    state.currentActiveImg = img;
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
    state.currentActiveImg = null;
    // Note: Intentionally not clearing els.modalImage.src to prevent flicker on rapid close/open,
    // though we could to free up memory if users view many very large images. URL.createObjectURL manages memory fine on its own mostly.
}

function navigateImage(direction) {
    if (els.modal.classList.contains('hidden') || !state.currentActiveImg || state.filteredImages.length === 0) return;
    
    const currentIndex = state.filteredImages.findIndex(img => img === state.currentActiveImg);
    if (currentIndex === -1) return;
    
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = state.filteredImages.length - 1;
    if (nextIndex >= state.filteredImages.length) nextIndex = 0;
    
    openImageModal(state.filteredImages[nextIndex]);
}

async function deleteImage() {
    if (!state.currentActiveImg || !state.currentDirHandle) return;
    
    const confirmDelete = confirm(`Are you sure you want to permanently delete '${state.currentActiveImg.data.name}' from your file system?`);
    if (!confirmDelete) return;
    
    const filename = state.currentActiveImg.data.name;
    const oldBtnContent = els.btnDelete.innerHTML;
    els.btnDelete.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>';
    
    try {
        // We first need readwrite permission to delete
        const permission = await state.currentDirHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            const reqPerm = await state.currentDirHandle.requestPermission({ mode: 'readwrite' });
            if (reqPerm !== 'granted') {
                alert("Write permissions are required to delete files.");
                els.btnDelete.innerHTML = oldBtnContent;
                return;
            }
        }
        
        await state.currentDirHandle.removeEntry(filename);
        
        // Remove from memory
        state.images = state.images.filter(img => img.data.name !== filename);
        state.filteredImages = state.filteredImages.filter(img => img.data.name !== filename);
        
        // Re-render and close
        renderGallery();
        closeModal();
        
        els.statusText.textContent = `Deleted ${filename}. Loaded ${state.images.length} images.`;
    } catch (err) {
        console.error("Failed to delete file:", err);
        alert(`Failed to delete file: ${err.message}`);
    } finally {
        els.btnDelete.innerHTML = oldBtnContent;
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
