// ===========================
// Agent HQ - Dashboard Engine
// Supabase Realtime + Kanban
// ===========================

const SUPABASE_URL = 'https://dpdtxmhxyosunfryocqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHR4bWh4eW9zdW5mcnlvY3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyNjUwNDcsImV4cCI6MjA2OTg0MTA0N30.fOfk2ULUtNXzpQFEsMXD4mNZLNc4hSAh12NTJrSe0Vk';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
});

// State
let agents = [];
let tasks = [];
let activities = [];
let taskEvents = {};  // Task events by agent_id for Recent Activity
let rejections = [];
let agentLogs = {};
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
        await Promise.all([fetchAgents(), fetchTasks(), fetchActivity(), fetchRejections()]);
        // Fetch agent logs and task events after agents are loaded
        await Promise.all([fetchAllAgentLogs(), fetchAllTaskEvents()]);
        renderAgentsView();
        renderActivityView();
        renderAnalyticsView();
        subscribeRealtime();
    } catch (e) {
        console.error('Init data load error:', e);
    }
    setInterval(updateRelativeTimes, 30000);

    // Polling fallback - refresh data every 10 seconds in case realtime isn't working
    setInterval(async () => {
        await Promise.all([fetchAgents(), fetchTasks()]);
        renderAgentStrip();
        renderKanban();
        syncLastUpdate();
    }, 10000);
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

async function fetchRejections() {
    // Try to fetch from qa_rejections table (may not exist yet)
    try {
        const { data, error } = await db
            .from('qa_rejections').select('*').order('rejected_at', { ascending: false }).limit(100);
        if (!error && data) { rejections = data; }
    } catch (e) {
        // Table doesn't exist yet, use empty array
        rejections = [];
    }
}

async function fetchAgentLogs(agentId) {
    // Try to fetch from agent_logs table (may not exist yet)
    try {
        const { data, error } = await db
            .from('agent_logs')
            .select('*')
            .eq('agent_id', agentId)
            .order('created_at', { ascending: false })
            .limit(50);
        if (!error && data) {
            agentLogs[agentId] = data;
            return data;
        }
    } catch (e) {
        // Table doesn't exist yet
        agentLogs[agentId] = [];
    }
    return [];
}

async function fetchAllAgentLogs() {
    // Fetch logs for all agents in parallel
    const promises = agents.map(a => fetchAgentLogs(a.id));
    await Promise.all(promises);
}

async function fetchTaskEvents(agentId) {
    // Fetch task events for a specific agent (for Recent Activity)
    try {
        const { data, error } = await db
            .from('task_events')
            .select('*, tasks(title)')
            .eq('agent_id', agentId)
            .order('created_at', { ascending: false })
            .limit(10);
        if (!error && data) {
            taskEvents[agentId] = data;
            return data;
        }
    } catch (e) {
        taskEvents[agentId] = [];
    }
    return [];
}

