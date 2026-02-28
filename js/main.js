/* ============================================================
   Agent Command Center — Shared JavaScript
   Supabase integration, Drag-and-Drop, Realtime subscriptions
   ============================================================ */

const SUPABASE_URL = 'https://dpdtxmhxyosunfryocqn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHR4bWh4eW9zdW5mcnlvY3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQyNjUwNDcsImV4cCI6MjA2OTg0MTA0N30.fOfk2ULUtNXzpQFEsMXD4mNZLNc4hSAh12NTJrSe0Vk';

let supabase;
let agents = [];
let tasks = [];
let activityLog = [];
let realtimeChannel = null;

/* ----------------------------------------------------------
   1. Supabase Client Initialization
   ---------------------------------------------------------- */
function initSupabase() {
    if (window.supabase && window.supabase.createClient) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return true;
    }
    console.error('Supabase JS library not loaded');
    return false;
}

/* ----------------------------------------------------------
   2. Data Fetching
   ---------------------------------------------------------- */
async function fetchAgents() {
    const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) {
        console.error('Error fetching agents:', error);
        return [];
    }
    agents = data || [];
    return agents;
}

async function fetchTasks() {
    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('position', { ascending: true });
    if (error) {
        console.error('Error fetching tasks:', error);
        return [];
    }
    tasks = data || [];
    return tasks;
}

async function fetchActivityLog(limit = 50) {
    const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error('Error fetching activity log:', error);
        return [];
    }
    activityLog = data || [];
    return activityLog;
}

async function fetchAllData() {
    await Promise.all([fetchAgents(), fetchTasks(), fetchActivityLog()]);
}

/* ----------------------------------------------------------
   3. Agent Helpers
   ---------------------------------------------------------- */
function getAgentById(agentId) {
    return agents.find(a => a.id === agentId) || null;
}

function getAgentName(agentId) {
    const agent = getAgentById(agentId);
    return agent ? agent.name : 'Unassigned';
}

function getAgentAvatar(agentId) {
    const agent = getAgentById(agentId);
    if (agent && agent.avatar_url) return agent.avatar_url;
    const name = agent ? agent.name : '?';
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    return initials;
}

function getStatusColor(status) {
    const colors = {
        working: '#10b981',
        idle: '#6b7280',
        blocked: '#eab308',
        offline: '#ef4444'
    };
    return colors[status] || '#6b7280';
}

function getPriorityLabel(priority) {
    const labels = { 1: 'Low', 2: 'Medium', 3: 'High' };
    return labels[priority] || 'Medium';
}

function getPriorityColor(priority) {
    const colors = { 1: '#10b981', 2: '#eab308', 3: '#ef4444' };
    return colors[priority] || '#eab308';
}

function getTaskStatusLabel(status) {
    const labels = {
        todo: 'PENDING',
        in_progress: 'RUNNING',
        done: 'COMPLETED',
        archived: 'ARCHIVED'
    };
    return labels[status] || status.toUpperCase();
}

function getTaskStatusColor(status) {
    const colors = {
        todo: '#6b7280',
        in_progress: '#10b981',
        done: '#3b82f6',
        archived: '#8b5cf6'
    };
    return colors[status] || '#6b7280';
}

/* ----------------------------------------------------------
   4. Time Formatting (Europe/Amsterdam)
   ---------------------------------------------------------- */
