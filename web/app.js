// App State
const SUPPORTED_EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg'];

function isSupportedImage(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

const state = {
    images: [], // { file, url, data: { name, model, loras, prompt, raw } }
    filteredImages: [],
    models: new Set(),
    loras: new Set(),
    isScanning: false,
    currentView: 'images', // 'images' or 'prefixes'
    
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
    isChecking: false,

    // Zoom/Pan State
    zoom: 1,
    pan: { x: 0, y: 0 },
    isDragging: false,
    lastMousePos: { x: 0, y: 0 },

    // Settings
    settings: {
        constrainWidth: true,
        sideMargin: 2, // 2% default
        itemMinWidth: 280,
        aspectRatio: '1'
    }
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
    btnClearFilters: document.getElementById('clear-filters-btn'),
    btnClearSearch: document.getElementById('clear-search-btn'),
    
    // Modal
    modal: document.getElementById('image-modal'),
    btnCloseModal: document.getElementById('close-modal-btn'),
    modalImage: document.getElementById('modal-image'),
    modalFilename: document.getElementById('modal-filename'),
    modalModel: document.getElementById('modal-model'),
    modalLoras: document.getElementById('modal-loras'),
    modalPositive: document.getElementById('modal-positive'),
    modalNegative: document.getElementById('modal-negative'),
    modalRawJson: document.getElementById('modal-raw-json'),
    modalRawParameters: document.getElementById('modal-raw-parameters'),
    modalParametersSection: document.getElementById('modal-parameters-section'),
    modalSettingsSection: document.getElementById('modal-settings-section'),
    modalSteps: document.getElementById('modal-steps'),
    modalCfg: document.getElementById('modal-cfg'),
    modalSampler: document.getElementById('modal-sampler'),
    modalSize: document.getElementById('modal-size'),
    modalSeed: document.getElementById('modal-seed'),
    btnDelete: document.getElementById('delete-image-btn'),
    btnPrev: document.getElementById('prev-image-btn'),
    btnNext: document.getElementById('next-image-btn'),
    btnCopyPositive: document.getElementById('copy-positive-btn'),
    btnCopyNegative: document.getElementById('copy-negative-btn'),
    btnSendAll: document.getElementById('send-all-btn'),
    modalSidebar: document.querySelector('.modal-sidebar'),
    modalImageContainer: document.querySelector('.modal-image-container'),

    // Settings UI
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('close-settings-btn'),
    btnSaveSettings: document.getElementById('save-settings-btn'),
    settingConstrainWidth: document.getElementById('setting-constrain-width'),
    settingSideMargin: document.getElementById('setting-side-margin'),
    settingSideMarginVal: document.getElementById('setting-side-margin-val'),
    settingItemWidth: document.getElementById('setting-item-width'),
    settingItemWidthVal: document.getElementById('setting-item-width-val'),
    settingAspectRatio: document.getElementById('setting-aspect-ratio'),

    // Edit Metadata UI
    btnEditMetadata: document.getElementById('edit-metadata-btn'),
    editMetadataModal: document.getElementById('edit-metadata-modal'),
    btnCloseEditMetadata: document.getElementById('close-edit-metadata-btn'),
    btnSaveMetadata: document.getElementById('save-metadata-btn'),
    editMetadataTextarea: document.getElementById('edit-metadata-textarea'),
    editMetadataStatus: document.getElementById('edit-metadata-status'),
    
    // View switches
    btnViewGallery: document.getElementById('view-gallery-btn'),
    btnViewPrefixes: document.getElementById('view-prefixes-btn')
};

// --- IDB Storage for Folder Caching & Metadata ---
const dbName = 'ComfyUIGalleryDB_v2';
const storeHandles = 'handles';
const storeMetadata = 'metadata';

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeHandles)) db.createObjectStore(storeHandles);
            if (!db.objectStoreNames.contains(storeMetadata)) db.createObjectStore(storeMetadata);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveHandle(handle) {
    const db = await initDB();
    const tx = db.transaction(storeHandles, 'readwrite');
    tx.objectStore(storeHandles).put(handle, 'lastDirectory');
}

async function loadHandle() {
    const db = await initDB();
    const tx = db.transaction(storeHandles, 'readonly');
    return new Promise((resolve) => {
        const req = tx.objectStore(storeHandles).get('lastDirectory');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function saveToDB(imgData) {
    const db = await initDB();
    const tx = db.transaction(storeMetadata, 'readwrite');
    // Store metadata keyed by filename
    tx.objectStore(storeMetadata).put(imgData, imgData.data.name);
}

async function loadFromDB(filename) {
    const db = await initDB();
    const tx = db.transaction(storeMetadata, 'readonly');
    return new Promise((resolve) => {
        const req = tx.objectStore(storeMetadata).get(filename);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}
// ------------------------------------

// Initialization
async function init() {
    els.btnSelect.addEventListener('click', handleFolderSelection);
    
    // Fetch suggested output path from ComfyUI
    try {
        const response = await fetch('/api/gallery/output_path');
        const data = await response.json();
        if (data && data.path) {
            state.suggestedPath = data.path;
            els.btnSelect.title = `Suggested: ${data.path}`;
            if (!state.currentDirHandle) {
                els.statusText.textContent = `Hint: Select your ComfyUI output folder at ${data.path}`;
            }
        }
    } catch (e) {
        console.warn("Failed to fetch suggested output path:", e);
    }

    els.searchInput.addEventListener('input', handleFilterChange);
    els.filenameFilter.addEventListener('input', handleFilterChange);
    els.modelFilter.addEventListener('change', handleFilterChange);
    els.loraFilter.addEventListener('change', handleFilterChange);
    els.sortFilter.addEventListener('change', handleFilterChange);
    els.btnClearFilters.addEventListener('click', clearFilters);
    els.btnClearSearch.addEventListener('click', clearSearch);
    els.autoUpdateCb.addEventListener('change', toggleAutoUpdate);
    els.btnDelete.addEventListener('click', deleteImage);
    els.btnPrev.addEventListener('click', () => navigateImage(-1));
    els.btnNext.addEventListener('click', () => navigateImage(1));
    els.btnCopyPositive.addEventListener('click', () => copyToClipboard(els.modalPositive.textContent, els.btnCopyPositive));
    els.btnCopyNegative.addEventListener('click', () => copyToClipboard(els.modalNegative.textContent, els.btnCopyNegative));
    els.btnSendAll.addEventListener('click', sendAllToComfyUI);
    els.btnCloseModal.addEventListener('click', closeModal);

    // View Switcher Listeners
    els.btnViewGallery.addEventListener('click', () => switchView('images'));
    els.btnViewPrefixes.addEventListener('click', () => switchView('prefixes'));
    els.btnViewGallery.disabled = true;
    els.btnViewPrefixes.disabled = true;

    // Settings Listeners
    els.settingsBtn.addEventListener('click', openSettings);
    els.btnCloseSettings.addEventListener('click', closeSettings);
    els.btnSaveSettings.addEventListener('click', saveAndApplySettings);
    els.settingItemWidth.addEventListener('input', (e) => {
        els.settingItemWidthVal.textContent = `${e.target.value}px`;
    });
    els.settingSideMargin.addEventListener('input', (e) => {
        els.settingSideMarginVal.textContent = `${e.target.value}%`;
    });

    // Edit Metadata Listeners
    els.btnEditMetadata.addEventListener('click', openEditMetadata);
    els.btnCloseEditMetadata.addEventListener('click', closeEditMetadata);
    els.btnSaveMetadata.addEventListener('click', saveEditMetadata);
    
    // Load Saved Settings
    loadSettings();
    
    // Filter from Modal
    els.modalModel.addEventListener('click', () => {
        if (state.currentActiveImg && state.currentActiveImg.data.model !== 'Unknown') {
            els.modelFilter.value = state.currentActiveImg.data.model;
            handleFilterChange();
            closeModal();
        }
    });

    els.modalLoras.addEventListener('click', (e) => {
        const loraTag = e.target.closest('.lora-tag');
        if (loraTag && !loraTag.classList.contains('empty-state')) {
            const loraName = loraTag.dataset.loraName || loraTag.textContent.trim();
            els.loraFilter.value = loraName;
            handleFilterChange();
            closeModal();
        }
    });
    
    // Close modal on escape or clicking backdrop
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!els.editMetadataModal.classList.contains('hidden')) {
                closeEditMetadata();
            } else {
                closeModal();
            }
        }
        
        if (e.key === 'ArrowLeft') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            navigateImage(-1);
        }
        if (e.key === 'ArrowRight') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            navigateImage(1);
        }
        
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!els.modal.classList.contains('hidden') && state.currentActiveImg) {
                e.preventDefault();
                deleteImage();
            }
        }
    });
    els.modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') || e.target.classList.contains('modal-backdrop')) closeModal();
    });
    els.settingsModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') || e.target.classList.contains('modal-backdrop')) closeSettings();
    });
    els.editMetadataModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') || e.target.classList.contains('modal-backdrop')) closeEditMetadata();
    });

    // Zoom and Pan Listeners
    els.modalImageContainer.addEventListener('wheel', handleWheel, { passive: false });
    els.modalImageContainer.addEventListener('mousedown', startPan);
    window.addEventListener('mousemove', handlePan);
    window.addEventListener('mouseup', stopPan);
    
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

