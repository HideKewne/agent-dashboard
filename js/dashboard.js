// ===========================
// Agent HQ - Dashboard Engine
// Supabase Realtime + Kanban
// ===========================

const SUPABASE_URL = 'https://dpdtxmhxyosunfryocqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHR4bWh4eW9zdW5mcnlvY3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyNjUwNDcsImV4cCI6MjA2OTg0MTA0N30.fOfk2ULUtNXzpQFEsMXD4mNZLNc4hSAh12NTJrSe0Vk';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    // Wire up navigation FIRST so view switching always works
    setupNavigation();
    setupDragAndDrop();
    setupSearch();
    clearActivityBtn.addEventListener('click', () => { activities = []; renderActivityRail(); });

    try {
        await Promise.all([fetchAgents(), fetchTasks(), fetchActivity()]);
        renderAgentsView();
        renderActivityView();
        subscribeRealtime();
    } catch (e) {
        console.error('Init data load error:', e);
    }
    setInterval(updateRelativeTimes, 30000);
}

// ===== DATA FETCHING =====
async function fetchAgents() {
    const { data, error } = await db
        .from('agents').select('*').order('created_at');
    if (!error && data) { agents = data; renderAgentStrip(); }
}

async function fetchTasks() {
    const { data, error } = await db
        .from('tasks').select('*').order('position').order('created_at');
    if (!error && data) { tasks = data; renderKanban(); }
}

async function fetchActivity() {
    const { data, error } = await db
        .from('activity_log').select('*').order('created_at', { ascending: false }).limit(50);
    if (!error && data) { activities = data; renderActivityRail(); }
}

