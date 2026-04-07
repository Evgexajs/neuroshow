"use strict";
/**
 * Neuroshow Debug UI - SSE Client and Event Feed
 * Handles connection to /shows/:id/events and displays events in real-time
 */
// DOM Elements
const showIdInput = document.getElementById('show-id');
const connectBtn = document.getElementById('connect-btn');
const eventsContainer = document.getElementById('events-container');
const cardsContainer = document.getElementById('cards-container');
// Control Panel Elements
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resumeBtn = document.getElementById('resume-btn');
const stepBtn = document.getElementById('step-btn');
const rollbackBtn = document.getElementById('rollback-btn');
const showStatusEl = document.getElementById('show-status');
const currentPhaseEl = document.getElementById('current-phase');
const turnNumberEl = document.getElementById('turn-number');
const tokenProgressEl = document.getElementById('token-progress');
const tokenTextEl = document.getElementById('token-text');
// New Show Modal Elements
const newShowBtn = document.getElementById('new-show-btn');
const newShowModal = document.getElementById('new-show-modal');
const modalOverlay = document.getElementById('modal-overlay');
const modalCloseBtn = document.getElementById('modal-close-btn');
const templateSelect = document.getElementById('template-select');
const templateInfo = document.getElementById('template-info');
const charactersList = document.getElementById('characters-list');
const charactersValidation = document.getElementById('characters-validation');
const createError = document.getElementById('create-error');
const cancelBtn = document.getElementById('cancel-btn');
const createShowBtn = document.getElementById('create-show-btn');
const themeInput = document.getElementById('theme-input');
const generateBtn = document.getElementById('generate-btn');
const generateStatus = document.getElementById('generate-status');
// State
let eventSource = null;
let currentShowId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
// Character state
let characters = [];
const characterStatuses = new Map();
let activeCharacterId = null;
// Control panel state
let currentShowStatus = null;
let statusPollInterval = null;
const STATUS_POLL_INTERVAL_MS = 2000;
let turnCount = 0;
// New show modal state
let availableTemplates = [];
let availableCharacters = [];
let selectedTemplate = null;
const selectedCharacterIds = new Set();
/**
 * Initialize the application
 */
function init() {
    connectBtn.addEventListener('click', () => {
        handleConnect().catch(console.error);
    });
    showIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleConnect().catch(console.error);
        }
    });
    // Control panel button listeners
    startBtn.addEventListener('click', () => handleControl('start'));
    pauseBtn.addEventListener('click', () => handleControl('pause'));
    resumeBtn.addEventListener('click', () => handleControl('resume'));
    stepBtn.addEventListener('click', () => handleControl('step'));
    rollbackBtn.addEventListener('click', handleRollback);
    // New show modal listeners
    newShowBtn.addEventListener('click', openNewShowModal);
    modalOverlay.addEventListener('click', closeNewShowModal);
    modalCloseBtn.addEventListener('click', closeNewShowModal);
    cancelBtn.addEventListener('click', closeNewShowModal);
    templateSelect.addEventListener('change', handleTemplateChange);
    createShowBtn.addEventListener('click', () => {
        handleCreateShow().catch(console.error);
    });
    generateBtn.addEventListener('click', () => {
        handleGenerateCharacters().catch(console.error);
    });
}
/**
 * Handle connect button click
 */
async function handleConnect() {
    const showId = showIdInput.value.trim();
    if (!showId) {
        alert('Please enter a Show ID');
        return;
    }
    if (eventSource) {
        disconnect();
    }
    currentShowId = showId;
    await connect(showId);
}
/**
 * Send control action to the server
 */