// Helper to strip paths and extensions from model/lora names
const normalizeName = (name, keepAll = false) => {
    if (!name || typeof name !== 'string') return name;
    if (keepAll) return name.trim();
    return name.split(/[/\\]/).pop().replace(/\.safetensors$/i, '').trim();
};

/**
 * Parses the standard A1111-style multi-line metadata format
 * used by LoRA Manager and other SD tools.
 */
function parseStandardMetadata(text) {
    if (!text || typeof text !== 'string') return null;

    const result = {
        model: 'Unknown',
        loras: [],
        positivePrompt: '',
        negativePrompt: '',
        seed: null,
        steps: null,
        sampler: null,
        cfg: null,
        size: null,
        raw: text
    };

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;

    // The format is typically:
    // [Positive Prompt]
    // Negative prompt: [Negative Prompt]
    // Steps: 20, Sampler: Euler, ... Model: model_name, ...
    
    let lastPart = lines[lines.length - 1];
    let paramsSection = '';
    let negativeSection = '';
    let positiveLines = [];

    // Check if the last line contains key parameters
    if (lastPart.includes('Steps:') || lastPart.includes('Seed:')) {
        paramsSection = lines.pop();
    }

    // Identify Negative Prompt line
    const negIdx = lines.findIndex(l => l.startsWith('Negative prompt:'));
    if (negIdx !== -1) {
        negativeSection = lines[negIdx].replace('Negative prompt:', '').trim();
        positiveLines = lines.slice(0, negIdx);
    } else {
        positiveLines = lines;
    }

    result.positivePrompt = positiveLines.join('\n');
    result.negativePrompt = negativeSection;

    // Parse Parameters (comma separated k: v pairs)
    if (paramsSection) {
        const parts = paramsSection.split(',').map(p => p.trim());
        parts.forEach(part => {
            const [key, ...valParts] = part.split(':').map(v => v.trim());
            const val = valParts.join(':');
            
            if (key === 'Model') {
                result.model = normalizeName(val, true);
            } else if (key === 'Seed') {
                result.seed = val;
            } else if (key === 'Steps') {
                result.steps = val;
            } else if (key === 'Sampler') {
                result.sampler = val;
            } else if (key === 'CFG scale') {
                result.cfg = val;
            } else if (key === 'Scheduler') {
                result.scheduler = val;
            } else if (key === 'Size') {
                result.size = val;
            } else if (key === 'Lora hashes') {
                // Example: Lora hashes: "lora1: abc, lora2: def"
                const loraNames = val.match(/"([^"]+)"/);
                if (loraNames) {
                    loraNames[1].split(',').forEach(l => {
                        const lName = l.split(':')[0].trim();
                        if (lName) result.loras.push({ name: normalizeName(lName), weight: 1.0 });
                    });
                }
            }
        });
    }

    // Extract LoRAs from prompt if they are in <lora:name:strength> format
    const loraMatches = result.positivePrompt.match(/<lora:([^:]+):([^>]+)>/g);
    if (loraMatches) {
        loraMatches.forEach(m => {
            const match = m.match(/<lora:([^:]+):([^>]+)>/);
            const name = match[1];
            const weight = parseFloat(match[2]);
            if (name) {
                result.loras.push({ 
                    name: normalizeName(name), 
                    weight: isNaN(weight) ? 1.0 : weight 
                });
            }
        });
    }
    
    // Deduplicate LoRAs by name, keeping the first one found (usually the one from the prompt has the weight)
    const uniqueLoras = [];
    const seenNames = new Set();
    for (const lora of result.loras) {
        if (!seenNames.has(lora.name)) {
            seenNames.add(lora.name);
            uniqueLoras.push(lora);
        }
    }
    result.loras = uniqueLoras;
    return result;
}

// Helper to extract a balanced JSON string from a larger text
function extractBalancedJson(text, startIdx) {
    if (startIdx === -1) return null;
    let depth = 0;
    let firstBrace = text.indexOf('{', startIdx);
    if (firstBrace === -1) return null;

    for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;

        if (depth === 0) {
            return text.substring(firstBrace, i + 1);
        }
    }
    return null;
}


