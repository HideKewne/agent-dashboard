// ===========================
// Agent Control Center
// Supabase Realtime Dashboard
// ===========================

const SUPABASE_URL = 'https://dpdtxmhxyosunfryocqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHR4bWh4eW9zdW5mcnlvY3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyNjUwNDcsImV4cCI6MjA2OTg0MTA0N30.fOfk2ULUtNXzpQFEsMXD4mNZLNc4hSAh12NTJrSe0Vk';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let agents = [];
let activities = [];
let startTime = Date.now();

// ---- DOM Elements ----
const agentsGrid = document.getElementById('agentsGrid');
const activityList = document.getElementById('activityList');
const agentCount = document.getElementById('agentCount');
const activeCount = document.getElementById('activeCount');
const uptimeEl = document.getElementById('uptime');
const supabaseStatus = document.getElementById('supabaseStatus');
const lastUpdate = document.getElementById('lastUpdate');
const connectionStatus = document.getElementById('connectionStatus');
const clearActivity = document.getElementById('clearActivity');

// ---- Initialize ----
async function init() {
    await fetchAgents();
    await fetchActivity();
    subscribeToChanges();
    updateUptime();
    setInterval(updateUptime, 60000);
    setInterval(updateRelativeTimes, 30000);
    clearActivity.addEventListener('click', () => {
        activities = [];
        renderActivity();
    });
}

// ---- Fetch Initial Data ----
async function fetchAgents() {
    const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching agents:', error);
        supabaseStatus.textContent = 'Error';
        supabaseStatus.style.color = 'var(--status-blocked)';
        return;
    }

    agents = data || [];
    supabaseStatus.textContent = 'Connected';
    supabaseStatus.style.color = 'var(--status-working)';
    renderAgents();
    updateStats();
}

async function fetchActivity() {
    const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error fetching activity:', error);
        return;
    }

    activities = data || [];
    renderActivity();
}

// ---- Realtime Subscriptions ----
function subscribeToChanges() {
    // Subscribe to agent changes
    supabase
        .channel('agents-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'agents'
        }, (payload) => {
            handleAgentChange(payload);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                updateConnectionUI(true);
            }
        });

    // Subscribe to activity log
    supabase
        .channel('activity-changes')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'activity_log'
        }, (payload) => {
            handleNewActivity(payload.new);
        })
        .subscribe();
}

function handleAgentChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'UPDATE') {
        const idx = agents.findIndex(a => a.id === newRecord.id);
        if (idx !== -1) {
            agents[idx] = newRecord;
        }
    } else if (eventType === 'INSERT') {
        agents.push(newRecord);
    } else if (eventType === 'DELETE') {
        agents = agents.filter(a => a.id !== oldRecord.id);
    }

    renderAgents();
    updateStats();
    updateLastUpdate();
}

function handleNewActivity(record) {
    activities.unshift(record);
    if (activities.length > 100) activities = activities.slice(0, 100);
    renderActivity();
    updateLastUpdate();
}

// ---- Render Functions ----
function renderAgents() {
    agentsGrid.innerHTML = agents.map(agent => {
        const statusClass = agent.status || 'offline';
        const isWorking = statusClass === 'working';
        const isOrchestrator = agent.role === 'orchestrator';
        const cardClasses = [
            'agent-card',
            isWorking ? 'is-working' : '',
            isOrchestrator ? 'is-orchestrator' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${cardClasses}" style="--card-accent: ${agent.accent_color || '#3b82f6'}">
                <div class="agent-card-header">
                    <div class="agent-avatar">${agent.avatar_emoji || '🤖'}</div>
                    <div class="agent-status-badge ${statusClass}">
                        <span class="agent-status-dot"></span>
                        ${capitalize(statusClass)}
                    </div>
                </div>
                <div class="agent-name">${escapeHtml(agent.name)}</div>
                <div class="agent-role">${escapeHtml(agent.role || 'Agent')}</div>
                <div class="agent-task">
                    <div class="agent-task-label">Current Task</div>
                    <div class="agent-task-text ${!agent.current_task ? 'empty' : ''}">
                        ${agent.current_task ? escapeHtml(agent.current_task) : 'No task assigned'}
                    </div>
                </div>
                <div class="agent-footer">
                    <span class="agent-last-seen" data-time="${agent.last_seen || agent.updated_at}">
                        ${timeAgo(agent.last_seen || agent.updated_at)}
                    </span>
                    <span class="agent-accent-dot" style="background: ${agent.accent_color || '#3b82f6'}"></span>
                </div>
            </div>
        `;
    }).join('');
}

function renderActivity() {
    if (activities.length === 0) {
        activityList.innerHTML = '<div class="activity-empty"><span>No activity yet</span></div>';
        return;
    }

    activityList.innerHTML = activities.map(item => {
        const agent = agents.find(a => a.id === item.agent_id);
        const color = agent?.accent_color || '#3b82f6';

        return `
            <div class="activity-item">
                <span class="activity-dot" style="background: ${color}"></span>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong>${escapeHtml(item.agent_name)}</strong>
                        ${escapeHtml(item.action)}${item.details ? ': ' + escapeHtml(item.details) : ''}
                    </div>
                    <div class="activity-time" data-time="${item.created_at}">${timeAgo(item.created_at)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ---- Utility Functions ----
function updateStats() {
    agentCount.textContent = agents.length;
    activeCount.textContent = agents.filter(a => a.status === 'working' || a.status === 'idle').length;
}

function updateUptime() {
    const mins = Math.floor((Date.now() - startTime) / 60000);
    if (mins < 60) {
        uptimeEl.textContent = `${mins}m`;
    } else {
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        uptimeEl.textContent = `${hrs}h ${rem}m`;
    }
}

function updateLastUpdate() {
    lastUpdate.textContent = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Amsterdam'
    });
}

function updateConnectionUI(connected) {
    const dot = connectionStatus.querySelector('.status-dot');
    const text = connectionStatus.querySelector('.status-text');
    if (connected) {
        dot.className = 'status-dot status-dot-connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'status-dot status-dot-disconnected';
        text.textContent = 'Disconnected';
    }
}

function updateRelativeTimes() {
    document.querySelectorAll('[data-time]').forEach(el => {
        el.textContent = timeAgo(el.dataset.time);
    });
}

function timeAgo(dateStr) {
    if (!dateStr) return 'never';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);

    if (diff < 10) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---- Start ----
init();