async function handleControl(action, phaseId) {
    if (!currentShowId) {
        addSystemMessage('No show connected');
        return;
    }
    try {
        const body = { action };
        if (phaseId) {
            body.phaseId = phaseId;
        }
        const response = await fetch(`/shows/${currentShowId}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        const result = await response.json();
        addSystemMessage(`Control: ${result.message}`);
        // Refresh status immediately after control action
        await fetchStatus(currentShowId);
    }
    catch (err) {
        console.error(`Control action ${action} failed:`, err);
        addSystemMessage(`Control failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
}
/**
 * Handle rollback button click - prompts for phase ID
 */
function handleRollback() {
    if (!currentShowId) {
        addSystemMessage('No show connected');
        return;
    }
    const phaseId = prompt('Enter phase ID to rollback to:');
    if (phaseId && phaseId.trim()) {
        handleControl('rollback', phaseId.trim()).catch(console.error);
    }
}
/**
 * Fetch current show status from the server
 */
async function fetchStatus(showId) {
    try {
        const response = await fetch(`/shows/${showId}/status`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const status = await response.json();
        updateControlPanelUI(status);
    }
    catch (err) {
        console.error('Failed to fetch status:', err);
    }
}
/**
 * Update the control panel UI based on status
 */
function updateControlPanelUI(status) {
    currentShowStatus = status.status;
    // Update status display
    showStatusEl.textContent = status.status ?? '--';
    currentPhaseEl.textContent = status.currentPhaseId ?? '--';
    turnNumberEl.textContent = status.eventsCount > 0 ? String(status.eventsCount) : '--';
    // Update token counter
    if (status.tokenBudget) {
        const { used, total, percentUsed } = status.tokenBudget;
        tokenProgressEl.style.width = `${Math.min(percentUsed, 100)}%`;
        tokenTextEl.textContent = `${used.toLocaleString()} / ${total.toLocaleString()}`;
        // Change color based on usage
        if (percentUsed >= 90) {
            tokenProgressEl.style.backgroundColor = 'var(--error)';
        }
        else if (percentUsed >= 70) {
            tokenProgressEl.style.backgroundColor = 'var(--warning)';
        }
        else {
            tokenProgressEl.style.backgroundColor = 'var(--accent)';
        }
    }
    else {
        tokenProgressEl.style.width = '0%';
        tokenTextEl.textContent = '0 / 0';
    }
    // Update button states
    updateButtonStates();
}
/**
 * Update control button enabled/disabled states based on show status
 */
function updateButtonStates() {
    const isConnected = currentShowId !== null;
    const status = currentShowStatus;
    // START: enabled when connected and show is not yet running/paused (or completed/aborted for restart)
    startBtn.disabled = !isConnected || status === 'running' || status === 'paused';
    // PAUSE: enabled only when running
    pauseBtn.disabled = !isConnected || status !== 'running';
    // RESUME: enabled only when paused
    resumeBtn.disabled = !isConnected || status !== 'paused';
    // STEP: enabled when paused (for DEBUG mode stepping)
    stepBtn.disabled = !isConnected || status !== 'paused';
    // ROLLBACK: enabled when paused or running
    rollbackBtn.disabled = !isConnected || (status !== 'paused' && status !== 'running');
}
/**
 * Start polling for show status
 */
function startStatusPolling(showId) {
    stopStatusPolling();
    fetchStatus(showId).catch(console.error);
    statusPollInterval = setInterval(() => {
        fetchStatus(showId).catch(console.error);
    }, STATUS_POLL_INTERVAL_MS);
}
/**
 * Stop polling for show status
 */
function stopStatusPolling() {
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
    }
}
/**
 * Fetch characters for a show
 */
async function fetchCharacters(showId) {
    try {
        const response = await fetch(`/shows/${showId}/characters`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        characters = data.characters;
        // Initialize statuses
        characterStatuses.clear();
        for (const char of characters) {
            characterStatuses.set(char.id, 'waiting');
        }
        activeCharacterId = null;
        renderCharacterCards();
    }
    catch (err) {
        console.error('Failed to fetch characters:', err);
        addSystemMessage('Failed to load characters');
    }
}
/**
 * Render character cards
 */
function renderCharacterCards() {
    if (characters.length === 0) {
        cardsContainer.innerHTML = '<p class="placeholder">No characters loaded...</p>';
        return;
    }
    cardsContainer.innerHTML = '';
    for (const char of characters) {
        const status = characterStatuses.get(char.id) ?? 'waiting';
        const isActive = char.id === activeCharacterId;
        const cardEl = document.createElement('div');
        cardEl.className = `character-card${isActive ? ' active' : ''}${status === 'speaking' ? ' speaking' : ''}${status === 'in-private' ? ' in-private' : ''}`;
        cardEl.dataset.characterId = char.id;
        cardEl.innerHTML = `
      <div class="character-name">${escapeHtml(char.name)}</div>
      <div class="character-model">${escapeHtml(char.modelAdapterId)}</div>
      <div class="character-public-card">${escapeHtml(char.publicCard)}</div>
      <span class="character-status ${status}">${formatStatus(status)}</span>
    `;
        cardsContainer.appendChild(cardEl);
    }
}
/**
 * Format status for display
 */
function formatStatus(status) {
    switch (status) {
        case 'waiting':
            return 'Waiting';
        case 'speaking':
            return 'Speaking';
        case 'in-private':
            return 'In Private';
        default:
            return 'Unknown';
    }
}
/**
 * Update character status based on event
 */
function updateCharacterStatus(event) {
    const { type, senderId, channel } = event;
    // Handle speech events - mark sender as speaking
    if (type === 'speech' && senderId) {
        // Reset previous active character
        if (activeCharacterId && activeCharacterId !== senderId) {
            characterStatuses.set(activeCharacterId, 'waiting');
        }
        // Set new active character
        activeCharacterId = senderId;
        if (channel === 'PRIVATE') {
            characterStatuses.set(senderId, 'in-private');
        }
        else {
            characterStatuses.set(senderId, 'speaking');
        }
        renderCharacterCards();
        return;
    }
    // Handle channel change events
    if (type === 'channel_change' && senderId) {
        if (channel === 'PRIVATE') {
            characterStatuses.set(senderId, 'in-private');
        }
        else {
            characterStatuses.set(senderId, 'waiting');
        }
        renderCharacterCards();
        return;
    }
    // Handle phase transitions - reset all to waiting
    if (type === 'phase_start' || type === 'phase_end') {
        for (const charId of characterStatuses.keys()) {
            characterStatuses.set(charId, 'waiting');
        }
        activeCharacterId = null;
        renderCharacterCards();
    }
}
/**
 * Connect to SSE endpoint for a show
 */
async function connect(showId) {
    clearEvents();
    addSystemMessage('Connecting to show...');
    // Fetch characters and start status polling
    await fetchCharacters(showId);
    startStatusPolling(showId);
    const url = `/shows/${showId}/events`;
    eventSource = new EventSource(url);
    eventSource.onopen = () => {
        reconnectAttempts = 0;
        addSystemMessage('Connected to event stream');
        connectBtn.textContent = 'Disconnect';
    };
    eventSource.onmessage = (event) => {
        try {
            const showEvent = JSON.parse(event.data);
            addEventToFeed(showEvent);
            updateCharacterStatus(showEvent);
            // Count speech events as turns
            if (showEvent.type === 'speech') {
                turnCount++;
                turnNumberEl.textContent = String(turnCount);
            }
        }
        catch (err) {
            console.error('Failed to parse event:', err);
        }
    };
    eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) {
            addSystemMessage('Connection closed');
            attemptReconnect();
        }
        else if (eventSource?.readyState === EventSource.CONNECTING) {
            addSystemMessage('Reconnecting...');
        }
    };
}
/**
 * Disconnect from the current SSE stream
 */
function disconnect() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    currentShowId = null;
    reconnectAttempts = 0;
    connectBtn.textContent = 'Connect';
    addSystemMessage('Disconnected');
    // Clear character state
    characters = [];
    characterStatuses.clear();
    activeCharacterId = null;
    cardsContainer.innerHTML = '<p class="placeholder">No characters loaded...</p>';
    // Stop status polling and reset control panel
    stopStatusPolling();
    currentShowStatus = null;
    resetControlPanelUI();
}
/**
 * Reset control panel UI to default state
 */