function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
        timeZone: 'Europe/Amsterdam',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatTimeShort(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Amsterdam',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

/* ----------------------------------------------------------
   5. Kanban Rendering
   ---------------------------------------------------------- */
const COLUMNS = ['todo', 'in_progress', 'done', 'archived'];
const COLUMN_LABELS = {
    todo: 'To Do',
    in_progress: 'In Progress',
    done: 'Done',
    archived: 'Archived'
};
const COLUMN_ICONS = {
    todo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
    in_progress: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>',
    done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    archived: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>'
};

function getTasksByStatus(status) {
    return tasks.filter(t => t.status === status).sort((a, b) => (a.position || 0) - (b.position || 0));
}

function renderKanbanColumns(variant) {
    COLUMNS.forEach(status => {
        const container = document.getElementById(`column-${status}`);
        if (!container) return;

        const columnTasks = getTasksByStatus(status);
        container.innerHTML = '';

        // Update count badge
        const countEl = document.getElementById(`count-${status}`);
        if (countEl) countEl.textContent = columnTasks.length;

        columnTasks.forEach(task => {
            const card = createTaskCard(task, variant);
            container.appendChild(card);
        });
    });
}

function createTaskCard(task, variant) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.setAttribute('draggable', 'true');
    card.dataset.taskId = task.id;
    card.dataset.status = task.status;

    const agent = getAgentById(task.agent_id);
    const agentName = agent ? agent.name : 'Unassigned';
    const agentInitials = agentName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const priorityColor = getPriorityColor(task.priority);
    const priorityLabel = getPriorityLabel(task.priority);
    const progress = task.status === 'done' ? 100 : task.status === 'in_progress' ? 60 : task.status === 'archived' ? 100 : 0;

    if (variant === 1) {
        card.innerHTML = `
            <div class="task-card-header">
                <span class="task-title">${escapeHtml(task.title)}</span>
                <span class="priority-badge" style="background: ${priorityColor}20; color: ${priorityColor}; border: 1px solid ${priorityColor}40;">
                    <span class="priority-dot" style="background: ${priorityColor};"></span>
                    ${priorityLabel}
                </span>
            </div>
            <p class="task-desc">${escapeHtml(truncate(task.description || '', 80))}</p>
            <div class="task-progress-bar">
                <div class="task-progress-fill" style="width: ${progress}%;"></div>
            </div>
            <div class="task-card-footer">
                <div class="task-agent">
                    <div class="task-agent-avatar">${agentInitials}</div>
                    <span class="task-agent-name">${escapeHtml(agentName)}</span>
                </div>
                <span class="task-time">${formatRelativeTime(task.updated_at || task.created_at)}</span>
            </div>
        `;
    } else {
        const statusLabel = getTaskStatusLabel(task.status);
        const statusColor = getTaskStatusColor(task.status);
        card.innerHTML = `
            <div class="task-card-header">
                <span class="task-title">${escapeHtml(task.title)}</span>
                <span class="task-status-badge" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">
                    ${statusLabel}
                </span>
            </div>
            <p class="task-desc">${escapeHtml(truncate(task.description || '', 80))}</p>
            <div class="task-meta-row">
                <span class="priority-badge" style="background: ${priorityColor}20; color: ${priorityColor}; border: 1px solid ${priorityColor}40;">
                    P${task.priority || 2}
                </span>
                <span class="task-due">${formatTime(task.updated_at || task.created_at)}</span>
            </div>
            <div class="task-progress-bar">
                <div class="task-progress-fill" style="width: ${progress}%;"></div>
            </div>
            <div class="task-card-footer">
                <div class="task-agent">
                    <div class="task-agent-avatar">${agentInitials}</div>
                    <span class="task-agent-name">${escapeHtml(agentName)}</span>
                </div>
                <div class="task-actions">
                    <button class="btn-action btn-view" onclick="viewTask('${task.id}')">View</button>
                    <button class="btn-action btn-edit" onclick="editTask('${task.id}')">Edit</button>
                </div>
            </div>
        `;
    }

    // Drag events
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    return card;
}

/* ----------------------------------------------------------
   6. HTML5 Drag and Drop
   ---------------------------------------------------------- */
let draggedCard = null;
let draggedTaskId = null;

function handleDragStart(e) {
    draggedCard = this;
    draggedTaskId = this.dataset.taskId;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.taskId);

    // Highlight valid drop zones
    document.querySelectorAll('.column-body').forEach(col => {
        col.classList.add('drop-target-highlight');
    });
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.column-body').forEach(col => {
        col.classList.remove('drop-target-highlight', 'drag-over');
    });
    draggedCard = null;
    draggedTaskId = null;
}

