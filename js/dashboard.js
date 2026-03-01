// ===========================
// Agent HQ - Dashboard Engine
// Supabase Realtime + Kanban
// ===========================

const SUPABASE_URL = 'https://dpdtxmhxyosunfryocqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHR4bWh4eW9zdW5mcnlvY3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyNjUwNDcsImV4cCI6MjA2OTg0MTA0N30.fOfk2ULUtNXzpQFEsMXD4mNZLNc4hSAh12NTJrSe0Vk';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State
let agents = [];
let tasks = [];
let activities = [];
let draggedTask = null;

// DOM refs
const agentStrip = document.getElementById('agentStrip');
const activityItems = document.getElementById('activityItems');
const lastSyncEl = document.getElementById('lastSync');
const connectionStatus = document.getElementById('connectionStatus');
const clearActivityBtn = document.getElementById('clearActivity');
const searchInput = document.getElementById('searchInput');
const agentsFullGrid = document.getElementById('agentsFullGrid');
const activityFullList = document.getElementById('activityFullList');

// ===== INIT =====
async function init() {
    await Promise.all([fetchAgents(), fetchTasks(), fetchActivity()]);
    renderAgentsView();
    renderActivityView();
    subscribeRealtime();
    setupNavigation();
    setupDragAndDrop();
    setupSearch();
    clearActivityBtn.addEventListener('click', () => { activities = []; renderActivityRail(); });
    setInterval(updateRelativeTimes, 30000);
}

// ===== DATA FETCHING =====
async function fetchAgents() {
    const { data, error } = await supabase
        .from('agents').select('*').order('created_at');
    if (!error && data) { agents = data; renderAgentStrip(); }
}

async function fetchTasks() {
    const { data, error } = await supabase
        .from('tasks').select('*').order('position').order('created_at');
    if (!error && data) { tasks = data; renderKanban(); }
}

async function fetchActivity() {
    const { data, error } = await supabase
        .from('activity_log').select('*').order('created_at', { ascending: false }).limit(50);
    if (!error && data) { activities = data; renderActivityRail(); }
}