function resetControlPanelUI() {
    showStatusEl.textContent = '--';
    currentPhaseEl.textContent = '--';
    turnNumberEl.textContent = '--';
    tokenProgressEl.style.width = '0%';
    tokenTextEl.textContent = '0 / 0';
    updateButtonStates();
}
/**
 * Attempt to reconnect after connection loss
 */
function attemptReconnect() {
    if (!currentShowId)
        return;
    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        addSystemMessage(`Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
        disconnect();
        return;
    }
    addSystemMessage(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    setTimeout(() => {
        if (currentShowId) {
            connect(currentShowId);
        }
    }, RECONNECT_DELAY_MS);
}
/**
 * Clear all events from the feed
 */
function clearEvents() {
    eventsContainer.innerHTML = '';
    turnCount = 0;
}
/**
 * Add a system message to the feed
 */
function addSystemMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'event-item system-message';
    messageEl.style.backgroundColor = 'var(--bg-light)';
    messageEl.style.color = 'var(--text-secondary)';
    messageEl.style.fontStyle = 'italic';
    messageEl.style.borderLeftColor = 'var(--accent)';
    const time = formatTime(Date.now());
    messageEl.innerHTML = `
    <div class="event-header">
      <span class="event-sender">System</span>
      <span class="event-time">${time}</span>
    </div>
    <div class="event-content">${escapeHtml(message)}</div>
  `;
    eventsContainer.appendChild(messageEl);
    scrollToBottom();
}
/**
 * Add an event to the feed
 */
function addEventToFeed(event) {
    const eventEl = document.createElement('div');
    // Get channel class for color coding
    const channelClass = getChannelClass(event.channel);
    eventEl.className = `event-item ${channelClass}`;
    // Format event data
    const time = formatTime(event.timestamp);
    const sender = event.senderId ?? 'System';
    const channel = event.channel ?? '';
    const phase = event.phaseId ?? '';
    const type = event.type ?? '';
    // Build header info
    let headerInfo = `${channel}`;
    if (phase) {
        headerInfo += ` | ${phase}`;
    }
    if (type && type !== 'speech') {
        headerInfo += ` | ${type}`;
    }
    eventEl.innerHTML = `
    <div class="event-header">
      <span class="event-sender">${escapeHtml(sender)}</span>
      <span class="event-meta">${escapeHtml(headerInfo)}</span>
      <span class="event-time">${time}</span>
    </div>
    <div class="event-content">${escapeHtml(event.content ?? '')}</div>
  `;
    // Store sequence number for potential debugging
    eventEl.dataset.sequenceNumber = String(event.sequenceNumber);
    eventsContainer.appendChild(eventEl);
    scrollToBottom();
}
/**
 * Get CSS class for channel color coding
 */
function getChannelClass(channel) {
    switch (channel) {
        case 'PUBLIC':
            return 'channel-public';
        case 'PRIVATE':
            return 'channel-private';
        case 'ZONE':
            return 'channel-zone';
        default:
            return 'channel-public';
    }
}
/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}
/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (typeof text !== 'string')
        return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Scroll the events container to the bottom
 */
function scrollToBottom() {
    eventsContainer.scrollTop = eventsContainer.scrollHeight;
}
/**
 * Open the new show modal and load data
 */
function openNewShowModal() {
    newShowModal.classList.remove('hidden');
    createError.classList.add('hidden');
    loadModalData().catch(console.error);
}
/**
 * Close the new show modal
 */
function closeNewShowModal() {
    newShowModal.classList.add('hidden');
    resetModalState();
}
/**
 * Reset modal state
 */
function resetModalState() {
    selectedTemplate = null;
    selectedCharacterIds.clear();
    templateSelect.value = '';
    templateInfo.textContent = '';
    charactersValidation.textContent = '';
    charactersValidation.className = 'validation-message';
    createShowBtn.disabled = true;
    createError.classList.add('hidden');
    themeInput.value = '';
    generateStatus.classList.add('hidden');
    generateStatus.classList.remove('error');
}
/**
 * Load templates and characters for the modal
 */
async function loadModalData() {
    // Load templates
    templateSelect.innerHTML = '<option value="">Loading templates...</option>';
    charactersList.innerHTML = '<p class="loading-text">Loading characters...</p>';
    try {
        const [templatesResponse, charactersResponse] = await Promise.all([
            fetch('/templates'),
            fetch('/characters'),
        ]);
        if (!templatesResponse.ok) {
            throw new Error('Failed to load templates');
        }
        if (!charactersResponse.ok) {
            throw new Error('Failed to load characters');
        }
        availableTemplates = await templatesResponse.json();
        availableCharacters = await charactersResponse.json();
        renderTemplateSelect();
        renderCharacterCheckboxes();
    }
    catch (err) {
        console.error('Failed to load modal data:', err);
        templateSelect.innerHTML = '<option value="">Failed to load templates</option>';
        charactersList.innerHTML = '<p class="loading-text">Failed to load characters</p>';
    }
}
/**
 * Render template dropdown options
 */
function renderTemplateSelect() {
    templateSelect.innerHTML = '<option value="">Select a template...</option>';
    for (const template of availableTemplates) {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        templateSelect.appendChild(option);
    }
}
/**
 * Render character checkboxes
 */
function renderCharacterCheckboxes() {
    if (availableCharacters.length === 0) {
        charactersList.innerHTML = '<p class="loading-text">No characters available</p>';
        return;
    }
    charactersList.innerHTML = '';
    for (const char of availableCharacters) {
        const label = document.createElement('label');
        label.className = 'character-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = char.id;
        checkbox.addEventListener('change', handleCharacterToggle);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'char-name';
        nameSpan.textContent = char.name;
        const descSpan = document.createElement('span');
        descSpan.className = 'char-desc';
        descSpan.textContent = `- ${char.publicCard.substring(0, 50)}${char.publicCard.length > 50 ? '...' : ''}`;
        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        label.appendChild(descSpan);
        charactersList.appendChild(label);
    }
}
/**
 * Handle template selection change
 */
function handleTemplateChange() {
    const templateId = templateSelect.value;
    selectedTemplate = availableTemplates.find((t) => t.id === templateId) ?? null;
    if (selectedTemplate) {
        templateInfo.textContent = `${selectedTemplate.description} (${selectedTemplate.minParticipants}-${selectedTemplate.maxParticipants} participants)`;
    }
    else {
        templateInfo.textContent = '';
    }
    validateCharacterSelection();
}
/**
 * Handle character checkbox toggle
 */
function handleCharacterToggle(event) {
    const checkbox = event.target;
    const charId = checkbox.value;
    if (checkbox.checked) {
        selectedCharacterIds.add(charId);
    }
    else {
        selectedCharacterIds.delete(charId);
    }
    validateCharacterSelection();
}
/**
 * Validate character selection against template limits
 */
function validateCharacterSelection() {
    if (!selectedTemplate) {
        charactersValidation.textContent = '';
        charactersValidation.className = 'validation-message';
        createShowBtn.disabled = true;
        return;
    }
    const count = selectedCharacterIds.size;
    const { minParticipants, maxParticipants } = selectedTemplate;
    if (count < minParticipants) {
        charactersValidation.textContent = `Select at least ${minParticipants} characters (${count} selected)`;
        charactersValidation.className = 'validation-message error';
        createShowBtn.disabled = true;
    }
    else if (count > maxParticipants) {
        charactersValidation.textContent = `Maximum ${maxParticipants} characters allowed (${count} selected)`;
        charactersValidation.className = 'validation-message error';
        createShowBtn.disabled = true;
    }
    else {
        charactersValidation.textContent = `${count} characters selected (valid)`;
        charactersValidation.className = 'validation-message valid';
        createShowBtn.disabled = false;
    }
}
/**
 * Handle generate characters button click
 */
async function handleGenerateCharacters() {
    const theme = themeInput.value.trim();
    const count = selectedTemplate
        ? Math.min(selectedTemplate.maxParticipants, 5)
        : 5;
    generateBtn.disabled = true;
    generateStatus.textContent = 'Generating characters...';
    generateStatus.classList.remove('hidden', 'error');
    try {
        const response = await fetch('/generate/characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, theme: theme || undefined }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error ?? `HTTP ${response.status}`);
        }
        const generatedCharacters = await response.json();
        // Add generated characters to available characters
        // Replace any previously generated characters (those without a file source)
        const existingFileCharacters = availableCharacters.filter((c) => !c.id.includes('-') || c.id.length < 30);
        availableCharacters = [...existingFileCharacters, ...generatedCharacters];
        // Re-render checkboxes
        renderCharacterCheckboxes();
        // Auto-select generated characters
        selectedCharacterIds.clear();
        for (const char of generatedCharacters) {
            selectedCharacterIds.add(char.id);
        }
        // Check all generated character checkboxes
        const checkboxes = charactersList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((checkbox) => {
            const input = checkbox;
            input.checked = selectedCharacterIds.has(input.value);
        });
        // Validate selection
        validateCharacterSelection();
        generateStatus.textContent = `Generated ${generatedCharacters.length} characters`;
        setTimeout(() => {
            generateStatus.classList.add('hidden');
        }, 3000);
    }
    catch (err) {
        console.error('Failed to generate characters:', err);
        generateStatus.textContent = `Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
        generateStatus.classList.add('error');
    }
    finally {
        generateBtn.disabled = false;
    }
}
/**
 * Handle create show button click
 */
async function handleCreateShow() {
    if (!selectedTemplate || selectedCharacterIds.size === 0) {
        return;
    }
    createShowBtn.disabled = true;
    createError.classList.add('hidden');
    // Build characters array with full character data
    const selectedChars = availableCharacters.filter((c) => selectedCharacterIds.has(c.id));
    const requestBody = {
        formatId: selectedTemplate,
        characters: selectedChars,
    };
    try {
        const response = await fetch('/shows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error ?? `HTTP ${response.status}`);
        }
        const result = await response.json();
        // Close modal and connect to the new show
        closeNewShowModal();
        showIdInput.value = result.showId;
        await handleConnect();
    }
    catch (err) {
        console.error('Failed to create show:', err);
        createError.textContent = `Failed to create show: ${err instanceof Error ? err.message : 'Unknown error'}`;
        createError.classList.remove('hidden');
        createShowBtn.disabled = false;
    }
}
// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
//# sourceMappingURL=app.js.map