// ===== REALTIME =====
function subscribeRealtime() {
    db.channel('all-changes')
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
            const statusClass = { todo: 'todo', in_progress: 'in-progress', done: 'done', archived: 'archived' }[t.status] || 'todo';
            const statusText = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', archived: 'Archived' }[t.status] || t.status;
            return `<div class="task-card" draggable="true" data-task-id="${t.id}">
                <div class="task-card-header">
                    <div class="task-card-title">${esc(t.title)}</div>
                    <span class="task-status-badge ${statusClass}">
                        <span class="task-status-dot"></span>
                        ${statusText}
                    </span>
                </div>
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
function renderAgentsSummary() {
    const el = document.getElementById('agentsSummary');
    if (!el) return;
    const online = agents.filter(a => a.status === 'working').length;
    const idle = agents.filter(a => a.status === 'idle').length;
    const offline = agents.filter(a => a.status === 'offline' || !a.status).length;
    const totalTasks = tasks.length;
    const activeTasks = tasks.filter(t => t.status === 'in_progress').length;

    el.innerHTML = `
        <div class="avs-item"><span class="avs-count">${agents.length}</span><span class="avs-label">Total Agents</span></div>
        <div class="avs-divider"></div>
        <div class="avs-item"><span class="avs-dot working"></span><span class="avs-count">${online}</span><span class="avs-label">Online</span></div>
        <div class="avs-item"><span class="avs-dot idle"></span><span class="avs-count">${idle}</span><span class="avs-label">Idle</span></div>
        <div class="avs-item"><span class="avs-dot offline"></span><span class="avs-count">${offline}</span><span class="avs-label">Offline</span></div>
        <div class="avs-divider"></div>
        <div class="avs-item"><span class="avs-count">${activeTasks}</span><span class="avs-label">Active Tasks</span></div>
        <div class="avs-item"><span class="avs-count">${totalTasks}</span><span class="avs-label">Total Tasks</span></div>
    `;
}

function renderAgentsView() {
    renderAgentsSummary();
    if (agents.length === 0) {
        agentsFullGrid.innerHTML = '<div class="agents-empty"><div class="agents-empty-icon">🐾</div><div class="agents-empty-text">No agents registered</div><div class="agents-empty-sub">Agents will appear here when they come online</div></div>';
        return;
    }

    agentsFullGrid.innerHTML = agents.map(a => {
        const s = a.status || 'offline';
        const classes = ['agent-profile-card',
            s === 'working' ? 'is-working' : '',
            a.role?.toLowerCase().includes('orchestrator') ? 'is-orchestrator' : ''
        ].filter(Boolean).join(' ');

        const lastSeen = a.last_seen ? timeAgo(a.last_seen) : 'never';
        const uptimeStr = a.last_seen ? getUptime(a.created_at) : 'N/A';

        // Count tasks by status for this agent
        const agentTasks = tasks.filter(t => t.agent_id === a.id);
        const taskCounts = {
            todo: agentTasks.filter(t => t.status === 'todo').length,
            in_progress: agentTasks.filter(t => t.status === 'in_progress').length,
            done: agentTasks.filter(t => t.status === 'done').length,
            archived: agentTasks.filter(t => t.status === 'archived').length,
        };

        // Active task
        const activeTask = agentTasks.find(t => t.status === 'in_progress');
        const taskDisplay = activeTask ? activeTask.title : (a.current_task || null);
        const taskCompleted = !activeTask && taskDisplay && /^completed/i.test(taskDisplay);

        // Agent-specific activity (last 8)
        const agentActivity = activities.filter(act => act.agent_id === a.id).slice(0, 8);

        return `<div class="${classes}" style="--card-accent:${a.accent_color || '#3b82f6'}">
            <!-- Header: Avatar + Identity + Status -->
            <div class="apc-header">
                <div class="apc-identity">
                    <div class="apc-avatar">${a.avatar_emoji || '🤖'}</div>
                    <div class="apc-identity-text">
                        <div class="apc-name">${esc(a.name)}</div>
                        <div class="apc-role">${esc(a.role || 'Agent')}</div>
                    </div>
                </div>
                <div class="apc-status-badge ${s}">
                    <span class="apc-status-dot"></span>
                    ${statusLabel(s)}
                </div>
            </div>

            <!-- Current Task Panel -->
            <div class="apc-current-task ${taskDisplay ? 'has-task' : ''} ${taskCompleted ? 'task-completed' : ''}">
                <div class="apc-section-label">Current Task</div>
                ${taskDisplay ? `
                    <div class="apc-task-active">
                        <span class="apc-task-pulse ${taskCompleted ? 'pulse-green' : ''}"></span>
                        <span class="apc-task-title">${esc(taskDisplay)}</span>
                    </div>
                ` : `
                    <div class="apc-task-idle">No active task</div>
                `}
            </div>

            <!-- Stats Grid -->
            <div class="apc-stats">
                <div class="apc-stat">
                    <span class="apc-stat-value">${taskCounts.in_progress}</span>
                    <span class="apc-stat-key">Active</span>
                </div>
                <div class="apc-stat">
                    <span class="apc-stat-value">${taskCounts.todo}</span>
                    <span class="apc-stat-key">Queued</span>
                </div>
                <div class="apc-stat">
                    <span class="apc-stat-value">${taskCounts.done}</span>
                    <span class="apc-stat-key">Done</span>
                </div>
                <div class="apc-stat">
                    <span class="apc-stat-value">${taskCounts.archived}</span>
                    <span class="apc-stat-key">Archived</span>
                </div>
            </div>

            <!-- Task Queue -->
            ${agentTasks.length > 0 ? `
            <div class="apc-task-queue">
                <div class="apc-section-label">Tasks</div>
                ${agentTasks.slice(0, 6).map(t => {
                    const icon = { todo: '📋', in_progress: '⚡', done: '✅', archived: '📦' }[t.status] || '📋';
                    return `<div class="apc-queue-item ${t.status}">
                        <span class="apc-queue-icon">${icon}</span>
                        <span class="apc-queue-title">${esc(t.title)}</span>
                        <span class="apc-queue-badge">${cap(t.status)}</span>
                    </div>`;
                }).join('')}
            </div>` : ''}

            <!-- Recent Activity -->
            ${agentActivity.length > 0 ? `
            <div class="apc-activity">
                <div class="apc-section-label">Recent Activity</div>
                <div class="apc-activity-list">
                    ${agentActivity.map(act => `
                        <div class="apc-act-item">
                            <div class="apc-act-line"></div>
                            <div class="apc-act-content">
                                <div class="apc-act-text">${esc(act.details || act.action)}</div>
                                <div class="apc-act-time" data-time="${act.created_at}">${timeAgo(act.created_at)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}

            <!-- Footer: Model + Meta -->
            <div class="apc-footer">
                <div class="apc-meta-row">
                    <span class="apc-meta-label">Model</span>
                    <span class="apc-meta-value apc-model-tag">${esc(a.model || 'N/A')}</span>
                </div>
                <div class="apc-meta-row">
                    <span class="apc-meta-label">Uptime</span>
                    <span class="apc-meta-value">${uptimeStr}</span>
                </div>
                <div class="apc-meta-row">
                    <span class="apc-meta-label">Last Seen</span>
                    <span class="apc-meta-value" data-time="${a.last_seen || ''}">${lastSeen}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function getUptime(createdAt) {
    if (!createdAt) return 'N/A';
    const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
    const days = Math.floor(diff / 86400);
    const hrs = Math.floor((diff % 86400) / 3600);
    return `${days}d ${hrs}h`;
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
    const getSubtitle = (view) => {
        if (view === 'agents') {
            const online = agents.filter(a => a.status === 'working').length;
            return `${agents.length} agent${agents.length !== 1 ? 's' : ''} registered, ${online} online`;
        }
        if (view === 'activity') return `${activities.length} events logged`;
        return 'Real-time agent monitoring';
    };
    const titles = { dashboard: 'Dashboard', agents: 'Agents', activity: 'Activity' };

    function switchView(view) {
        // Update sidebar nav
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const sidebarLink = document.querySelector(`.nav-link[data-view="${view}"]`);
        if (sidebarLink) sidebarLink.classList.add('active');

        // Update mobile nav
        document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
        const mobileBtn = document.querySelector(`.mobile-nav-btn[data-view="${view}"]`);
        if (mobileBtn) mobileBtn.classList.add('active');

        // Update views
        document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
        document.getElementById(views[view]).classList.add('active');

        // Update header
        document.getElementById('pageTitle').textContent = titles[view];
        document.getElementById('pageSubtitle').textContent = getSubtitle(view);

        // Render view content on switch
        if (view === 'agents') renderAgentsView();
        if (view === 'activity') renderActivityView();
    }

    // Sidebar links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(link.dataset.view);
        });
    });

    // Mobile bottom nav
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(btn.dataset.view);
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
            const { error } = await db
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

