/**
 * Neuroshow Debug UI - SSE Client and Event Feed
 * Handles connection to /shows/:id/events and displays events in real-time
 */

// Types
interface ShowEvent {
  sequenceNumber: number;
  timestamp: number;
  channel?: string;
  senderId?: string;
  phaseId?: string;
  type?: string;
  content?: string;
}

interface Character {
  id: string;
  name: string;
  modelAdapterId: string;
  publicCard: string;
}

interface CharacterDefinition {
  id: string;
  name: string;
  publicCard: string;
  privateCard: string;
  modelAdapterId?: string;
}

interface ShowFormatTemplate {
  id: string;
  name: string;
  description: string;
  minParticipants: number;
  maxParticipants: number;
  phases: unknown[];
  tokenBudget: unknown;
}

type CharacterStatus = 'waiting' | 'speaking' | 'in-private';

type ShowStatus = 'running' | 'paused' | 'completed' | 'aborted' | null;

interface StatusResponse {
  status: ShowStatus;
  currentPhaseId: string | null;
  eventsCount: number;
  tokenBudget: {
    total: number;
    used: number;
    mode: string;
    percentUsed: number;
  } | null;
}

type ControlAction = 'start' | 'pause' | 'resume' | 'step' | 'rollback';

// DOM Elements
const showIdInput = document.getElementById('show-id') as HTMLInputElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const eventsContainer = document.getElementById('events-container') as HTMLDivElement;
const cardsContainer = document.getElementById('cards-container') as HTMLDivElement;

// Control Panel Elements
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
const rollbackBtn = document.getElementById('rollback-btn') as HTMLButtonElement;
const showStatusEl = document.getElementById('show-status') as HTMLSpanElement;
const currentPhaseEl = document.getElementById('current-phase') as HTMLSpanElement;
const turnNumberEl = document.getElementById('turn-number') as HTMLSpanElement;
const tokenProgressEl = document.getElementById('token-progress') as HTMLDivElement;
const tokenTextEl = document.getElementById('token-text') as HTMLSpanElement;

// New Show Modal Elements
const newShowBtn = document.getElementById('new-show-btn') as HTMLButtonElement;
const newShowModal = document.getElementById('new-show-modal') as HTMLDivElement;
const modalOverlay = document.getElementById('modal-overlay') as HTMLDivElement;
const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement;
const templateSelect = document.getElementById('template-select') as HTMLSelectElement;
const templateInfo = document.getElementById('template-info') as HTMLDivElement;
const charactersList = document.getElementById('characters-list') as HTMLDivElement;
const charactersValidation = document.getElementById('characters-validation') as HTMLDivElement;
const createError = document.getElementById('create-error') as HTMLDivElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const createShowBtn = document.getElementById('create-show-btn') as HTMLButtonElement;

// State
let eventSource: EventSource | null = null;
let currentShowId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// Character state
let characters: Character[] = [];
const characterStatuses: Map<string, CharacterStatus> = new Map();
let activeCharacterId: string | null = null;

// Control panel state
let currentShowStatus: ShowStatus = null;
let statusPollInterval: ReturnType<typeof setInterval> | null = null;
const STATUS_POLL_INTERVAL_MS = 2000;
let turnCount = 0;

// New show modal state
let availableTemplates: ShowFormatTemplate[] = [];
let availableCharacters: CharacterDefinition[] = [];
let selectedTemplate: ShowFormatTemplate | null = null;
const selectedCharacterIds: Set<string> = new Set();

/**
 * Initialize the application
 */