// Extract specific nodes from ComfyUI Workflow/Prompt JSON
function extractComfyUIMetadata(jsonStr) {
    const result = {
        model: 'Unknown',
        loras: [],
        positivePrompt: '',
        negativePrompt: '',
        seed: null,
        steps: null,
        cfg: null,
        sampler: null,
        scheduler: null,
        cyclers: [],
        raw: null
    };

    try {
        const data = JSON.parse(jsonStr);
        result.raw = data;

        // Determine if it's workflow (has .nodes array) or prompt (nodes are top level object values)
        const isWorkflow = !!(data.nodes && Array.isArray(data.nodes));
        let nodesArray = [];
        let usedNodeIds = new Set();

        if (isWorkflow) {
            nodesArray = data.nodes;
        } else {
            // Prompt format: track which nodes are referenced as inputs
            Object.values(data).forEach(node => {
                if (node.inputs) {
                    Object.values(node.inputs).forEach(input => {
                        if (Array.isArray(input) && input.length >= 2) {
                            usedNodeIds.add(String(input[0]));
                        }
                    });
                }
            });
            // Convert to array and include ID
            nodesArray = Object.entries(data).map(([id, node]) => ({ ...node, id }));
        }

        const nodeMap = new Map();
        nodesArray.forEach(node => {
            if (node && node.id) nodeMap.set(String(node.id), node);
        });
        
        let positiveTexts = [];
        let negativeTexts = [];
        let standardModel = 'Unknown';
        let customModel = null;
        let customLoras = [];

        // Helper to trace back from a node input
        const traceInput = (node, inputName) => {
            if (!node || !node.inputs) return null;
            let sourceId = null;

            if (isWorkflow) {
                const inputs = Array.isArray(node.inputs) ? node.inputs : Object.values(node.inputs);
                const inputEntry = inputs.find(i => i.name === inputName);
                if (inputEntry && inputEntry.link) {
                    const link = data.links && data.links.find(l => l[0] === inputEntry.link);
                    if (link) sourceId = link[1];
                }
            } else {
                const inputEntry = node.inputs[inputName];
                if (Array.isArray(inputEntry) && inputEntry.length >= 2) {
                    sourceId = inputEntry[0];
                }
            }
            return sourceId ? String(sourceId) : null;
        };

        const getPromptFromNode = (nodeId) => {
            const node = nodeMap.get(String(nodeId));
            if (!node) return null;
            const type = (node.class_type || node.type || '').toLowerCase();
            if (type.includes('prompt') || type.includes('text')) {
                const wValues = node.widgets_values || node.widget_values || (node.inputs && (node.inputs.widgets_values || node.inputs.widget_values));
                if (Array.isArray(wValues) && typeof wValues[0] === 'string') return wValues[0];
                if (node.inputs && typeof node.inputs.text === 'string') return node.inputs.text;
                if (Array.isArray(wValues)) return wValues.find(v => typeof v === 'string' && v.length > 3);
            }
            return null;
        };

        nodesArray.forEach(node => {
            if (!node || typeof node !== 'object') return;
            
            const classType = node.class_type || node.type || '';
            const title = node.title || '';
            const id = node.id;
            const classTypeLower = classType.toLowerCase();
            
            if (!classType) return;

            // Connectivity check
            const isHooked = isWorkflow ? 
                (node.outputs && node.outputs.some(o => o.links && o.links.length > 0)) :
                usedNodeIds.has(String(id));

            // Helper to get widgets
            const wValues = node.widgets_values || node.widget_values || (node.inputs && (node.inputs.widgets_values || node.inputs.widget_values));
            const lowerTitle = title.toLowerCase();

            // KSampler Tracing (Highest Priority for prompts)
            if (classTypeLower.includes('ksampler') || classTypeLower.includes('sampler')) {
                const posId = traceInput(node, 'positive');
                const negId = traceInput(node, 'negative');
                if (posId) {
                    const text = getPromptFromNode(posId);
                    if (text) positiveTexts.push(text);
                }
                if (negId) {
                    const text = getPromptFromNode(negId);
                    if (text) negativeTexts.push(text);
                }

                // Extract KSampler widgets
                if (node.inputs) {
                    if (node.inputs.seed !== undefined && result.seed === null) result.seed = node.inputs.seed;
                    if (node.inputs.steps !== undefined && result.steps === null) result.steps = node.inputs.steps;
                    if (node.inputs.cfg !== undefined && result.cfg === null) result.cfg = node.inputs.cfg;
                    if (node.inputs.sampler_name !== undefined && result.sampler === null) result.sampler = node.inputs.sampler_name;
                    if (node.inputs.scheduler !== undefined && result.scheduler === null) result.scheduler = node.inputs.scheduler;
                } else if (wValues && Array.isArray(wValues)) {
                    // Fallback for some formats where inputs are flat or missing
                    if (result.seed === null) result.seed = wValues[0];
                    if (result.steps === null) result.steps = wValues[2];
                    if (result.cfg === null) result.cfg = wValues[3];
                    if (result.sampler === null) result.sampler = wValues[4];
                    if (result.scheduler === null) result.scheduler = wValues[5];
                }
            }

            // Extract Base Model
            if (lowerTitle === 'checkpoint' || lowerTitle.includes('checkpoint') || lowerTitle === 'ckpt' || lowerTitle.includes('ckpt')) {
                if (wValues && Array.isArray(wValues)) {
                    const flatValues = wValues.flat(Infinity);
                    const strVal = flatValues.find(v => typeof v === 'string' && (v.includes('/') || v.includes('\\') || v.endsWith('.safetensors')));
                    if (strVal) customModel = normalizeName(strVal, true);
                }
            } else if (classType.includes('Model Cycler')) {
                if (wValues && Array.isArray(wValues)) {
                    const cyclerVal = wValues.find(v => v && typeof v === 'object' && v.current_model_name);
                    if (cyclerVal) {
                        const name = normalizeName(cyclerVal.current_model_name, true);
                        result.cyclers.push({ type: 'model', name, hooked: isHooked, title: title || classType });
                        if (isHooked) customModel = name;
                    }
                }
            } else if (classType === 'CheckpointLoaderSimple' || classType.includes('Checkpoint')) {
                if (node.inputs && node.inputs.ckpt_name) {
                    standardModel = normalizeName(node.inputs.ckpt_name, true);
                } else if (wValues && Array.isArray(wValues)) {
                    const flatValues = wValues.flat(Infinity);
                    const strVal = flatValues.find(v => typeof v === 'string');
                    if (strVal) standardModel = normalizeName(strVal, true);
                }
            }

            // Extract LoRAs
            if (lowerTitle === 'lora stack' || lowerTitle.includes('lora stack')) {
                if (wValues && Array.isArray(wValues)) {
                    const traverse = (item) => {
                        if (Array.isArray(item)) {
                            if (item.length > 0 && typeof item[0] === 'string' && item[0].trim().toLowerCase() !== 'none' && 
                               (item[0].includes('.safetensors') || item[0].includes('/') || item[0].includes('\\'))) {
                                const name = normalizeName(item[0].trim(), true);
                                const weight = item.length > 1 ? parseFloat(item[1]) : 1.0;
                                customLoras.push({ name, weight: isNaN(weight) ? 1.0 : weight });
                            } else {
                                item.forEach(traverse);
                            }
                        } else if (typeof item === 'string' && item.includes('.safetensors')) {
                            const parts = item.split(',');
                            const loraName = parts[0].trim();
                            if (loraName && loraName.toLowerCase() !== 'none') {
                                const name = normalizeName(loraName, true);
                                const weight = parts.length > 1 ? parseFloat(parts[1]) : 1.0;
                                customLoras.push({ name, weight: isNaN(weight) ? 1.0 : weight });
                            }
                        }
                    };
                    traverse(wValues);
                }
            } else if (classType.includes('Lora Cycler')) {
                if (wValues && Array.isArray(wValues)) {
                    const cyclerVal = wValues.find(v => v && typeof v === 'object' && v.current_lora_name);
                    if (cyclerVal && cyclerVal.current_lora_name.toLowerCase() !== 'none') {
                        const name = normalizeName(cyclerVal.current_lora_name, true);
                        result.cyclers.push({ type: 'lora', name, hooked: isHooked, title: title || classType });
                        if (isHooked) {
                            // Extract weight if available in cycler
                            const weight = cyclerVal.current_lora_weight !== undefined ? parseFloat(cyclerVal.current_lora_weight) : 1.0;
                            customLoras.push({ name, weight: isNaN(weight) ? 1.0 : weight });
                        }
                    }
                }
            }
            if (classType.includes('Lora Loader')) {
                if (wValues && Array.isArray(wValues)) {
                    for (const loras of wValues) {
                        if (Array.isArray(loras)) {
                            for (const lora of loras) {
                                if (lora && lora.name) {
                                    const weight = lora.strength !== undefined ? lora.strength : (lora.weight !== undefined ? lora.weight : 1.0);
                                    customLoras.push({ name: normalizeName(lora.name, true), weight: parseFloat(weight) || 1.0 });
                                }
                            }
                        }
                    }
                }
            }

            // Extract from Prompt Selection explicitly
            if (classType === 'Prompt Selection') {
                if (Array.isArray(wValues)) {
                    // Python node defines index 0:index, 1:control_after_generate, 2:prompt_data, 3:selected_positive, 4:selected_negative
                    if (wValues[3] && typeof wValues[3] === 'string') positiveTexts.push(wValues[3]);
                    if (wValues[4] && typeof wValues[4] === 'string') negativeTexts.push(wValues[4]);
                } else if (node.inputs) {
                    if (node.inputs.selected_positive && typeof node.inputs.selected_positive === 'string') {
                        positiveTexts.push(node.inputs.selected_positive);
                    }
                    if (node.inputs.selected_negative && typeof node.inputs.selected_negative === 'string') {
                        negativeTexts.push(node.inputs.selected_negative);
                    }
                }
            }

            // Heuristic Fallback for Prompts (if no sampler found or sampler trace failed)
            if (classType === 'CLIPTextEncode' || classType.includes('Positive Prompt')) {
                const text = getPromptFromNode(id);
                if (text && !positiveTexts.includes(text)) positiveTexts.push(text);
            }
        });

        // Resolve Overrides
        result.model = customModel || standardModel;
        
        // Deduplicate LoRAs by name
        const uniqueLoras = [];
        const seenNames = new Set();
        for (const lora of customLoras) {
            const loraName = typeof lora === 'string' ? lora : lora.name;
            const loraObj = typeof lora === 'string' ? { name: lora, weight: 1.0 } : lora;
            
            if (!seenNames.has(loraName)) {
                seenNames.add(loraName);
                uniqueLoras.push(loraObj);
            }
        }
        result.loras = uniqueLoras;

        if (positiveTexts.length > 0) {
            result.positivePrompt = Array.from(new Set(positiveTexts)).join('\n\n--- Also found ---\n');
        } else {
            result.positivePrompt = "No positive prompt string found.";
        }

        if (negativeTexts.length > 0) {
            result.negativePrompt = Array.from(new Set(negativeTexts)).join('\n\n--- Also found ---\n');
        } else {
            result.negativePrompt = "None detected.";
        }

    } catch (e) {
        console.error("Failed to parse ComfyUI JSON", e);
    }
    
    return result;
}

// Helper to merge and finalize metadata from different sources (prompt/workflow chunks)
function finalizeMetadata(defaultData, promptMetadata, workflowMetadata, rawJson) {
    const merged = { ...defaultData };
    
    const getBest = (key, defaultVal) => {
        // If we have a priority result (e.g. from 'parameters' chunk), trust it globally
        if (promptMetadata && promptMetadata.priorityResult && promptMetadata[key]) {
            if (key === 'loras' && promptMetadata[key].length > 0) return promptMetadata[key];
            if (key !== 'loras' && promptMetadata[key] !== defaultVal) return promptMetadata[key];
        }

        let vP = promptMetadata ? promptMetadata[key] : null;
        let vW = workflowMetadata ? workflowMetadata[key] : null;
        
        if (key === 'loras') {
            const combined = new Set();
            (vP || []).forEach(l => combined.add(JSON.stringify(l)));
            (vW || []).forEach(l => combined.add(JSON.stringify(l)));
            return Array.from(combined).map(l => JSON.parse(l));
        }
        
        if (vP && vP !== defaultVal) return vP;
        if (vW && vW !== defaultVal) return vW;
        return defaultVal;
    };

    merged.model = getBest('model', 'Unknown');
    merged.loras = getBest('loras', []);
    merged.positivePrompt = getBest('positivePrompt', 'No metadata found');
    merged.negativePrompt = getBest('negativePrompt', 'None detected');
    merged.seed = getBest('seed', null);
    merged.steps = getBest('steps', null);
    merged.cfg = getBest('cfg', null);
    merged.sampler = getBest('sampler', null);
    merged.scheduler = getBest('scheduler', null);
    merged.raw = rawJson;
    merged.parameters = promptMetadata ? promptMetadata.parameters : null;
    
    return merged;
}

