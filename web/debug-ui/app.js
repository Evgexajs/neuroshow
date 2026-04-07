"use strict";
/**
 * Neuroshow Debug UI - SSE Client and Event Feed
 * Handles connection to /shows/:id/events and displays events in real-time
 */
// DOM Elements
const showIdInput = document.getElementById('show-id');
const connectBtn = document.getElementById('connect-btn');
const eventsContainer = document.getElementById('events-container');
// State
let eventSource = null;
let currentShowId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
/**
 * Initialize the application
 */
function init() {
    connectBtn.addEventListener('click', handleConnect);
    showIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleConnect();
        }
    });
}
/**
 * Handle connect button click
 */
function handleConnect() {
    const showId = showIdInput.value.trim();
    if (!showId) {
        alert('Please enter a Show ID');
        return;
    }
    if (eventSource) {
        disconnect();
    }
    currentShowId = showId;
    connect(showId);
}
/**
 * Connect to SSE endpoint for a show
 */
function connect(showId) {
    clearEvents();
    addSystemMessage('Connecting to show...');
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