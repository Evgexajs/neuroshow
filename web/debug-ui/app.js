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
// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
//# sourceMappingURL=app.js.map