// ===== REALTIME =====
function subscribeRealtime() {
    supabase.channel('all-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, (p) => {
            handleChange(agents, p);
            renderAgentStrip();
            renderAgentsView();
            syncLastUpdate();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (p) => {
            handleChange(tasks, p);
            renderKanban();
            syncLastUpdate();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (p) => {
            activities.unshift(p.new);
            if (activities.length > 100) activities.length = 100;
            renderActivityRail();
            renderActivityView();
            syncLastUpdate();
        })
        .subscribe((status) => {
            updateConnection(status === 'SUBSCRIBED');
        });
}

function handleChange(arr, payload) {
    const { eventType } = payload;
    if (eventType === 'UPDATE') {
        const idx = arr.findIndex(r => r.id === payload.new.id);
        if (idx !== -1) arr[idx] = payload.new;
    } else if (eventType === 'INSERT') {
        arr.push(payload.new);
    } else if (eventType === 'DELETE') {
        const idx = arr.findIndex(r => r.id === payload.old.id);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

// ===== RENDER: AGENT STRIP =====
function renderAgentStrip() {
    agentStrip.innerHTML = agents.map(a => {
        const s = a.status || 'offline';
        const classes = ['agent-chip',
            s === 'working' ? 'is-working' : '',
            a.role?.toLowerCase().includes('orchestrator') ? 'is-orchestrator' : ''
        ].filter(Boolean).join(' ');

        return `<div class="${classes}" style="--chip-accent:${a.accent_color || '#3b82f6'}">
            <div class="chip-avatar">${a.avatar_emoji || '🤖'}</div>
            <div class="chip-info">
                <div class="chip-name">${esc(a.name)}</div>
                <div class="chip-role">${esc(a.role || 'Agent')}</div>
            </div>
            <div class="chip-status ${s}">
                <span class="chip-status-dot"></span>
                ${statusLabel(s)}
            </div>
        </div>`;
    }).join('');
}

// ===== RENDER: KANBAN =====
function renderKanban() {
    const statuses = ['todo', 'in_progress', 'done', 'archived'];
    statuses.forEach(status => {
        const col = document.querySelector(`[data-drop="${status}"]`);
        const countEl = document.querySelector(`[data-count="${status}"]`);
        const filtered = tasks.filter(t => t.status === status);
        countEl.textContent = filtered.length;

        col.innerHTML = filtered.map(t => {
            const agent = agents.find(a => a.id === t.agent_id);
            return `<div class="task-card" draggable="true" data-task-id="${t.id}">
                <div class="task-card-title">${esc(t.title)}</div>
                <div class="task-card-meta">
                    <div class="task-card-agent">
                        <span class="task-agent-dot" style="background:${agent?.accent_color || '#6b7280'}"></span>
                        ${esc(agent?.name || 'Unassigned')}
                    </div>
                    <div class="task-card-date">${formatDate(t.created_at)}</div>
                </div>
            </div>`;
        }).join('');
    });
}

// ===== RENDER: ACTIVITY RAIL =====
function renderActivityRail() {
    if (activities.length === 0) {
        activityItems.innerHTML = '<div class="rail-empty">No activity yet</div>';
        return;
    }
    activityItems.innerHTML = activities.map(item => {
        const agent = agents.find(a => a.id === item.agent_id);
        const color = agent?.accent_color || '#3b82f6';
        return `<div class="act-item">
            <span class="act-dot" style="background:${color}"></span>
            <div class="act-content">
                <div class="act-text"><strong>${esc(item.agent_name || agent?.name || '')}</strong> ${esc(item.details || item.action)}</div>
                <div class="act-time" data-time="${item.created_at}">${timeAgo(item.created_at)}</div>
            </div>
        </div>`;
    }).join('');
}

// ===== RENDER: AGENTS FULL VIEW =====
function renderAgentsView() {
    if (agents.length === 0) {
        agentsFullGrid.innerHTML = '<div class="agents-empty">No agents registered</div>';
        return;
    }
    agentsFullGrid.innerHTML = agents.map(a => {
        const s = a.status || 'offline';
        const classes = ['agent-full-card',
            s === 'working' ? 'is-working' : '',
            a.role?.toLowerCase().includes('orchestrator') ? 'is-orchestrator' : ''
        ].filter(Boolean).join(' ');

        const lastSeen = a.last_seen ? timeAgo(a.last_seen) : 'never';

        // Count tasks by status for this agent
        const agentTasks = tasks.filter(t => t.agent_id === a.id);
        const taskCounts = {
            todo: agentTasks.filter(t => t.status === 'todo').length,
            in_progress: agentTasks.filter(t => t.status === 'in_progress').length,
            done: agentTasks.filter(t => t.status === 'done').length,
        };
        const totalTasks = agentTasks.length;

        // Get the active task (in_progress) for display
        const activeTask = agentTasks.find(t => t.status === 'in_progress');
        const taskDisplay = activeTask ? activeTask.title : (a.current_task || null);

        return `<div class="${classes}" style="--card-accent:${a.accent_color || '#3b82f6'}">
            <div class="afc-header">
                <div class="afc-avatar">${a.avatar_emoji || '🤖'}</div>
                <div class="afc-badge ${s}">
                    <span class="afc-badge-dot"></span>
                    ${statusLabel(s)}
                </div>
            </div>
            <div class="afc-name">${esc(a.name)}</div>
            <div class="afc-role">${esc(a.role || 'Agent')}</div>
            <div class="afc-task">
                <div class="afc-task-label">Current Task</div>
                <div class="afc-task-text ${!taskDisplay ? 'empty' : ''}">${taskDisplay ? esc(taskDisplay) : 'No task assigned'}</div>
            </div>
            <div class="afc-stats">
                <div class="afc-stat">
                    <span class="afc-stat-count">${taskCounts.in_progress}</span>
                    <span class="afc-stat-label">Active</span>
                </div>
                <div class="afc-stat">
                    <span class="afc-stat-count">${taskCounts.todo}</span>
                    <span class="afc-stat-label">Queued</span>
                </div>
                <div class="afc-stat">
                    <span class="afc-stat-count">${taskCounts.done}</span>
                    <span class="afc-stat-label">Done</span>
                </div>
            </div>
            ${agentTasks.length > 0 ? `
            <div class="afc-task-list">
                <div class="afc-task-label">Task History</div>
                ${agentTasks.slice(0, 5).map(t => {
                    const icon = { todo: '📋', in_progress: '⚡', done: '✅', archived: '📦' }[t.status] || '📋';
                    return `<div class="afc-task-item ${t.status}">
                        <span class="afc-task-icon">${icon}</span>
                        <span class="afc-task-item-title">${esc(t.title)}</span>
                    </div>`;
                }).join('')}
            </div>` : ''}
            <div class="afc-footer">
                <span class="afc-model">${esc(a.model || 'N/A')}</span>
                <span class="afc-last-seen" data-time="${a.last_seen || ''}">Last seen: ${lastSeen}</span>
            </div>
        </div>`;
    }).join('');
}

// ===== RENDER: ACTIVITY FULL VIEW =====
function renderActivityView() {
    activityFullList.innerHTML = activities.map(item => {
        const agent = agents.find(a => a.id === item.agent_id);
        const color = agent?.accent_color || '#3b82f6';
        return `<div class="afl-item">
            <span class="afl-dot" style="background:${color}"></span>
            <div class="afl-content">
                <div class="afl-text"><strong>${esc(item.agent_name || agent?.name || '')}</strong> ${esc(item.details || item.action)}</div>
                <div class="afl-time" data-time="${item.created_at}">${timeAgo(item.created_at)}</div>
            </div>
        </div>`;
    }).join('');
}

// ===== NAVIGATION =====
function setupNavigation() {
    const views = { dashboard: 'dashboardView', agents: 'agentsView', activity: 'activityView' };
    const titles = { dashboard: ['Dashboard', 'Real-time agent monitoring'], agents: ['Agents', `${agents.length} agents configured`], activity: ['Activity', 'Full activity log'] };

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;

            // Update nav
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update views
            document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
            document.getElementById(views[view]).classList.add('active');

            // Update header
            document.getElementById('pageTitle').textContent = titles[view][0];
            document.getElementById('pageSubtitle').textContent = titles[view][1];

            // Render view content on switch
            if (view === 'agents') renderAgentsView();
            if (view === 'activity') renderActivityView();
        });
    });
}