async function fetchAllTaskEvents() {
    // Fetch task events for all agents in parallel
    const promises = agents.map(a => fetchTaskEvents(a.id));
    await Promise.all(promises);
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
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_logs' }, (p) => {
            // Add new log to the correct agent's logs
            const agentId = p.new.agent_id;
            if (!agentLogs[agentId]) agentLogs[agentId] = [];
            agentLogs[agentId].unshift(p.new);
            if (agentLogs[agentId].length > 50) agentLogs[agentId].length = 50;
            renderAgentsView();
            syncLastUpdate();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_events' }, async (p) => {
            // Add new event to the correct agent's events
            const agentId = p.new.agent_id;
            if (!taskEvents[agentId]) taskEvents[agentId] = [];
            // Fetch task title for this event
            const { data } = await db.from('tasks').select('title').eq('id', p.new.task_id).single();
            p.new.tasks = data || { title: 'Unknown task' };
            taskEvents[agentId].unshift(p.new);
            if (taskEvents[agentId].length > 10) taskEvents[agentId].length = 10;
            renderAgentsView();
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

        // Use expandable cards for Done column
        if (status === 'done') {
            col.innerHTML = filtered.map(t => renderExpandableTaskCard(t)).join('');
        } else {
            col.innerHTML = filtered.map(t => {
                const agent = agents.find(a => a.id === t.agent_id);
                const statusClass = { todo: 'todo', in_progress: 'in-progress', done: 'done', archived: 'archived' }[t.status] || 'todo';
                const statusText = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', archived: 'Archived' }[t.status] || t.status;
                return `<div class="task-card" draggable="true" data-task-id="${t.id}">
                    <div class="task-card-header">
                        <div class="task-card-title">${esc(t.title)}</div>
                        <div class="task-card-actions">
                            <button class="task-delete-btn" onclick="event.stopPropagation(); deleteTask('${t.id}', '${esc(t.title).replace(/'/g, "\\'")}');" title="Delete task">🗑️</button>
                            <span class="task-status-badge ${statusClass}">
                                <span class="task-status-dot"></span>
                                ${statusText}
                            </span>
                        </div>
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
        }
    });
}

// Render expandable task card for Done column
// Uses same structure as regular cards, but with expand toggle and details section
function renderExpandableTaskCard(t) {
    const agent = agents.find(a => a.id === t.agent_id);
    return `<div class="task-card task-card-expandable" data-task-id="${t.id}" onclick="toggleTaskExpand('${t.id}')">
        <div class="task-card-header">
            <div class="task-card-title">
                <span class="task-expand-toggle">▶</span>
                ${esc(t.title)}
            </div>
            <div class="task-card-actions">
                <button class="task-delete-btn" onclick="event.stopPropagation(); deleteTask('${t.id}', '${esc(t.title).replace(/'/g, "\\'")}');" title="Delete task">🗑️</button>
                <span class="task-status-badge done">
                    <span class="task-status-dot"></span>
                    Done
                </span>
            </div>
        </div>
        <div class="task-card-meta">
            <div class="task-card-agent">
                <span class="task-agent-dot" style="background:${agent?.accent_color || '#6b7280'}"></span>
                ${esc(agent?.name || 'Unassigned')}
            </div>
            <div class="task-card-date">${formatDate(t.created_at)}</div>
        </div>
        <div class="task-card-details" data-loaded="false"></div>
    </div>`;
}

// Load and display task duration badge
async function loadTaskDurationBadge(taskId) {
    const duration = await getTaskDuration(taskId);
    const badge = document.getElementById(`duration-${taskId}`);
    if (badge && duration) {
        badge.textContent = formatDurationMins(duration);
    } else if (badge) {
        badge.textContent = '-';
    }
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

    // Health counts
    const healthyCount = agents.filter(a => getAgentHealth(a).status === 'healthy').length;
    const warningCount = agents.filter(a => getAgentHealth(a).status === 'warning').length;
    const criticalCount = agents.filter(a => getAgentHealth(a).status === 'critical').length;

    el.innerHTML = `
        <div class="avs-item"><span class="avs-count">${agents.length}</span><span class="avs-label">Total Agents</span></div>
        <div class="avs-divider"></div>
        <div class="avs-item"><span class="avs-dot working"></span><span class="avs-count">${online}</span><span class="avs-label">Online</span></div>
        <div class="avs-item"><span class="avs-dot idle"></span><span class="avs-count">${idle}</span><span class="avs-label">Idle</span></div>
        <div class="avs-item"><span class="avs-dot offline"></span><span class="avs-count">${offline}</span><span class="avs-label">Offline</span></div>
        <div class="avs-divider"></div>
        <div class="avs-item" title="Heartbeat Health">
            <span class="avs-dot" style="background: #10b981;"></span>
            <span class="avs-count">${healthyCount}</span>
            <span class="avs-label">Healthy</span>
        </div>
        <div class="avs-item" title="Missed 1-2 heartbeats">
            <span class="avs-dot" style="background: #eab308;"></span>
            <span class="avs-count">${warningCount}</span>
            <span class="avs-label">Warning</span>
        </div>
        <div class="avs-item" title="Missed 3+ heartbeats">
            <span class="avs-dot" style="background: #ef4444;"></span>
            <span class="avs-count">${criticalCount}</span>
            <span class="avs-label">Critical</span>
        </div>
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

        // Active task - only show if agent is working or has in_progress task
        const activeTask = agentTasks.find(t => t.status === 'in_progress');
        // Only show current_task fallback if agent status is 'working'
        const taskDisplay = activeTask ? activeTask.title : (s === 'working' ? a.current_task : null);
        const taskCompleted = !activeTask && taskDisplay && /^completed/i.test(taskDisplay);

        // Agent-specific activity from task_events (last 8)
        const agentActivity = (taskEvents[a.id] || []).slice(0, 8);

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

            <!-- Current Task Panel (only shown if there's a task) -->
            ${taskDisplay ? `
            <div class="apc-current-task has-task ${taskCompleted ? 'task-completed' : ''}">
                <div class="apc-section-label">Current Task</div>
                <div class="apc-task-active">
                    <span class="apc-task-pulse ${taskCompleted ? 'pulse-green' : ''}"></span>
                    <span class="apc-task-title">${esc(taskDisplay)}</span>
                </div>
            </div>
            ` : ''}

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

            <!-- Toggle Row: Recent Activity + Logs -->
            <div class="apc-toggles-row">
                <div class="apc-toggle-label" onclick="document.getElementById('activity-${a.id}').classList.toggle('expanded'); this.classList.toggle('expanded')">
                    <span class="apc-toggle-arrow">▶</span> RECENT ACTIVITY <span class="apc-toggle-count">(${agentActivity.length})</span>
                </div>
                <div class="apc-toggle-label" onclick="document.getElementById('logs-${a.id}').classList.toggle('expanded'); this.classList.toggle('expanded')">
                    <span class="apc-toggle-arrow">▶</span> LOGS <span class="apc-toggle-count">(${(agentLogs[a.id] || []).length})</span>
                </div>
            </div>

            <!-- Activity Panel (collapsible) -->
            <div class="apc-expandable-panel" id="activity-${a.id}">
                ${agentActivity.length > 0 ? agentActivity.map(act => {
                    const eventIcon = getEventIcon(act.event_type);
                    const taskTitle = act.tasks?.title || 'Unknown task';
                    const isQaAction = act.metadata?.is_qa_action || false;
                    const eventText = formatEventText(act.event_type, taskTitle, isQaAction);
                    return `<div class="apc-act-item">
                        <div class="apc-act-icon">${eventIcon}</div>
                        <div class="apc-act-content">
                            <div class="apc-act-text">${eventText}</div>
                            <div class="apc-act-time" data-time="${act.created_at}">${timeAgo(act.created_at)}</div>
                        </div>
                    </div>`;
                }).join('') : '<div class="apc-panel-empty">No recent activity</div>'}
            </div>

            <!-- Logs Panel (collapsible) -->
            <div class="apc-expandable-panel" id="logs-${a.id}">
                ${(agentLogs[a.id] || []).length > 0 ? (agentLogs[a.id] || []).map(log => {
                    const icon = getLogIcon(log.action_type);
                    const details = log.details || {};
                    const summary = getLogSummary(log);
                    return `<div class="apc-log-item">
                        <div class="apc-log-icon">${icon}</div>
                        <div class="apc-log-content">
                            <div class="apc-log-action">${esc(log.action_name || log.action_type)}</div>
                            <div class="apc-log-details">${summary}</div>
                            <div class="apc-log-time" data-time="${log.created_at}">${timeAgo(log.created_at)}</div>
                        </div>
                    </div>`;
                }).join('') : '<div class="apc-panel-empty">No logs yet</div>'}
            </div>

            <!-- Footer: Model + Meta + Health -->
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
                <div class="apc-meta-row">
                    <span class="apc-meta-label">Health</span>
                    <span class="health-indicator ${getAgentHealth(a).status}">
                        <span class="health-dot"></span>
                        ${getAgentHealth(a).label}
                    </span>
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

// ===== RENDER: ANALYTICS VIEW =====
function renderAnalyticsView() {
    // Summary cards
    const totalRejections = rejections.length;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyRejections = rejections.filter(r => new Date(r.rejected_at) > weekAgo).length;

    // Calculate rejection rate (rejections / total tasks attempted)
    const doneTasks = tasks.filter(t => t.status === 'done').length;
    const rejectionRate = doneTasks > 0 ? Math.round((totalRejections / (doneTasks + totalRejections)) * 100) : 0;

    // Calculate average fix time
    const fixedRejections = rejections.filter(r => r.fixed_at);
    let avgFixTime = '-';
    if (fixedRejections.length > 0) {
        const totalMinutes = fixedRejections.reduce((sum, r) => {
            const diff = (new Date(r.fixed_at) - new Date(r.rejected_at)) / 60000;
            return sum + diff;
        }, 0);
        const avgMinutes = Math.round(totalMinutes / fixedRejections.length);
        if (avgMinutes < 60) {
            avgFixTime = `${avgMinutes}m`;
        } else {
            avgFixTime = `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m`;
        }
    }

    document.getElementById('totalRejections').textContent = totalRejections;
    document.getElementById('weeklyRejections').textContent = weeklyRejections;
    document.getElementById('rejectionRate').textContent = `${rejectionRate}%`;
    document.getElementById('avgFixTime').textContent = avgFixTime;

    // Render trend chart (last 7 days)
    renderTrendChart();

    // Render top reasons
    renderTopReasons();

    // Render rejections table
    renderRejectionsTable();
}

function renderTrendChart() {
    const trendBars = document.getElementById('trendBars');
    if (!trendBars) return;

    // Group rejections by day for last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        days.push(date);
    }

    const dayCounts = days.map(day => {
        const nextDay = new Date(day);
        nextDay.setDate(nextDay.getDate() + 1);
        return rejections.filter(r => {
            const rDate = new Date(r.rejected_at);
            return rDate >= day && rDate < nextDay;
        }).length;
    });

    const maxCount = Math.max(...dayCounts, 1);

    trendBars.innerHTML = days.map((day, i) => {
        const height = Math.max((dayCounts[i] / maxCount) * 100, 5);
        const dayLabel = day.toLocaleDateString('en-US', { weekday: 'short' });
        return `<div class="chart-bar-group">
            <div class="chart-bar" style="height: ${height}%;" title="${dayCounts[i]} rejection(s)"></div>
            <span class="chart-bar-label">${dayLabel}</span>
        </div>`;
    }).join('');
}

function renderTopReasons() {
    const topReasons = document.getElementById('topReasons');
    if (!topReasons) return;

    if (rejections.length === 0) {
        topReasons.innerHTML = '<div class="no-data-message">No rejection data yet</div>';
        return;
    }

    // Group by category
    const categories = {};
    rejections.forEach(r => {
        const cat = r.category || 'Other';
        categories[cat] = (categories[cat] || 0) + 1;
    });

    // Sort by count
    const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCount = sorted[0]?.[1] || 1;

    topReasons.innerHTML = sorted.map(([cat, count]) => {
        const pct = (count / maxCount) * 100;
        return `<div class="reason-item">
            <span class="reason-label">${esc(cat)}</span>
            <div class="reason-bar">
                <div class="reason-bar-fill" style="width: ${pct}%;"></div>
            </div>
            <span class="reason-count">${count}</span>
        </div>`;
    }).join('');
}

function renderRejectionsTable() {
    const tbody = document.getElementById('rejectionsTableBody');
    if (!tbody) return;

    if (rejections.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data-message">No rejections recorded yet. Run the SQL migration to enable tracking.</td></tr>';
        return;
    }

    tbody.innerHTML = rejections.slice(0, 20).map(r => {
        const task = tasks.find(t => t.id === r.task_id);
        const fixTime = r.fixed_at ? formatDuration(new Date(r.fixed_at) - new Date(r.rejected_at)) : '-';
        const status = r.fixed_at ? '<span class="status-badge-fixed">Fixed</span>' : '<span class="status-badge-pending">Pending</span>';

        return `<tr>
            <td>${esc(task?.title || 'Unknown task')}</td>
            <td>${esc(r.rejection_reason?.substring(0, 50) || '-')}${r.rejection_reason?.length > 50 ? '...' : ''}</td>
            <td><span class="severity-badge ${r.severity || 'minor'}">${r.severity || 'minor'}</span></td>
            <td>${fixTime}</td>
            <td>${status}</td>
        </tr>`;
    }).join('');
}

function formatDuration(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

// Format duration from minutes (for task cards)
function formatDurationMins(mins) {
    if (!mins || mins < 1) return '-';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins === 0 ? `${hrs}h` : `${hrs}h ${remainingMins}m`;
}

// ===== AGENT HEALTH CALCULATION =====
function getAgentHealth(agent) {
    if (!agent.last_seen) return { status: 'critical', label: 'Never seen' };

    const lastSeen = new Date(agent.last_seen);
    const now = new Date();
    const hoursSince = (now - lastSeen) / (1000 * 60 * 60);
    const heartbeatInterval = agent.heartbeat_interval_minutes || 240; // default 4 hours
    const expectedHours = heartbeatInterval / 60;

    if (hoursSince < expectedHours * 1.5) {
        return { status: 'healthy', label: 'Healthy' };
    } else if (hoursSince < expectedHours * 3) {
        return { status: 'warning', label: 'Warning' };
    } else {
        return { status: 'critical', label: 'Critical' };
    }
}

// ===== NAVIGATION =====
function setupNavigation() {
    const views = { dashboard: 'dashboardView', agents: 'agentsView', activity: 'activityView', analytics: 'analyticsView' };
    const getSubtitle = (view) => {
        if (view === 'agents') {
            const online = agents.filter(a => a.status === 'working').length;
            return `${agents.length} agent${agents.length !== 1 ? 's' : ''} registered, ${online} online`;
        }
        if (view === 'activity') return `${activities.length} events logged`;
        if (view === 'analytics') return `${rejections.length} rejection${rejections.length !== 1 ? 's' : ''} tracked`;
        return 'Real-time agent monitoring';
    };
    const titles = { dashboard: 'Dashboard', agents: 'Agents', activity: 'Activity', analytics: 'Analytics' };

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

        // Update URL hash for persistence
        window.location.hash = view;

        // Render view content on switch
        if (view === 'agents') renderAgentsView();
        if (view === 'activity') renderActivityView();
        if (view === 'analytics') renderAnalyticsView();
    }

    // Check URL hash on load and switch to that view
    const hashView = window.location.hash.replace('#', '');
    if (hashView && ['dashboard', 'agents', 'activity', 'analytics'].includes(hashView)) {
        switchView(hashView);
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

// ===== DELETE TASK =====
async function deleteTask(taskId, taskTitle) {
    if (!confirm(`Delete task "${taskTitle}"?\n\nThis cannot be undone.`)) {
        return;
    }

    // Optimistic removal from UI
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (card) card.remove();

    // Remove from local array
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx > -1) tasks.splice(idx, 1);

    // First delete related records (foreign key constraints)
    // Delete task_events that reference this task
    const { error: eventsError } = await db
        .from('task_events')
        .delete()
        .eq('task_id', taskId);

    if (eventsError) {
        console.warn('Failed to delete task_events:', eventsError);
    }

    // Delete agent_logs that reference this task
    const { error: logsError } = await db
        .from('agent_logs')
        .delete()
        .eq('task_id', taskId);

    if (logsError) {
        console.warn('Failed to delete agent_logs:', logsError);
    }

    // Now delete the task itself
    const { error } = await db
        .from('tasks')
        .delete()
        .eq('id', taskId);

    if (error) {
        console.error('Failed to delete task:', error);
        alert('Failed to delete task. Please try again.');
        await fetchTasks(); // Restore on failure
        renderKanban();
    } else {
        console.log(`Task ${taskId} deleted successfully`);
        // Update counts
        document.querySelectorAll('.col-count').forEach(el => {
            const status = el.dataset.count;
            const count = tasks.filter(t => t.status === status).length;
            el.textContent = count;
        });
    }
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
        working: 'Working',
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

// ===== EVENT HELPERS =====
function getEventIcon(eventType) {
    const icons = {
        'todo': '📋',
        'assigned': '📌',
        'in_progress': '⚡',
        'pending_review': '🔍',
        'needs_fix': '🔧',
        'done': '✅',
        'archived': '📦',
        'blocked': '🚫'
    };
    return icons[eventType] || '📌';
}

function formatEventText(eventType, taskTitle, isQaAction = false) {
    // QA-specific actions for Juanita
    if (isQaAction) {
        if (eventType === 'done') {
            return `✓ Approved: <strong>${esc(taskTitle)}</strong>`;
        } else if (eventType === 'needs_fix') {
            return `✗ Rejected: <strong>${esc(taskTitle)}</strong>`;
        }
    }

    const templates = {
        'todo': `Created task: <strong>${esc(taskTitle)}</strong>`,
        'assigned': `Assigned: <strong>${esc(taskTitle)}</strong>`,
        'in_progress': `Started: <strong>${esc(taskTitle)}</strong>`,
        'pending_review': `Submitted for QA: <strong>${esc(taskTitle)}</strong>`,
        'needs_fix': `Rejected: <strong>${esc(taskTitle)}</strong>`,
        'done': `Completed: <strong>${esc(taskTitle)}</strong>`,
        'archived': `Archived: <strong>${esc(taskTitle)}</strong>`,
        'blocked': `Blocked: <strong>${esc(taskTitle)}</strong>`
    };
    return templates[eventType] || `${cap(eventType)}: <strong>${esc(taskTitle)}</strong>`;
}

// ===== LOG HELPERS =====
function getLogIcon(actionType) {
    const icons = {
        'cli_call': '🤖',
        'tool_call': '🔧',
        'api_call': '🌐',
        'status_change': '🔄',
        'task_update': '📋',
        'error': '❌',
        'read': '📖',
        'edit': '📝',
        'write': '✍️',
        'bash': '💻',
        'default': '📌'
    };
    return icons[actionType?.toLowerCase()] || icons.default;
}

function getLogSummary(log) {
    const details = log.details || {};
    const parts = [];

    if (details.model) parts.push(`Model: ${details.model}`);
    if (details.prompt_length) parts.push(`Prompt: ${formatBytes(details.prompt_length)}`);
    if (details.response_length) parts.push(`Response: ${formatBytes(details.response_length)}`);
    if (details.duration_ms) parts.push(`Duration: ${formatDuration(details.duration_ms)}`);
    if (details.file) parts.push(`File: ${details.file}`);
    if (details.command) parts.push(`Cmd: ${truncate(details.command, 40)}`);
    if (details.status) parts.push(`Status: ${details.status}`);

    return parts.length > 0 ? parts.join(' · ') : 'No details';
}

function formatBytes(chars) {
    if (chars < 1000) return `${chars} chars`;
    if (chars < 1000000) return `${(chars / 1000).toFixed(1)}K chars`;
    return `${(chars / 1000000).toFixed(2)}M chars`;
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

// ===== TASK TIME ESTIMATION =====
async function estimateTaskTime() {
    try {
        // Query task_events for completed tasks (assigned → done transitions)
        const { data: events, error } = await db
            .from('task_events')
            .select('task_id, event_type, created_at')
            .in('event_type', ['assigned', 'done'])
            .order('created_at', { ascending: true });

        if (error || !events || events.length < 6) {
            return null; // Not enough data
        }

        // Group by task_id and calculate duration
        const taskMap = {};
        events.forEach(e => {
            if (!taskMap[e.task_id]) taskMap[e.task_id] = {};
            taskMap[e.task_id][e.event_type] = new Date(e.created_at);
        });

        const durations = [];
        Object.values(taskMap).forEach(task => {
            if (task.assigned && task.done) {
                const mins = (task.done - task.assigned) / 60000;
                if (mins > 0 && mins < 480) { // Cap at 8 hours, ignore invalid
                    durations.push(mins);
                }
            }
        });

        if (durations.length < 3) return null; // Need at least 3 completed tasks
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        return Math.round(avg);
    } catch (e) {
        console.warn('Task estimation failed:', e);
        return null;
    }
}

function formatEstimate(mins) {
    if (mins < 60) return `~${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) return `~${hrs}h`;
    return `~${hrs}h ${remainingMins}m`;
}

// ===== EXPANDABLE TASK CARDS (Done Column) =====
// Cache for task durations and subtasks
const taskDurationsCache = {};
const subtasksCache = {};

// Fetch task duration from task_events table
async function getTaskDuration(taskId) {
    if (taskDurationsCache[taskId] !== undefined) {
        return taskDurationsCache[taskId];
    }

    try {
        const { data: events, error } = await db
            .from('task_events')
            .select('event_type, created_at')
            .eq('task_id', taskId)
            .in('event_type', ['assigned', 'done'])
            .order('created_at', { ascending: true });

        if (error || !events || events.length < 2) {
            taskDurationsCache[taskId] = null;
            return null;
        }

        const assigned = events.find(e => e.event_type === 'assigned');
        const done = events.find(e => e.event_type === 'done');

        if (!assigned || !done) {
            taskDurationsCache[taskId] = null;
            return null;
        }

        const mins = Math.round((new Date(done.created_at) - new Date(assigned.created_at)) / 60000);
        taskDurationsCache[taskId] = mins;
        return mins;
    } catch (e) {
        console.warn('Failed to fetch task duration:', e);
        taskDurationsCache[taskId] = null;
        return null;
    }
}

// Fetch subtasks for a parent task
async function getSubtasks(parentTaskId) {
    if (subtasksCache[parentTaskId] !== undefined) {
        return subtasksCache[parentTaskId];
    }

    try {
        const { data, error } = await db
            .from('tasks')
            .select('*')
            .eq('parent_task_id', parentTaskId)
            .order('position');

        if (error) {
            subtasksCache[parentTaskId] = [];
            return [];
        }

        subtasksCache[parentTaskId] = data || [];
        return data || [];
    } catch (e) {
        console.warn('Failed to fetch subtasks:', e);
        subtasksCache[parentTaskId] = [];
        return [];
    }
}

// Fetch task timeline from task_events
async function getTaskTimeline(taskId) {
    try {
        const { data: events, error } = await db
            .from('task_events')
            .select('event_type, created_at')
            .eq('task_id', taskId)
            .order('created_at', { ascending: true });

        if (error || !events || events.length === 0) return null;

        // Build timeline string from events
        const timeline = [];
        let prevTime = null;
        const statusLabels = {
            'assigned': 'assigned',
            'in_progress': 'in_progress',
            'pending_review': 'QA',
            'needs_fix': 'fix',
            'done': 'done'
        };

        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const label = statusLabels[e.event_type] || e.event_type;

            if (prevTime && i < events.length - 1) {
                const mins = Math.round((new Date(e.created_at) - prevTime) / 60000);
                if (mins > 0) {
                    timeline.push(`${label} (${formatDurationMins(mins)})`);
                } else {
                    timeline.push(label);
                }
            } else if (i === events.length - 1) {
                timeline.push(label);
            } else {
                timeline.push(label);
            }
            prevTime = new Date(e.created_at);
        }

        return timeline.join(' → ');
    } catch (e) {
        return null;
    }
}

// Toggle task card expansion
async function toggleTaskExpand(taskId) {
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!card) return;

    const isExpanded = card.classList.contains('expanded');

    if (isExpanded) {
        card.classList.remove('expanded');
        return;
    }

    // Expand and load details
    card.classList.add('expanded');

    const detailsEl = card.querySelector('.task-card-details');
    if (!detailsEl) return;

    // Check if already loaded
    if (detailsEl.dataset.loaded === 'true') return;

    // Show loading state
    detailsEl.innerHTML = '<div class="task-loading"><div class="task-loading-spinner"></div>Loading details...</div>';

    // Fetch data in parallel
    const [subtasks, timeline] = await Promise.all([
        getSubtasks(taskId),
        getTaskTimeline(taskId)
    ]);

    // Fetch durations for subtasks
    const subtaskDurations = await Promise.all(
        subtasks.map(st => getTaskDuration(st.id))
    );

    // Get total duration for this task
    const totalDuration = await getTaskDuration(taskId);

    // Render details
    let html = '';

    // Show total duration at top if available
    if (totalDuration) {
        html += `<div class="task-duration-summary">
            <span class="task-duration-icon">⏱️</span>
            <span class="task-duration-label">Total time:</span>
            <span class="task-duration-value">${formatDurationMins(totalDuration)}</span>
        </div>`;
    }

    if (subtasks.length > 0) {
        html += '<div class="subtask-section-label">Subtasks</div>';
        html += '<div class="subtask-list">';
        subtasks.forEach((st, i) => {
            const icon = { todo: '📋', in_progress: '⚡', done: '✅', archived: '📦' }[st.status] || '📋';
            const duration = subtaskDurations[i] ? formatDurationMins(subtaskDurations[i]) : '';
            html += `<div class="subtask-item">
                <span class="subtask-icon">${icon}</span>
                <span class="subtask-title">${esc(st.title)}</span>
                ${duration ? `<span class="subtask-duration">${duration}</span>` : ''}
            </div>`;
        });
        html += '</div>';
    }

    if (timeline) {
        html += `<div class="task-timeline">
            <span class="task-timeline-icon">📊</span>
            <span class="task-timeline-text">${timeline}</span>
        </div>`;
    }

    // If no details at all, show a message
    if (!totalDuration && subtasks.length === 0 && !timeline) {
        html = '<div class="task-no-subtasks">No details available</div>';
    }

    detailsEl.innerHTML = html;
    detailsEl.dataset.loaded = 'true';
}

// ===== ADD TASK MODAL =====
function setupAddTaskModal() {
    const modal = document.getElementById('taskModal');
    const openBtn = document.getElementById('addTaskBtn');
    const closeBtn = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('modalCancel');
    const form = document.getElementById('taskForm');
    const agentSelect = document.getElementById('taskAgent');

    async function openModal() {
        // Populate agent dropdown
        agentSelect.innerHTML = agents.map(a =>
            `<option value="${a.id}">${a.avatar_emoji || '🤖'} ${esc(a.name)}</option>`
        ).join('');
        if (agents.length === 0) {
            agentSelect.innerHTML = '<option value="">No agents available</option>';
        }

        // Show task time estimate
        const estimateEl = document.getElementById('taskEstimate');
        const estimate = await estimateTaskTime();
        if (estimate) {
            const doneTasks = tasks.filter(t => t.status === 'done').length;
            estimateEl.querySelector('.estimate-text').textContent =
                `Based on ${doneTasks} completed task${doneTasks !== 1 ? 's' : ''}, similar tasks take ${formatEstimate(estimate)} on average`;
            estimateEl.style.display = 'flex';
        } else {
            estimateEl.style.display = 'none';
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

        // Notify n8n workflow for task pickup (1-minute delay built into workflow)
        const createdTask = data[0];
        if (createdTask && createdTask.status === 'todo') {
            fetch('https://www.n8n.fairintech.com/webhook/a1b2c3d4-task-pickup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: createdTask.id })
            }).catch(err => console.warn('Failed to notify task pickup webhook:', err));
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