function initDropZones() {
    document.querySelectorAll('.column-body').forEach(column => {
        column.addEventListener('dragover', handleDragOver);
        column.addEventListener('dragenter', handleDragEnter);
        column.addEventListener('dragleave', handleDragLeave);
        column.addEventListener('drop', handleDrop);
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Insert placeholder at correct position
    const afterElement = getDragAfterElement(this, e.clientY);
    if (draggedCard) {
        if (afterElement == null) {
            this.appendChild(draggedCard);
        } else {
            this.insertBefore(draggedCard, afterElement);
        }
    }
}

function handleDragEnter(e) {
    e.preventDefault();
    this.classList.add('drag-over');
}

function handleDragLeave(e) {
    // Only remove class if actually leaving the container
    if (!this.contains(e.relatedTarget)) {
        this.classList.remove('drag-over');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = this.dataset.status;

    if (!taskId || !newStatus) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const oldStatus = task.status;
    if (oldStatus === newStatus) return;

    // Optimistic UI update
    task.status = newStatus;

    // Update position within column
    const columnTasks = getTasksByStatus(newStatus);
    const cards = Array.from(this.querySelectorAll('.task-card'));
    const newPosition = cards.findIndex(c => c.dataset.taskId === taskId);

    // Update in Supabase
    const { error } = await supabase
        .from('tasks')
        .update({
            status: newStatus,
            position: newPosition >= 0 ? newPosition : columnTasks.length,
            updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

    if (error) {
        console.error('Error updating task:', error);
        task.status = oldStatus;
        renderKanbanColumns(getCurrentVariant());
        return;
    }

    // Update counts
    updateColumnCounts();

    // Log the activity
    await logActivity(task.agent_id, 'task_moved', `Task "${task.title}" moved from ${COLUMN_LABELS[oldStatus]} to ${COLUMN_LABELS[newStatus]}`);
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateColumnCounts() {
    COLUMNS.forEach(status => {
        const countEl = document.getElementById(`count-${status}`);
        if (countEl) {
            countEl.textContent = getTasksByStatus(status).length;
        }
    });
}

/* ----------------------------------------------------------
   7. Realtime Subscriptions
   ---------------------------------------------------------- */
function setupRealtimeSubscriptions(variant) {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
        .channel('agent-command-center')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, (payload) => {
            handleAgentChange(payload, variant);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
            handleTaskChange(payload, variant);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log' }, (payload) => {
            handleActivityChange(payload, variant);
        })
        .subscribe((status) => {
            const indicator = document.getElementById('sync-status');
            if (indicator) {
                if (status === 'SUBSCRIBED') {
                    indicator.classList.add('connected');
                    indicator.classList.remove('disconnected');
                    indicator.title = 'Realtime: Connected';
                } else {
                    indicator.classList.remove('connected');
                    indicator.classList.add('disconnected');
                    indicator.title = 'Realtime: ' + status;
                }
            }
        });
}

function handleAgentChange(payload, variant) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    if (eventType === 'INSERT') {
        agents.push(newRecord);
    } else if (eventType === 'UPDATE') {
        const idx = agents.findIndex(a => a.id === newRecord.id);
        if (idx !== -1) agents[idx] = newRecord;
    } else if (eventType === 'DELETE') {
        agents = agents.filter(a => a.id !== oldRecord.id);
    }
    if (typeof renderAgents === 'function') renderAgents();
}

function handleTaskChange(payload, variant) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    if (eventType === 'INSERT') {
        tasks.push(newRecord);
    } else if (eventType === 'UPDATE') {
        const idx = tasks.findIndex(t => t.id === newRecord.id);
        if (idx !== -1) tasks[idx] = newRecord;
    } else if (eventType === 'DELETE') {
        tasks = tasks.filter(t => t.id !== oldRecord.id);
    }
    renderKanbanColumns(variant);
}

function handleActivityChange(payload, variant) {
    const { eventType, new: newRecord } = payload;
    if (eventType === 'INSERT') {
        activityLog.unshift(newRecord);
        if (activityLog.length > 100) activityLog.pop();
        if (typeof renderActivityFeed === 'function') renderActivityFeed();
        if (typeof addTickerItem === 'function') addTickerItem(newRecord);
    }
}

/* ----------------------------------------------------------
   8. Search Functionality
   ---------------------------------------------------------- */
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            filterTasks(e.target.value.trim().toLowerCase());
        }, 250);
    });
}