// ===== DRAG AND DROP =====
function setupDragAndDrop() {
    document.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.task-card');
        if (!card) return;
        draggedTask = card.dataset.taskId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    document.addEventListener('dragend', (e) => {
        const card = e.target.closest('.task-card');
        if (card) card.classList.remove('dragging');
        document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
        draggedTask = null;
    });

    document.querySelectorAll('.col-body').forEach(dropZone => {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (!draggedTask) return;

            const newStatus = dropZone.dataset.drop;
            const task = tasks.find(t => t.id === draggedTask);
            if (!task || task.status === newStatus) return;

            // Optimistic update
            task.status = newStatus;
            renderKanban();

            // Persist to Supabase
            const { error } = await supabase
                .from('tasks')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', draggedTask);

            if (error) {
                console.error('Failed to update task:', error);
                await fetchTasks(); // Revert on failure
            }
        });
    });
}

// ===== SEARCH =====
function setupSearch() {
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
            renderKanban();
            return;
        }
        // Filter task cards visually
        document.querySelectorAll('.task-card').forEach(card => {
            const title = card.querySelector('.task-card-title')?.textContent?.toLowerCase() || '';
            const agent = card.querySelector('.task-card-agent')?.textContent?.toLowerCase() || '';
            card.style.display = (title.includes(q) || agent.includes(q)) ? '' : 'none';
        });
    });
}

// ===== UTILITIES =====
function syncLastUpdate() {
    lastSyncEl.textContent = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Europe/Amsterdam'
    });
}

function updateConnection(connected) {
    const dot = connectionStatus.querySelector('.conn-dot');
    const text = connectionStatus.querySelector('.conn-text');
    dot.className = connected ? 'conn-dot connected' : 'conn-dot disconnected';
    text.textContent = connected ? 'Live' : 'Offline';
}

function updateRelativeTimes() {
    document.querySelectorAll('[data-time]').forEach(el => {
        el.textContent = timeAgo(el.dataset.time);
    });
}

function timeAgo(dateStr) {
    if (!dateStr) return 'never';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 10) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-GB', {
        month: 'short', day: 'numeric', year: 'numeric',
        timeZone: 'Europe/Amsterdam'
    });
}

function statusLabel(str) {
    if (!str) return 'Offline';
    const labels = {
        working: 'Connected',
        idle: 'Idle',
        blocked: 'Blocked',
        offline: 'Offline'
    };
    return labels[str] || cap(str);
}

function cap(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).replace('_', ' ');
}

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ===== START =====
init();