// --- CRC-32 & PNG Chunk Rewriting Helper for Metadata Edit ---
const crcTable = [];
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        if (c & 1) {
            c = 0xedb88320 ^ (c >>> 1);
        } else {
            c = c >>> 1;
        }
    }
    crcTable[n] = c;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createPNGtEXtChunk(keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    const textBytes = encoder.encode(text);
    
    // tEXt format: keyword (null-terminated) + text
    const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    chunkData.set(keywordBytes, 0);
    chunkData[keywordBytes.length] = 0; // null separator
    chunkData.set(textBytes, keywordBytes.length + 1);
    
    const chunkType = new Uint8Array([116, 69, 88, 116]); // 'tEXt'
    
    const crcData = new Uint8Array(4 + chunkData.length);
    crcData.set(chunkType, 0);
    crcData.set(chunkData, 4);
    const crc = crc32(crcData);
    
    const chunk = new Uint8Array(4 + 4 + chunkData.length + 4);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, chunkData.length); // Length (big endian)
    chunk.set(chunkType, 4);            // Type
    chunk.set(chunkData, 8);            // Data
    view.setUint32(8 + chunkData.length, crc); // CRC (big endian)
    
    return chunk;
}

function updatePNGParameters(arrayBuffer, newParametersText) {
    const view = new DataView(arrayBuffer);
    const parts = [];
    
    // Check signature
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
        throw new Error("Not a valid PNG file");
    }
    
    // Write signature
    parts.push(new Uint8Array(arrayBuffer, 0, 8));
    
    let offset = 8;
    const decoder = new TextDecoder('utf-8');
    
    while (offset < arrayBuffer.byteLength) {
        const length = view.getUint32(offset);
        const type = decoder.decode(new Uint8Array(arrayBuffer, offset + 4, 4));
        
        let shouldKeep = true;
        if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            const chunkData = new Uint8Array(arrayBuffer, offset + 8, length);
            let nullIdx = -1;
            for (let i = 0; i < chunkData.length; i++) {
                if (chunkData[i] === 0) {
                    nullIdx = i;
                    break;
                }
            }
            if (nullIdx !== -1) {
                const keyword = decoder.decode(chunkData.subarray(0, nullIdx));
                if (keyword === 'parameters') {
                    shouldKeep = false; // remove old parameters
                }
            }
        }
        
        if (type === 'IEND') {
            // Insert new chunk before IEND
            const newChunk = createPNGtEXtChunk('parameters', newParametersText);
            parts.push(newChunk);
        }
        
        if (shouldKeep) {
            parts.push(new Uint8Array(arrayBuffer, offset, 12 + length));
        }
        
        offset += 12 + length;
    }
    
    return new Blob(parts, { type: 'image/png' });
}

// Parse PNG chunks
// Reads ArrayBuffer of a file to extract tEXt/iTXt chunks containing prompt data
async function parsePNG(file) {
    const defaultData = { 
        name: file.name, 
        model: 'Unknown', 
        loras: [], 
        positivePrompt: 'No metadata found', 
        negativePrompt: 'No metadata found', 
        raw: null,
        parameters: null
    };
    
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
                
                let keyword = '';
                let textStr = '';

                if (type === 'tEXt') {
                    let nullIdx = -1;
                    for (let i = 0; i < chunkDataView.length; i++) {
                        if (chunkDataView[i] === 0) {
                            nullIdx = i;
                            break;
                        }
                    }
                    
                    if (nullIdx !== -1) {
                        keyword = decoder.decode(chunkDataView.subarray(0, nullIdx));
                        textStr = decoder.decode(chunkDataView.subarray(nullIdx + 1));
                    }
                } else if (type === 'iTXt') {
                    let nullIdx = -1;
                    for (let i = 0; i < chunkDataView.length; i++) {
                        if (chunkDataView[i] === 0) {
                            nullIdx = i;
                            break;
                        }
                    }

                    if (nullIdx !== -1) {
                        keyword = decoder.decode(chunkDataView.subarray(0, nullIdx));
                        
                        // iTXt structure:
                        // keyword (null)
                        // compression flag (1 byte)
                        // compression method (1 byte)
                        // language tag (null terminated)
                        // translated keyword (null terminated)
                        // text (UTF-8)
                        
                        let textOffset = nullIdx + 3; // skip null, flag, method
                        
                        // Skip language tag
                        while (textOffset < chunkDataView.length && chunkDataView[textOffset] !== 0) textOffset++;
                        textOffset++; // skip null
                        
                        // Skip translated keyword
                        while (textOffset < chunkDataView.length && chunkDataView[textOffset] !== 0) textOffset++;
                        textOffset++; // skip null
                        
                        if (textOffset <= chunkDataView.length) {
                            const isCompressed = chunkDataView[nullIdx + 1] === 1;
                            if (isCompressed) {
                                // SD tools rarely compress this, and we don't have pako here.
                                console.warn(`Compressed iTXt chunk '${keyword}' found but not supported.`);
                            } else {
                                textStr = decoder.decode(chunkDataView.subarray(textOffset));
                            }
                        }
                    }
                }
                
                if (keyword === 'prompt') {
                    promptMetadata = extractComfyUIMetadata(textStr);
                    try { rawJson.prompt = JSON.parse(textStr); } catch(e){}
                } else if (keyword === 'workflow') {
                    workflowMetadata = extractComfyUIMetadata(textStr);
                    try { rawJson.workflow = JSON.parse(textStr); } catch(e){}
                } else if (keyword === 'parameters' || keyword === 'metadata') {
                    // Priority source: The cleaned truth written by Lora Manager or A1111
                    const standardMetadata = parseStandardMetadata(textStr);
                    if (standardMetadata) {
                        if (!promptMetadata) promptMetadata = { model: 'Unknown', loras: [] };
                        // Store the structured object separately
                        promptMetadata.parameters = standardMetadata;
                        
                        // Merge carefully: Don't overwrite a full path/extension with a shortened name
                        Object.entries(standardMetadata).forEach(([key, value]) => {
                            if (key === 'model') {
                                const comfyPath = promptMetadata.model;
                                const a1111Name = value;
                                
                                // Rule: Use the model path, but if and only if the a1111 is a substring of it. 
                                // Otherwise, use the a1111 name.
                                if (comfyPath !== 'Unknown' && comfyPath.toLowerCase().includes(a1111Name.toLowerCase())) {
                                    // Keep the comfyPath
                                } else {
                                    promptMetadata.model = a1111Name;
                                }
                            } else if (key === 'loras') {
                                if (promptMetadata.loras.length === 0) promptMetadata.loras = value;
                            } else {
                                promptMetadata[key] = value;
                            }
                        });
                        
                        promptMetadata.priorityResult = true; 
                    }
                }
            } else if (type === 'IEND') {
                break;
            }
            offset += 12 + length;
        }

        if (promptMetadata || workflowMetadata) {
            return finalizeMetadata(defaultData, promptMetadata, workflowMetadata, rawJson);
        }
        
    } catch (e) {
        console.warn(`Failed to parse PNG metadata for ${file.name}`, e);
    }
    
    return defaultData;
}