// ===== ADD TASK MODAL =====
function setupAddTaskModal() {
    const modal = document.getElementById('taskModal');
    const openBtn = document.getElementById('addTaskBtn');
    const closeBtn = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('modalCancel');
    const form = document.getElementById('taskForm');
    const agentSelect = document.getElementById('taskAgent');

    function openModal() {
        // Populate agent dropdown
        agentSelect.innerHTML = agents.map(a =>
            `<option value="${a.id}">${a.avatar_emoji || '🤖'} ${esc(a.name)}</option>`
        ).join('');
        if (agents.length === 0) {
            agentSelect.innerHTML = '<option value="">No agents available</option>';
        }
        modal.classList.add('active');
        document.getElementById('taskTitle').focus();
    }

    function closeModal() {
        modal.classList.remove('active');
        form.reset();
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('.btn-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDesc').value.trim();
        const status = document.getElementById('taskStatus').value;
        const agentId = document.getElementById('taskAgent').value || null;

        const { data, error } = await db
            .from('tasks')
            .insert([{
                title,
                description: description || null,
                status,
                agent_id: agentId,
                position: tasks.length,
            }])
            .select();

        if (error) {
            console.error('Failed to create task:', error);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Task';
            return;
        }

        // Log activity
        const agent = agents.find(a => a.id === agentId);
        await db.from('activity_log').insert([{
            agent_id: agentId,
            agent_name: agent?.name || 'Manual',
            action: 'task_created',
            details: `Created task: ${title}`,
        }]);

        closeModal();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Task';
        await fetchTasks();
        renderAgentsView();
    });
}

// ===== START =====
init();
setupAddTaskModal();