function filterTasks(query) {
    const allCards = document.querySelectorAll('.task-card');
    if (!query) {
        allCards.forEach(card => card.style.display = '');
        updateColumnCounts();
        return;
    }

    allCards.forEach(card => {
        const taskId = card.dataset.taskId;
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const matches = (task.title && task.title.toLowerCase().includes(query)) ||
                       (task.description && task.description.toLowerCase().includes(query));
        card.style.display = matches ? '' : 'none';
    });

    // Update visible counts
    COLUMNS.forEach(status => {
        const container = document.getElementById(`column-${status}`);
        const countEl = document.getElementById(`count-${status}`);
        if (container && countEl) {
            const visible = container.querySelectorAll('.task-card:not([style*="display: none"])').length;
            countEl.textContent = visible;
        }
    });
}

/* ----------------------------------------------------------
   9. Agent Status Update
   ---------------------------------------------------------- */
async function updateAgentStatus(agentId, newStatus) {
    const { error } = await supabase
        .from('agents')
        .update({
            status: newStatus,
            updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

    if (error) {
        console.error('Error updating agent status:', error);
        return false;
    }

    await logActivity(agentId, 'status_change', `Agent status changed to ${newStatus}`);
    return true;
}

async function updateAgentTask(agentId, currentTask) {
    const { error } = await supabase
        .from('agents')
        .update({
            current_task: currentTask,
            updated_at: new Date().toISOString()
        })
        .eq('id', agentId);

    if (error) {
        console.error('Error updating agent task:', error);
        return false;
    }
    return true;
}

/* ----------------------------------------------------------
   10. Activity Logging
   ---------------------------------------------------------- */
async function logActivity(agentId, action, details) {
    const { error } = await supabase
        .from('activity_log')
        .insert({
            agent_id: agentId,
            action: action,
            details: details,
            created_at: new Date().toISOString()
        });

    if (error) {
        console.error('Error logging activity:', error);
    }
}

/* ----------------------------------------------------------
   11. Utility Functions
   ---------------------------------------------------------- */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function getCurrentVariant() {
    return document.body.dataset.variant ? parseInt(document.body.dataset.variant) : 1;
}

function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

/* ----------------------------------------------------------
   12. Task CRUD (for View/Edit buttons in Variant 2)
   ---------------------------------------------------------- */
function viewTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const agent = getAgentById(task.agent_id);
    const modal = document.getElementById('task-modal');
    if (modal) {
        document.getElementById('modal-title').textContent = task.title;
        document.getElementById('modal-desc').textContent = task.description || 'No description';
        document.getElementById('modal-status').textContent = getTaskStatusLabel(task.status);
        document.getElementById('modal-agent').textContent = agent ? agent.name : 'Unassigned';
        document.getElementById('modal-priority').textContent = getPriorityLabel(task.priority);
        document.getElementById('modal-created').textContent = formatTime(task.created_at);
        document.getElementById('modal-updated').textContent = formatTime(task.updated_at);
        modal.classList.add('active');
    }
}

function editTask(taskId) {
    viewTask(taskId);
}

function closeModal() {
    const modal = document.getElementById('task-modal');
    if (modal) modal.classList.remove('active');
}

/* ----------------------------------------------------------
   13. Clock (Amsterdam time)
   ---------------------------------------------------------- */
function startClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;

    function update() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-GB', {
            timeZone: 'Europe/Amsterdam',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
    update();
    setInterval(update, 1000);
}

/* ----------------------------------------------------------
   14. Initialization
   ---------------------------------------------------------- */
async function initDashboard(variant) {
    document.body.dataset.variant = variant;

    if (!initSupabase()) {
        console.error('Failed to initialize Supabase');
        showConnectionError();
        return;
    }

    try {
        await fetchAllData();
        renderKanbanColumns(variant);
        if (typeof renderAgents === 'function') renderAgents();
        if (typeof renderActivityFeed === 'function') renderActivityFeed();
        initDropZones();
        setupSearch();
        setupRealtimeSubscriptions(variant);
        startClock();
    } catch (err) {
        console.error('Initialization error:', err);
        showConnectionError();
    }
}

function showConnectionError() {
    const main = document.querySelector('.kanban-board') || document.querySelector('main');
    if (main) {
        const banner = document.createElement('div');
        banner.className = 'connection-error';
        banner.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>Failed to connect to Supabase. Check your connection and reload.</span>
        `;
        main.prepend(banner);
    }
}