function init(): void {
  connectBtn.addEventListener('click', () => {
    handleConnect().catch(console.error);
  });
  showIdInput.addEventListener('keypress', (e: KeyboardEvent) => {
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
}

/**
 * Handle connect button click
 */
async function handleConnect(): Promise<void> {
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
async function handleControl(action: ControlAction, phaseId?: string): Promise<void> {
  if (!currentShowId) {
    addSystemMessage('No show connected');
    return;
  }

  try {
    const body: { action: ControlAction; phaseId?: string } = { action };
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
  } catch (err) {
    console.error(`Control action ${action} failed:`, err);
    addSystemMessage(`Control failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Handle rollback button click - prompts for phase ID
 */
function handleRollback(): void {
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
async function fetchStatus(showId: string): Promise<void> {
  try {
    const response = await fetch(`/shows/${showId}/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const status: StatusResponse = await response.json();
    updateControlPanelUI(status);
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

/**
 * Update the control panel UI based on status
 */
function updateControlPanelUI(status: StatusResponse): void {
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
    } else if (percentUsed >= 70) {
      tokenProgressEl.style.backgroundColor = 'var(--warning)';
    } else {
      tokenProgressEl.style.backgroundColor = 'var(--accent)';
    }
  } else {
    tokenProgressEl.style.width = '0%';
    tokenTextEl.textContent = '0 / 0';
  }

  // Update button states
  updateButtonStates();
}

/**
 * Update control button enabled/disabled states based on show status
 */
function updateButtonStates(): void {
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
function startStatusPolling(showId: string): void {
  stopStatusPolling();
  fetchStatus(showId).catch(console.error);
  statusPollInterval = setInterval(() => {
    fetchStatus(showId).catch(console.error);
  }, STATUS_POLL_INTERVAL_MS);
}

/**
 * Stop polling for show status
 */
function stopStatusPolling(): void {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

/**
 * Fetch characters for a show
 */
async function fetchCharacters(showId: string): Promise<void> {
  try {
    const response = await fetch(`/shows/${showId}/characters`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { characters: Character[] };
    characters = data.characters;

    // Initialize statuses
    characterStatuses.clear();
    for (const char of characters) {
      characterStatuses.set(char.id, 'waiting');
    }
    activeCharacterId = null;

    renderCharacterCards();
  } catch (err) {
    console.error('Failed to fetch characters:', err);
    addSystemMessage('Failed to load characters');
  }
}

/**
 * Render character cards
 */
function renderCharacterCards(): void {
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
function formatStatus(status: CharacterStatus): string {
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
function updateCharacterStatus(event: ShowEvent): void {
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
    } else {
      characterStatuses.set(senderId, 'speaking');
    }

    renderCharacterCards();
    return;
  }

  // Handle channel change events
  if (type === 'channel_change' && senderId) {
    if (channel === 'PRIVATE') {
      characterStatuses.set(senderId, 'in-private');
    } else {
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
async function connect(showId: string): Promise<void> {
  clearEvents();
  addSystemMessage('Connecting to show...');

  // Fetch characters and start status polling
  await fetchCharacters(showId);
  startStatusPolling(showId);

  const url = `/shows/${showId}/events`;
  eventSource = new EventSource(url);

  eventSource.onopen = (): void => {
    reconnectAttempts = 0;
    addSystemMessage('Connected to event stream');
    connectBtn.textContent = 'Disconnect';
  };

  eventSource.onmessage = (event: MessageEvent<string>): void => {
    try {
      const showEvent: ShowEvent = JSON.parse(event.data);
      addEventToFeed(showEvent);
      updateCharacterStatus(showEvent);

      // Count speech events as turns
      if (showEvent.type === 'speech') {
        turnCount++;
        turnNumberEl.textContent = String(turnCount);
      }
    } catch (err) {
      console.error('Failed to parse event:', err);
    }
  };

  eventSource.onerror = (): void => {
    if (eventSource?.readyState === EventSource.CLOSED) {
      addSystemMessage('Connection closed');
      attemptReconnect();
    } else if (eventSource?.readyState === EventSource.CONNECTING) {
      addSystemMessage('Reconnecting...');
    }
  };
}

/**
 * Disconnect from the current SSE stream
 */
function disconnect(): void {
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
function resetControlPanelUI(): void {
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
function attemptReconnect(): void {
  if (!currentShowId) return;

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
function clearEvents(): void {
  eventsContainer.innerHTML = '';
  turnCount = 0;
}

/**
 * Add a system message to the feed
 */
function addSystemMessage(message: string): void {
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
function addEventToFeed(event: ShowEvent): void {
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
function getChannelClass(channel: string | undefined): string {
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
function formatTime(timestamp: number): string {
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
function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Scroll the events container to the bottom
 */
function scrollToBottom(): void {
  eventsContainer.scrollTop = eventsContainer.scrollHeight;
}

/**
 * Open the new show modal and load data
 */
function openNewShowModal(): void {
  newShowModal.classList.remove('hidden');
  createError.classList.add('hidden');
  loadModalData().catch(console.error);
}

/**
 * Close the new show modal
 */
function closeNewShowModal(): void {
  newShowModal.classList.add('hidden');
  resetModalState();
}

/**
 * Reset modal state
 */
function resetModalState(): void {
  selectedTemplate = null;
  selectedCharacterIds.clear();
  templateSelect.value = '';
  templateInfo.textContent = '';
  charactersValidation.textContent = '';
  charactersValidation.className = 'validation-message';
  createShowBtn.disabled = true;
  createError.classList.add('hidden');
}

/**
 * Load templates and characters for the modal
 */
async function loadModalData(): Promise<void> {
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
  } catch (err) {
    console.error('Failed to load modal data:', err);
    templateSelect.innerHTML = '<option value="">Failed to load templates</option>';
    charactersList.innerHTML = '<p class="loading-text">Failed to load characters</p>';
  }
}

/**
 * Render template dropdown options
 */
function renderTemplateSelect(): void {
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
function renderCharacterCheckboxes(): void {
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
function handleTemplateChange(): void {
  const templateId = templateSelect.value;
  selectedTemplate = availableTemplates.find((t) => t.id === templateId) ?? null;

  if (selectedTemplate) {
    templateInfo.textContent = `${selectedTemplate.description} (${selectedTemplate.minParticipants}-${selectedTemplate.maxParticipants} participants)`;
  } else {
    templateInfo.textContent = '';
  }

  validateCharacterSelection();
}

/**
 * Handle character checkbox toggle
 */
function handleCharacterToggle(event: Event): void {
  const checkbox = event.target as HTMLInputElement;
  const charId = checkbox.value;

  if (checkbox.checked) {
    selectedCharacterIds.add(charId);
  } else {
    selectedCharacterIds.delete(charId);
  }

  validateCharacterSelection();
}

/**
 * Validate character selection against template limits
 */
function validateCharacterSelection(): void {
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
  } else if (count > maxParticipants) {
    charactersValidation.textContent = `Maximum ${maxParticipants} characters allowed (${count} selected)`;
    charactersValidation.className = 'validation-message error';
    createShowBtn.disabled = true;
  } else {
    charactersValidation.textContent = `${count} characters selected (valid)`;
    charactersValidation.className = 'validation-message valid';
    createShowBtn.disabled = false;
  }
}

/**
 * Handle create show button click
 */
async function handleCreateShow(): Promise<void> {
  if (!selectedTemplate || selectedCharacterIds.size === 0) {
    return;
  }

  createShowBtn.disabled = true;
  createError.classList.add('hidden');

  // Build characters array with full character data
  const selectedChars = availableCharacters.filter((c) =>
    selectedCharacterIds.has(c.id)
  );

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

    const result = await response.json() as { showId: string; status: string };

    // Close modal and connect to the new show
    closeNewShowModal();
    showIdInput.value = result.showId;
    await handleConnect();
  } catch (err) {
    console.error('Failed to create show:', err);
    createError.textContent = `Failed to create show: ${err instanceof Error ? err.message : 'Unknown error'}`;
    createError.classList.remove('hidden');
    createShowBtn.disabled = false;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