// Parse WebP chunks (RIFF)
async function parseWebP(file) {
    const defaultData = { 
        name: file.name, 
        model: 'Unknown', 
        loras: [], 
        positivePrompt: 'No metadata found', 
        negativePrompt: 'No metadata found', 
        raw: null,
        parameters: null
    };
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const view = new DataView(arrayBuffer);
        const decoder = new TextDecoder('utf-8');
        
        // Check RIFF and WEBP signature
        if (decoder.decode(arrayBuffer.slice(0, 4)) !== 'RIFF' || 
            decoder.decode(arrayBuffer.slice(8, 12)) !== 'WEBP') {
            return defaultData;
        }

        let offset = 12;
        let promptMetadata = null;
        let workflowMetadata = null;
        let rawJson = {};

        while (offset < arrayBuffer.byteLength) {
            const chunkType = decoder.decode(arrayBuffer.slice(offset, offset + 4));
            const chunkSize = view.getUint32(offset + 4, true);
            
            // EXIF and XMP are the most common places for ComfyUI/A1111 metadata in WebP
            if (chunkType === 'EXIF' || chunkType === 'XMP ') {
                const payload = arrayBuffer.slice(offset + 8, offset + 8 + chunkSize);
                const payloadStr = decoder.decode(payload);
                
                // 1. Search for Workflow: markers
                const workflowIdx = payloadStr.indexOf('Workflow:');
                if (workflowIdx !== -1) {
                    const potential = extractBalancedJson(payloadStr, workflowIdx);
                    if (potential) {
                        try {
                            workflowMetadata = extractComfyUIMetadata(potential);
                            rawJson.workflow = workflowMetadata.raw;
                        } catch (e) { console.warn("Failed to parse extracted Workflow JSON"); }
                    }
                }

                // 2. Search for Prompt: markers
                const promptIdx = payloadStr.indexOf('Prompt:');
                if (promptIdx !== -1) {
                    const potential = extractBalancedJson(payloadStr, promptIdx);
                    if (potential) {
                        try {
                            promptMetadata = extractComfyUIMetadata(potential);
                            rawJson.prompt = promptMetadata.raw;
                        } catch (e) { console.warn("Failed to parse extracted Prompt JSON"); }
                    }
                }

                // 3. Search for A1111 UserComment (UNICODE)
                const unicodeIdx = payloadStr.indexOf('UNICODE');
                if (unicodeIdx !== -1) {
                    const data = new Uint8Array(payload).slice(unicodeIdx + 8);
                    // Decode as UTF-16 (Try BE then LE)
                    let decoded = new TextDecoder('utf-16be').decode(data);
                    if (decoded.includes('\u0000') || decoded.length < 2) {
                        decoded = new TextDecoder('utf-16le').decode(data);
                    }
                    const exifText = decoded.replace(/\0/g, '').trim();
                    if (exifText && !exifText.startsWith('{')) {
                        const standard = parseStandardMetadata(exifText);
                        if (standard && (standard.positivePrompt || standard.seed)) {
                            if (!promptMetadata) promptMetadata = { model: 'Unknown', loras: [] };
                            Object.assign(promptMetadata, standard);
                            promptMetadata.parameters = standard;
                            promptMetadata.priorityResult = true;
                        }
                    }
                }

                // 4. Search for A1111 UserComment (ASCII)
                const asciiIdx = payloadStr.indexOf('ASCII');
                if (asciiIdx !== -1 && unicodeIdx === -1) {
                    const exifText = payloadStr.substring(asciiIdx + 8).replace(/\0/g, '').trim();
                    if (exifText && !exifText.startsWith('{')) {
                        const standard = parseStandardMetadata(exifText);
                        if (standard && (standard.positivePrompt || standard.seed)) {
                            if (!promptMetadata) promptMetadata = { model: 'Unknown', loras: [] };
                            Object.assign(promptMetadata, standard);
                            promptMetadata.parameters = standard;
                            promptMetadata.priorityResult = true;
                        }
                    }
                }

                // 5. Last resort: just look for any JSON in the chunk if we found nothing else
                if (!workflowMetadata && !promptMetadata) {
                    const potential = extractBalancedJson(payloadStr, 0);
                    if (potential) {
                        try {
                            const extracted = extractComfyUIMetadata(potential);
                            if (extracted.positivePrompt !== 'No positive prompt string found.') {
                                promptMetadata = extracted;
                                rawJson.prompt = extracted.raw;
                            }
                        } catch (e) {}
                    }
                }
            }
            
            // WebP chunks are padded to even size
            offset += 8 + chunkSize + (chunkSize % 2);
        }

        if (promptMetadata || workflowMetadata) {
            return finalizeMetadata(defaultData, promptMetadata, workflowMetadata, rawJson);
        }
        
    } catch (e) {
        console.warn(`Failed to parse WebP metadata for ${file.name}`, e);
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
    els.btnClearFilters.disabled = false;
    els.btnSelect.disabled = false;
    els.btnViewGallery.disabled = false;
    els.btnViewPrefixes.disabled = false;
    
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
            if (entry.kind === 'file' && isSupportedImage(entry.name)) {
                foundNames.add(entry.name);
                if (!currentFileNames.has(entry.name)) {
                    const file = await entry.getFile();
                    file.handle = entry;
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
        if (entry.kind === 'file' && isSupportedImage(entry.name)) {
            const file = await entry.getFile();
            file.handle = entry;
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
    const results = await Promise.all(filesBatch.map(async file => {
        // Check cache first
        const cached = await loadFromDB(file.name);
        
        if (cached && cached.lastModified === file.lastModified) {
            // URL object URLs expire, so we still need to create a new one
            cached.url = URL.createObjectURL(file);
            cached.file = file;
            cached.handle = file.handle || null;
            // Re-add to global sets for this session
            if (cached.data.model && cached.data.model !== 'Unknown') {
                state.models.add(cached.data.model);
            }
            cached.data.loras.forEach(l => state.loras.add(typeof l === 'string' ? l : l.name));
            return cached;
        }

        const url = URL.createObjectURL(file);
        
        let metadata;
        if (file.name.toLowerCase().endsWith('.png')) {
            metadata = await parsePNG(file);
        } else if (file.name.toLowerCase().endsWith('.webp')) {
            metadata = await parseWebP(file);
        } else {
            // Default for other image types (jpg/jpeg) - basic support without specialized parser for now
            metadata = { 
                name: file.name, 
                model: 'Unknown', 
                loras: [], 
                positivePrompt: 'No metadata found', 
                negativePrompt: 'No metadata found', 
                raw: null,
                parameters: null
            };
        }
        
        metadata.name = file.name; // Ensure name is set
        
        // Add to global sets
        if (metadata.model && metadata.model !== 'Unknown') {
            const existingModel = Array.from(state.models).find(m => m.toLowerCase() === metadata.model.toLowerCase());
            if (!existingModel) {
                state.models.add(metadata.model);
            } else {
                metadata.model = existingModel;
            }
        }
        metadata.loras.forEach(l => state.loras.add(typeof l === 'string' ? l : l.name));
        
        const imageData = {
            file,
            handle: file.handle || null,
            url,
            lastModified: file.lastModified,
            data: metadata
        };
        
        await saveToDB(imageData);
        return imageData;
    }));
    
    state.images.push(...results);
    if (!silent) els.statusText.textContent = `Found ${state.images.length} images... please wait...`;
}

function updateFiltersUI() {
    // Save current selections
    const currentModel = els.modelFilter.value;
    const currentLora = els.loraFilter.value;

    // Models (case-insensitive alphabetical sort)
    els.modelFilter.innerHTML = '<option value="">All Models</option>';
    const models = Array.from(state.models).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = normalizeName(model);
        els.modelFilter.appendChild(option);
    });
    
    // Restore model if still exists
    if (models.includes(currentModel)) els.modelFilter.value = currentModel;

    // LoRAs (case-insensitive alphabetical sort)
    const loras = Array.from(state.loras).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    els.loraFilter.innerHTML = '<option value="">All LoRAs</option>';
    
    // Add "No LoRA" option
    const noLoraOption = document.createElement('option');
    noLoraOption.value = '__no_lora__';
    noLoraOption.textContent = 'No LoRA';
    els.loraFilter.appendChild(noLoraOption);

    loras.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora;
        option.textContent = normalizeName(lora);
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

    // Toggle clear search button visibility
    if (state.searchQuery) {
        els.btnClearSearch.classList.add('visible');
    } else {
        els.btnClearSearch.classList.remove('visible');
    }
    
    state.filteredImages = state.images.filter(img => {
        // Global Search Filter
        const matchesSearch = !state.searchQuery || 
                              img.data.name.toLowerCase().includes(state.searchQuery) ||
                              img.data.model.toLowerCase().includes(state.searchQuery) ||
                               img.data.loras.some(l => (typeof l === 'string' ? l : l.name).toLowerCase().includes(state.searchQuery));
                               
        // Specific Filename Filter
        const matchesFilename = !state.filenameQuery || img.data.name.toLowerCase().includes(state.filenameQuery);
                               
        // Model Filter (exact match on full path inside state)
        const matchesModel = !state.selectedModel || img.data.model === state.selectedModel;
        
        // LoRA Filter
        const matchesLora = !state.selectedLora ? true : 
                          (state.selectedLora === '__no_lora__' ? img.data.loras.length === 0 : img.data.loras.some(l => (typeof l === 'string' ? l : l.name) === state.selectedLora));
        
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
    
    if (state.currentView === 'images') {
        renderGallery();
    } else {
        renderPrefixes();
    }
}

function clearFilters() {
    els.searchInput.value = '';
    els.filenameFilter.value = '';
    els.modelFilter.value = '';
    els.loraFilter.value = '';
    // Note: We specifically do NOT reset els.sortFilter.value as requested
    
    handleFilterChange();
}

function clearSearch() {
    els.searchInput.value = '';
    handleFilterChange();
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
        card.dataset.filename = img.data.name;
        card.onclick = () => openImageModal(img);
        
        const shortModelName = img.data.model === 'Unknown' ? 'Unknown Base Model' : normalizeName(img.data.model);
        
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
                ${img.data.loras.length === 1 ? (() => {
                    const l = img.data.loras[0];
                    const name = normalizeName(typeof l === 'string' ? l : l.name);
                    const weight = typeof l === 'string' ? 1.0 : l.weight;
                    const display = weight !== 1.0 ? `${name} (${weight})` : name;
                    return `<div class="card-model" title="${display}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                        ${display.length > 25 ? display.substring(0, 25) + '...' : display}
                    </div>`;
                })() : img.data.loras.length > 1 ? `<div class="card-model">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    ${img.data.loras.length} LoRAs
                </div>` : ''}
            </div>
        `;
        
        fragment.appendChild(card);
    });
    
    els.galleryGrid.appendChild(fragment);
}

function getFilePrefix(filename) {
    if (!filename) return '';
    const match = filename.match(/^[a-zA-Z0-9]+/);
    return match ? match[0] : '';
}

function getPrefixGroups() {
    const groups = {};
    
    state.filteredImages.forEach(img => {
        const prefix = getFilePrefix(img.data.name) || '[No Prefix]';
        if (!groups[prefix]) {
            groups[prefix] = {
                prefix,
                count: 0,
                coverImage: img,
                images: []
            };
        }
        groups[prefix].count++;
        groups[prefix].images.push(img);
    });
    
    return Object.values(groups).sort((a, b) => {
        if (a.prefix === '[No Prefix]') return 1;
        if (b.prefix === '[No Prefix]') return -1;
        
        if (state.sortBy === 'date-desc') {
            return b.coverImage.lastModified - a.coverImage.lastModified;
        } else if (state.sortBy === 'date-asc') {
            return a.coverImage.lastModified - b.coverImage.lastModified;
        } else if (state.sortBy === 'name-asc') {
            return a.prefix.toLowerCase().localeCompare(b.prefix.toLowerCase());
        } else if (state.sortBy === 'name-desc') {
            return b.prefix.toLowerCase().localeCompare(a.prefix.toLowerCase());
        }
        return 0;
    });
}

function renderPrefixes() {
    els.galleryGrid.innerHTML = '';
    
    const prefixGroups = getPrefixGroups();
    
    if (state.images.length > 0) {
        els.resultsCount.style.display = 'block';
        els.resultsCount.textContent = `${prefixGroups.length} group${prefixGroups.length !== 1 ? 's' : ''}`;
    } else {
        els.resultsCount.style.display = 'none';
    }
    
    if (prefixGroups.length === 0) {
        els.galleryGrid.innerHTML = `
            <div class="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <h2>No prefix groups found</h2>
                <p>Try adjusting your search or filters.</p>
            </div>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();
    
    prefixGroups.forEach(group => {
        const card = document.createElement('div');
        card.className = 'prefix-card';
        card.onclick = () => selectPrefixGroup(group.prefix);
        
        card.innerHTML = `
            <div class="prefix-card-stack">
                <div class="prefix-card-front">
                    <div class="card-image-wrap">
                        <img src="${group.coverImage.url}" loading="lazy" alt="${group.prefix}">
                    </div>
                    <div class="prefix-count-badge">
                        ${group.count}
                    </div>
                    <div class="prefix-overlay">
                        <div class="prefix-title">${group.prefix}</div>
                        <div class="prefix-subtitle">Click to view images</div>
                    </div>
                </div>
            </div>
        `;
        fragment.appendChild(card);
    });
    
    els.galleryGrid.appendChild(fragment);
}

function selectPrefixGroup(prefix) {
    if (prefix === '[No Prefix]') {
        els.filenameFilter.value = '';
    } else {
        els.filenameFilter.value = prefix;
    }
    
    state.filenameQuery = els.filenameFilter.value.toLowerCase();
    switchView('images');
    handleFilterChange();
}

function switchView(viewName) {
    state.currentView = viewName;
    
    if (viewName === 'images') {
        els.btnViewGallery.classList.add('active');
        els.btnViewPrefixes.classList.remove('active');
    } else {
        els.btnViewGallery.classList.remove('active');
        els.btnViewPrefixes.classList.add('active');
    }
    
    if (state.currentView === 'images') {
        renderGallery();
    } else {
        renderPrefixes();
    }
}

async function copyToClipboard(text, btn) {
    if (!text || text === 'None' || text === 'No metadata found' || text === 'None detected' || text === 'Not found') return;
    
    try {
        await navigator.clipboard.writeText(text);
        
        // Visual feedback
        const oldHtml = btn.innerHTML;
        btn.classList.add('success');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        
        setTimeout(() => {
            btn.classList.remove('success');
            btn.innerHTML = oldHtml;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy metadata:', err);
    }
}

function openImageModal(img) {
    state.currentActiveImg = img;
    resetZoom(); // Reset transforms on new image
    els.modalImage.src = img.url;
    els.modalFilename.textContent = img.data.name;
    
    const shortModelName = img.data.model === 'Unknown' ? 'Unknown Pattern' : normalizeName(img.data.model);
    els.modalModel.textContent = shortModelName;
    
    if (img.data.model !== 'Unknown') {
        els.modalModel.classList.add('clickable');
    } else {
        els.modalModel.classList.remove('clickable');
    }
    
    // Render LoRAs
    if (img.data.loras.length > 0) {
        els.modalLoras.innerHTML = img.data.loras.map(l => {
            const name = normalizeName(typeof l === 'string' ? l : l.name);
            const weight = typeof l === 'string' ? 1.0 : l.weight;
            const display = weight !== 1.0 ? `${name} (${weight})` : name;
            return `<li class="lora-tag clickable" data-lora-name="${name}" title="${display}">${display}</li>`;
        }).join('');
    } else {
        els.modalLoras.innerHTML = '<li class="lora-tag empty-state" style="color:#a0a5b1; font-size:0.9rem;">No LoRAs detected</li>';
    }
    
    els.modalPositive.textContent = img.data.positivePrompt || 'None';
    els.modalNegative.textContent = img.data.negativePrompt || 'None';
    
    // Render Cyclers if any
    let cyclersHtml = '';
    if (img.data.cyclers && img.data.cyclers.length > 0) {
        cyclersHtml = `
            <div class="metadata-section cyclers-section">
                <h4>Workflow Cyclers</h4>
                <ul class="cycler-list">
                    ${img.data.cyclers.map(c => `
                        <li class="cycler-item ${c.hooked ? 'active' : 'disconnected'}">
                            <span class="cycler-status" title="${c.hooked ? 'Connected and used' : 'Disconnected / Not used'}"></span>
                            <div class="cycler-info">
                                <span class="cycler-title">${c.title}</span>
                                <span class="cycler-value">${c.name}</span>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    
    // Remove existing cyclers section if any
    const sidebar = els.modalSidebar || els.modal.querySelector('.modal-sidebar');
    const existingCyclers = sidebar ? sidebar.querySelector('.cyclers-section') : null;
    if (existingCyclers) existingCyclers.remove();
    
    // Inject before Raw data
    els.modalRawJson.parentElement.parentElement.insertAdjacentHTML('beforebegin', cyclersHtml);

    if (img.data.raw) {
        els.modalRawJson.textContent = JSON.stringify(img.data.raw, null, 2);
    } else {
        els.modalRawJson.textContent = 'No ComfyUI generation data found in this file.';
    }

    if (img.data.parameters) {
        els.modalParametersSection.classList.remove('hidden');
        els.modalRawParameters.textContent = JSON.stringify(img.data.parameters, null, 2);
        
        // Populate settings grid
        els.modalSettingsSection.classList.remove('hidden');
        els.modalSteps.textContent = img.data.parameters.steps || '-';
        els.modalCfg.textContent = img.data.parameters.cfg || '-';
        els.modalSampler.textContent = img.data.parameters.sampler || '-';
        els.modalSize.textContent = img.data.parameters.size || '-';
        els.modalSeed.textContent = img.data.parameters.seed || '-';
    } else {
        els.modalParametersSection.classList.remove('hidden');
        els.modalRawParameters.textContent = 'No A1111 parameters found. Click the edit button to add metadata.';
        els.modalSettingsSection.classList.add('hidden');
    }


    els.modal.classList.remove('hidden');
}

function closeModal() {
    els.modal.classList.add('hidden');
    state.currentActiveImg = null;
    resetZoom();
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

async function sendAllToComfyUI() {
    if (!state.currentActiveImg) return;
    const img = state.currentActiveImg;
    const data = img.data;

    const oldBtnContent = els.btnSendAll.innerHTML;
    els.btnSendAll.classList.add('loading');
    els.btnSendAll.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0;"></div>';

    try {
        // 1. Fetch our own Registry
        const registryResponse = await fetch('/api/gallery/get-registry');
        const registryData = await registryResponse.json();
        if (!registryData.success) throw new Error(registryData.error || 'Failed to fetch registry');
        
        const nodes = registryData.nodes || {};
        const results = [];

        // Helper to send widget update via Lora Manager API
        const sendWidget = async (widgetNames, value, nodeFilter = null) => {
            if (value === null || value === undefined || value === 'Unknown' || value === '-') return;
            
            const names = Array.isArray(widgetNames) ? widgetNames : [widgetNames];
            
            const targetNodeIds = Object.entries(nodes)
                .filter(([id, node]) => {
                    const widgetNamesOnNode = node.widgets || [];
                    const hasWidget = names.some(name => widgetNamesOnNode.includes(name));
                    if (!hasWidget) return false;
                    
                    if (nodeFilter && !nodeFilter(node)) return false;
                    
                    return true;
                })
                .map(([id, node]) => id);

            if (targetNodeIds.length === 0) return;

            for (const id of targetNodeIds) {
                const node = nodes[id];
                const widgetNamesOnNode = node.widgets || [];
                const actualWidgetName = names.find(name => widgetNamesOnNode.includes(name));
                
                if (actualWidgetName) {
                    // We must stringify because Lora Manager's backend validates for string type
                    const stringValue = String(value);
                    if (!stringValue) continue; // Skip empty strings to avoid LM backend validation error

                    const res = await fetch('/api/lm/update-node-widget', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            widget_name: actualWidgetName,
                            value: stringValue, 
                            node_ids: [id] 
                        })
                    });
                    results.push(await res.json());
                }
            }
        };

        // 2. Prepare Prompts
        let fullPositive = data.positivePrompt || '';
        if (fullPositive === 'No metadata found' || fullPositive === 'No positive prompt string found.') {
            fullPositive = '';
        }
        if (data.loras && data.loras.length > 0) {
            const loraSyntax = data.loras.map(l => `<lora:${l.name}:${l.weight}>`).join(' ');
            fullPositive = loraSyntax + '\n' + fullPositive;
        }

        const negativePrompt = (data.negativePrompt && data.negativePrompt !== 'None detected.' && data.negativePrompt !== 'None') ? data.negativePrompt : '';

        // 2. Prepare Prompts (Separated)
        const loraTags = (data.loras || []).map(l => `<lora:${l.name}:${l.weight}>`).join(' ');
        
        // Clean positive prompt (strip any existing lora tags)
        let cleanPositive = (data.positivePrompt || '')
            .replace(/<lora:[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
            
        if (cleanPositive === 'No metadata found' || cleanPositive === 'No positive prompt string found.') {
            cleanPositive = '';
        }

        // 3. Send Updates
        
        // A. LoRA Specialist API (Targeting ONLY LoRA nodes)
        const loraNodeIds = Object.entries(nodes)
            .filter(([id, node]) => {
                const type = (node.comfy_class || '').toLowerCase();
                return type.includes('lora loader') || type.includes('lora stacker');
            })
            .map(([id, node]) => id);

        if (loraNodeIds.length > 0 || (data.loras && data.loras.length === 0)) {
            // Even if we have 0 loras, we call this with loraNodeIds=null to broadcast the "clear" command
            // or we use the specific IDs if we found them.
            const targetIds = loraNodeIds.length > 0 ? loraNodeIds : null;
            
            await fetch('/api/lm/update-lora-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lora_code: loraTags,
                    mode: 'replace',
                    node_ids: targetIds
                })
            });
        }

        // B. Generalist API for non-LoRA Prompt nodes (distinguish by title and color)
        const isPromptNode = node => {
            const type = (node.comfy_class || '').toLowerCase();
            if (type.includes('lora loader') || type.includes('lora stacker')) return false;

            const outputs = node.outputs || [];
            if (outputs.includes('CONDITIONING')) return true;
            if (type.includes('prompt') || type.includes('text_encode')) return true;
            return false;
        };

        const isNegativeNode = node => {
            if (!isPromptNode(node)) return false;
            const title = (node.title || '').toLowerCase();
            const color = (node.color || '').toLowerCase();
            const bgcolor = (node.bgcolor || '').toLowerCase();
            if (title.includes('negative')) return true;
            const redHints = ['#322', '#332222', '#a00', '#ff0000', 'red'];
            if (redHints.some(h => color.includes(h) || bgcolor.includes(h))) return true;
            return false;
        };

        if (cleanPositive) {
            await sendWidget(['text', 'string'], cleanPositive, node => isPromptNode(node) && !isNegativeNode(node));
        }
        
        if (negativePrompt.trim()) {
            await sendWidget(['text', 'string'], negativePrompt.trim(), node => isNegativeNode(node));
        }

        // C. Generalist API for KSampler parameters
        await sendWidget(['seed', 'noise_seed'], data.seed);
        await sendWidget('steps', data.steps);
        await sendWidget('cfg', data.cfg);
        await sendWidget(['sampler_name', 'sampler'], data.sampler);
        await sendWidget(['scheduler', 'scheduler_name'], data.scheduler);

        // D. Generalist API for Models
        await sendWidget(['ckpt_name', 'unet_name', 'model_name'], data.model);

        // Success Feedback
        els.btnSendAll.classList.remove('loading');
        els.btnSendAll.style.background = '#059669'; // Success green
        els.btnSendAll.style.borderColor = '#059669';
        els.btnSendAll.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        els.statusText.textContent = `Successfully sent parameters for ${img.data.name} to ComfyUI.`;

        setTimeout(() => {
            els.btnSendAll.style.background = '';
            els.btnSendAll.style.borderColor = '';
            els.btnSendAll.innerHTML = oldBtnContent;
        }, 2000);

    } catch (err) {
        console.error('Failed to send to ComfyUI:', err);
        els.btnSendAll.classList.remove('loading');
        els.btnSendAll.innerHTML = oldBtnContent;
        alert(`Failed to send to ComfyUI: ${err.message}. Make sure the Lora Manager extension is active in ComfyUI.`);
    }
}

async function deleteImage() {
    if (!state.currentActiveImg || !state.currentDirHandle) return;
    
    const imgToDelete = state.currentActiveImg;
    const filename = imgToDelete.data.name;
    
    try {
        // We first need readwrite permission to delete
        const permission = await state.currentDirHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            const reqPerm = await state.currentDirHandle.requestPermission({ mode: 'readwrite' });
            if (reqPerm !== 'granted') {
                alert("Write permissions are required to delete files.");
                return;
            }
        }
        
        const currentIndex = state.filteredImages.findIndex(img => img === imgToDelete);
        
        // Remove from memory optimistically
        state.images = state.images.filter(img => img.data.name !== filename);
        state.filteredImages = state.filteredImages.filter(img => img.data.name !== filename);
        
        // Remove from DOM directly to avoid full re-render jank
        const card = els.galleryGrid.querySelector(`.image-card[data-filename="${CSS.escape(filename)}"]`);
        if (card) card.remove();
        
        // Update results count
        if (state.filteredImages.length > 0) {
            els.resultsCount.style.display = 'block';
            els.resultsCount.textContent = `${state.filteredImages.length} result${state.filteredImages.length !== 1 ? 's' : ''}`;
        } else {
            els.resultsCount.style.display = 'none';
            els.galleryGrid.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <h2>No results found</h2>
                    <p>Try adjusting your search or filters.</p>
                </div>
            `;
        }
        
        // Show next image if available, else close
        if (state.filteredImages.length > 0) {
            const nextIndex = Math.min(currentIndex, state.filteredImages.length - 1);
            openImageModal(state.filteredImages[nextIndex]);
        } else {
            closeModal();
        }
        
        // Perform the deletion asynchronously without blocking UI
        state.currentDirHandle.removeEntry(filename).then(() => {
            els.statusText.textContent = `Deleted ${filename}. Loaded ${state.images.length} images.`;
        }).catch(err => {
            console.error("Failed to delete file:", err);
            alert(`Failed to delete file ${filename}: ${err.message}`);
        });
        
    } catch (err) {
        console.error("Error setting up deletion:", err);
        alert(`Error: ${err.message}`);
    }
}

// --- Zoom and Pan Logic ---
function handleWheel(e) {
    if (els.modal.classList.contains('hidden')) return;
    e.preventDefault();

    const zoomSpeed = 0.0015;
    const delta = -e.deltaY;
    const oldZoom = state.zoom;
    
    // Calculate new zoom
    state.zoom += delta * zoomSpeed * state.zoom;
    state.zoom = Math.min(Math.max(0.5, state.zoom), 10); // Clamp between 0.5x and 10x

    // Adjust pan to zoom towards mouse position
    const rect = els.modalImage.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Relative position in the image (0 to 1)
    const relX = mouseX / rect.width;
    const relY = mouseY / rect.height;

    // How much the width/height changed
    const zoomRatio = state.zoom / oldZoom;
    
    // Basic zoom works fine centered for now, but more advanced would adjust pan
    // For simplicity in this local gallery, we'll keep it centered or simple
    updateImageTransform();
}

function startPan(e) {
    if (state.zoom <= 1 && e.button !== 0) return; // Only pan if zoomed in or middle mouse
    state.isDragging = true;
    state.lastMousePos = { x: e.clientX, y: e.clientY };
    els.modalImage.style.cursor = 'grabbing';
}

function handlePan(e) {
    if (!state.isDragging) return;
    
    const dx = e.clientX - state.lastMousePos.x;
    const dy = e.clientY - state.lastMousePos.y;
    
    state.pan.x += dx;
    state.pan.y += dy;
    
    state.lastMousePos = { x: e.clientX, y: e.clientY };
    updateImageTransform();
}

function stopPan() {
    state.isDragging = false;
    if (els.modalImage) {
        els.modalImage.style.cursor = state.zoom > 1 ? 'grab' : 'default';
    }
}

function updateImageTransform() {
    if (!els.modalImage) return;
    els.modalImage.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    els.modalImage.style.cursor = state.zoom > 1 ? 'grab' : 'default';
}

function resetZoom() {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    updateImageTransform();
}

// Boot
document.addEventListener('DOMContentLoaded', init);

// --- Settings Management ---
function openSettings() {
    els.settingConstrainWidth.checked = state.settings.constrainWidth;
    els.settingSideMargin.value = state.settings.sideMargin;
    els.settingSideMarginVal.textContent = `${state.settings.sideMargin}%`;
    els.settingItemWidth.value = state.settings.itemMinWidth;
    els.settingItemWidthVal.textContent = `${state.settings.itemMinWidth}px`;
    els.settingAspectRatio.value = state.settings.aspectRatio;
    els.settingsModal.classList.remove('hidden');
}

function closeSettings() {
    els.settingsModal.classList.add('hidden');
}

function saveAndApplySettings() {
    state.settings.constrainWidth = els.settingConstrainWidth.checked;
    state.settings.sideMargin = parseFloat(els.settingSideMargin.value);
    state.settings.itemMinWidth = parseInt(els.settingItemWidth.value);
    state.settings.aspectRatio = els.settingAspectRatio.value;
    
    localStorage.setItem('gallery_settings', JSON.stringify(state.settings));
    applySettings();
    closeSettings();
}

function loadSettings() {
    const saved = localStorage.getItem('gallery_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.settings = { ...state.settings, ...parsed };
        } catch (e) {
            console.warn("Failed to parse settings", e);
        }
    }
    applySettings();
}

function applySettings() {
    const root = document.documentElement;
    const { constrainWidth, sideMargin, itemMinWidth, aspectRatio } = state.settings;
    
    // Layout Width
    root.style.setProperty('--container-max-width', constrainWidth ? '1400px' : '100%');
    root.style.setProperty('--container-padding', `${sideMargin}%`);

    // Grid Columns - Always auto-fill
    root.style.setProperty('--grid-columns', 'auto-fill');
    
    root.style.setProperty('--grid-item-min-width', `${itemMinWidth}px`);
    root.style.setProperty('--grid-aspect-ratio', aspectRatio);
}

// --- Edit Metadata Functions ---
function openEditMetadata() {
    if (!state.currentActiveImg) return;
    
    const img = state.currentActiveImg;
    els.editMetadataStatus.textContent = '';
    els.editMetadataStatus.style.color = '';
    
    let rawText = '';
    if (img.data.parameters && img.data.parameters.raw) {
        rawText = img.data.parameters.raw;
    } else {
        // Build a template from current parsed data
        const parts = [];
        if (img.data.positivePrompt && img.data.positivePrompt !== 'No metadata found' && img.data.positivePrompt !== 'No positive prompt string found.') {
            parts.push(img.data.positivePrompt);
        }
        if (img.data.negativePrompt && img.data.negativePrompt !== 'No metadata found' && img.data.negativePrompt !== 'None' && img.data.negativePrompt !== 'None detected.') {
            parts.push(`Negative prompt: ${img.data.negativePrompt}`);
        }
        
        // Settings line
        const settingsParts = [];
        if (img.data.steps && img.data.steps !== '-') settingsParts.push(`Steps: ${img.data.steps}`);
        if (img.data.sampler && img.data.sampler !== '-') settingsParts.push(`Sampler: ${img.data.sampler}`);
        if (img.data.cfg && img.data.cfg !== '-') settingsParts.push(`CFG scale: ${img.data.cfg}`);
        if (img.data.seed && img.data.seed !== '-') settingsParts.push(`Seed: ${img.data.seed}`);
        if (img.data.size && img.data.size !== '-') settingsParts.push(`Size: ${img.data.size}`);
        
        // Model
        if (img.data.model && img.data.model !== 'Unknown') {
            settingsParts.push(`Model: ${img.data.model}`);
        } else {
            settingsParts.push(`Model: sd_xl_base_1.0`); // default placeholder
        }
        
        if (settingsParts.length > 0) {
            parts.push(settingsParts.join(', '));
        }
        rawText = parts.join('\n');
    }
    
    els.editMetadataTextarea.value = rawText;
    els.editMetadataModal.classList.remove('hidden');
}

function closeEditMetadata() {
    els.editMetadataModal.classList.add('hidden');
}

async function saveEditMetadata() {
    if (!state.currentActiveImg) return;
    
    const img = state.currentActiveImg;
    const newText = els.editMetadataTextarea.value.trim();
    
    if (!newText) {
        els.editMetadataStatus.textContent = 'Metadata text cannot be empty.';
        els.editMetadataStatus.style.color = '#ef4444';
        return;
    }
    
    const oldBtnContent = els.btnSaveMetadata.innerHTML;
    els.btnSaveMetadata.disabled = true;
    els.btnSaveMetadata.innerHTML = '<svg class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0; display: inline-block; vertical-align: middle; margin-right: 0.5rem;" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg> Saving...';
    els.editMetadataStatus.textContent = '';
    
    try {
        // 1. Parse the new text
        const parsed = parseStandardMetadata(newText);
        if (!parsed) {
            throw new Error("Failed to parse metadata format. Ensure it follows A1111 structure (comma-separated key-values on the last line).");
        }
        
        // 2. Update the in-memory image metadata
        img.data.model = parsed.model;
        img.data.loras = parsed.loras;
        img.data.positivePrompt = parsed.positivePrompt;
        img.data.negativePrompt = parsed.negativePrompt;
        img.data.steps = parsed.steps;
        img.data.cfg = parsed.cfg;
        img.data.sampler = parsed.sampler;
        img.data.size = parsed.size;
        img.data.seed = parsed.seed;
        img.data.parameters = parsed;
        
        // 3. Rewrite PNG file on disk if it's a PNG and we have write permissions
        const isPng = img.data.name.toLowerCase().endsWith('.png');
        if (isPng && state.currentDirHandle) {
            // Check write permission
            const permission = await state.currentDirHandle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                const reqPerm = await state.currentDirHandle.requestPermission({ mode: 'readwrite' });
                if (reqPerm !== 'granted') {
                    throw new Error("Folder write permissions are required to update the image file. The changes are only saved in the browser cache.");
                }
            }
            
            // Get file handle
            const handle = img.handle || await state.currentDirHandle.getFileHandle(img.data.name);
            
            // Read binary file
            const file = await handle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            
            // Rewrite PNG
            const newBlob = updatePNGParameters(arrayBuffer, newText);
            
            // Write to disk
            const writable = await handle.createWritable();
            await writable.write(newBlob);
            await writable.close();
            
            // Re-read file to synchronize lastModified time in browser cache
            const updatedFile = await handle.getFile();
            img.file = updatedFile;
            img.lastModified = updatedFile.lastModified;
        }
        
        // 4. Save to IndexedDB
        await saveToDB(img);
        
        // 5. Update global models and LoRAs sets if they changed
        // Re-calculate state.models and state.loras to avoid stale values
        state.models.clear();
        state.loras.clear();
        state.images.forEach(image => {
            if (image.data.model && image.data.model !== 'Unknown') {
                state.models.add(image.data.model);
            }
            image.data.loras.forEach(l => {
                state.loras.add(typeof l === 'string' ? l : l.name);
            });
        });
        
        // 6. Update UI
        updateFiltersUI();
        handleFilterChange();
        
        // Update detail modal views if it's still open and showing this image
        if (state.currentActiveImg === img) {
            openImageModal(img);
        }
        
        els.editMetadataStatus.textContent = isPng ? 'Saved successfully to file and database!' : 'Saved successfully to database!';
        els.editMetadataStatus.style.color = '#22c55e';
        
        setTimeout(() => {
            closeEditMetadata();
        }, 1500);
        
    } catch (err) {
        console.error("Failed to save metadata:", err);
        els.editMetadataStatus.textContent = err.message;
        els.editMetadataStatus.style.color = '#ef4444';
    } finally {
        els.btnSaveMetadata.disabled = false;
        els.btnSaveMetadata.innerHTML = oldBtnContent;
    }
}
