// ============================================================================
// 1. CONSTANTES E ESTADO (Premissas 3 e 4: Sem Números Mágicos, Linguagem Ubíqua)
// ============================================================================
const CONSTANTS = {
  HTTP_UNAUTHORIZED: 401,
  GOAL_COMPLETION_PERCENTAGE: 100,
  LOCALE: 'pt-BR',
  CURRENCY: 'BRL',
  STORAGE_TOKEN: 'finansee_auth_token',
  STORAGE_USER: 'finansee_auth_user',
};

const CHART_COLORS = [
  '#4f46e5',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
];

const applicationState = {
  user: null,
  token: null,
  selectedMonth: 'all',
  searchQuery: '',
  transactions: [],
  dashboardData: null,
  incomeVsExpenseChart: null,
  categoryPieChart: null,
};

// ============================================================================
// 2. UTILITÁRIOS E FORMATAÇÃO (Premissa 5: Coesão)
// ============================================================================
function formatCurrencyBRL(amount) {
  return Number(amount || 0).toLocaleString(CONSTANTS.LOCALE, {
    style: 'currency',
    currency: CONSTANTS.CURRENCY,
  });
}

function formatDateToBrazilian(isoDateString) {
  if (!isoDateString) return '-';
  const [year, month, day] = isoDateString.split('-');
  return `${day}/${month}/${year}`;
}

async function fetchApi(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (applicationState.token) {
    headers.Authorization = `Bearer ${applicationState.token}`;
  }

  const separator = endpoint.includes('?') ? '&' : '?';
  const urlWithCacheBuster = `${endpoint}${separator}t=${Date.now()}`;

  const response = await fetch(urlWithCacheBuster, { ...options, headers, cache: 'no-store' });

  // Guard Clause para tratamento de erros (Premissa 6)
  if (response.status === CONSTANTS.HTTP_UNAUTHORIZED) {
    handleUserLogout();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Erro na requisição.');

  return payload;
}

// ============================================================================
// 3. FLUXO DE AUTENTICAÇÃO
// ============================================================================
function handleUserLogout() {
  applicationState.user = null;
  applicationState.token = null;
  localStorage.removeItem(CONSTANTS.STORAGE_USER);
  localStorage.removeItem(CONSTANTS.STORAGE_TOKEN);

  document.getElementById('app-layout').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const { user, token } = await fetchApi('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    saveUserSession(user, token);
    await startApplication();
  } catch (error) {
    showAuthFeedback(error.message);
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;

  try {
    const { user, token } = await fetchApi('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });

    saveUserSession(user, token);
    await startApplication();
  } catch (error) {
    showAuthFeedback(error.message);
  }
}

function saveUserSession(user, token) {
  applicationState.user = user;
  applicationState.token = token;
  localStorage.setItem(CONSTANTS.STORAGE_USER, JSON.stringify(user));
  localStorage.setItem(CONSTANTS.STORAGE_TOKEN, token);
}

function showAuthFeedback(message) {
  const feedbackEl = document.getElementById('auth-feedback');
  feedbackEl.textContent = message;
  feedbackEl.classList.remove('hidden');
}

// ============================================================================
// 4. ATUALIZAÇÃO DO DASHBOARD (Separado em funções menores - Premissa 5)
// ============================================================================
async function fetchAndRenderDashboardData() {
  try {
    const [dashboardData, transactions] = await Promise.all([
      fetchApi(`/api/dashboard?month=${applicationState.selectedMonth}`),
      fetchApi(`/api/transactions?month=${applicationState.selectedMonth}`),
    ]);

    applicationState.dashboardData = dashboardData;
    applicationState.transactions = transactions;

    populateMonthFilterSelect(dashboardData.monthlyComparison);
    updateSummaryCards(dashboardData.summary);
    updateCharts(dashboardData);
    renderRecentTransactions(dashboardData.recentTransactions);
    renderGoalsList(dashboardData.goals, 'dashboard-goals-list', false);
    renderGoalsList(dashboardData.goals, 'full-goals-grid', true);
    renderFullTransactionsTable();
  } catch (error) {
    console.error('Erro ao buscar dados:', error.message);
  }
}

function populateMonthFilterSelect(monthlyComparison) {
  const selectEl = document.getElementById('month-filter-select');
  const months = monthlyComparison.map((data) => data.month).reverse();

  let optionsHtml = '<option value="all">Todos os meses</option>';
  for (const month of months) {
    const isSelected = month === applicationState.selectedMonth ? 'selected' : '';
    optionsHtml += `<option value="${month}" ${isSelected}>${month}</option>`;
  }
  selectEl.innerHTML = optionsHtml;
}

function updateSummaryCards(summary) {
  document.getElementById('card-balance').textContent = formatCurrencyBRL(summary.currentBalance);
  document.getElementById('card-income').textContent = formatCurrencyBRL(summary.totalIncome);
  document.getElementById('card-expense').textContent = formatCurrencyBRL(summary.totalExpense);
  document.getElementById('card-saved').textContent = formatCurrencyBRL(summary.savedAmount);
  document.getElementById('card-savings-rate').textContent =
    `${summary.savingsRatePercentage}% poupado`;
}

// ============================================================================
// 5. FLUXO DE GRÁFICOS
// ============================================================================
function updateCharts(dashboardData) {
  const { monthlyComparison, expensesByCategory } = dashboardData;

  if (applicationState.incomeVsExpenseChart) applicationState.incomeVsExpenseChart.destroy();
  applicationState.incomeVsExpenseChart = new Chart(
    document.getElementById('income-vs-expense-chart'),
    {
      type: 'line',
      data: {
        labels: monthlyComparison.map((data) => data.month),
        datasets: [
          {
            label: 'Receitas',
            data: monthlyComparison.map((data) => data.income),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.35,
            fill: true,
          },
          {
            label: 'Despesas',
            data: monthlyComparison.map((data) => data.expense),
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79, 70, 229, 0.08)',
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    }
  );

  if (applicationState.categoryPieChart) applicationState.categoryPieChart.destroy();
  const hasExpenses = expensesByCategory.length > 0;
  applicationState.categoryPieChart = new Chart(document.getElementById('category-pie-chart'), {
    type: 'pie',
    data: {
      labels: hasExpenses ? expensesByCategory.map((data) => data.category) : ['Sem despesas'],
      datasets: [
        {
          data: hasExpenses ? expensesByCategory.map((data) => data.total) : [1],
          backgroundColor: hasExpenses ? CHART_COLORS : ['#e2e8f0'],
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// ============================================================================
// 6. RENDERIZAÇÃO DE TABELAS (Transações)
// ============================================================================
function renderRecentTransactions(transactions) {
  const tbody = document.getElementById('recent-transactions-tbody');
  tbody.innerHTML = transactions
    .map(
      (transaction) => `
    <tr>
      <td><strong>${transaction.description}</strong></td>
      <td><span class="badge-category">${transaction.category}</span></td>
      <td>${formatDateToBrazilian(transaction.date)}</td>
      <td class="text-right ${transaction.type === 'income' ? 'amount-income' : 'amount-expense'}">
        ${transaction.type === 'income' ? '+' : '-'} ${formatCurrencyBRL(transaction.amount)}
      </td>
    </tr>
  `
    )
    .join('');
}

function renderFullTransactionsTable() {
  const tbody = document.getElementById('full-transactions-tbody');

  const filteredTransactions = applicationState.transactions.filter((transaction) => {
    if (!applicationState.searchQuery) return true;
    const query = applicationState.searchQuery.toLowerCase();
    return (
      transaction.description.toLowerCase().includes(query) ||
      transaction.category.toLowerCase().includes(query)
    );
  });

  tbody.innerHTML = filteredTransactions
    .map(
      (transaction) => `
    <tr>
      <td><span class="badge-type ${transaction.type}">${transaction.type === 'income' ? 'Receita' : 'Despesa'}</span></td>
      <td><strong>${transaction.description}</strong></td>
      <td><span class="badge-category">${transaction.category}</span></td>
      <td>${formatDateToBrazilian(transaction.date)}</td>
      <td class="text-right ${transaction.type === 'income' ? 'amount-income' : 'amount-expense'}">
        ${transaction.type === 'income' ? '+' : '-'} ${formatCurrencyBRL(transaction.amount)}
      </td>
      <td class="text-center">
        <button class="btn-icon-action" onclick="openEditTransactionModal(${transaction.id})">Editar</button>
        <button class="btn-icon-action delete" onclick="deleteTransaction(${transaction.id})">Excluir</button>
      </td>
    </tr>
  `
    )
    .join('');
}

// ============================================================================
// 7. RENDERIZAÇÃO DE METAS
// ============================================================================
function buildGoalCardHtml(goal, includeActions) {
  const isCompleted = goal.progressPercentage >= CONSTANTS.GOAL_COMPLETION_PERCENTAGE;
  const progressClass = isCompleted ? 'progress-fill completed' : 'progress-fill';

  const actionsHtml = includeActions
    ? `
    <div class="goal-actions-row">
      <button class="btn-icon-action delete" onclick="deleteGoal(${goal.id})">Excluir</button>
    </div>`
    : '';

  return `
    <div class="goal-item-card">
      <div class="goal-top-row">
        <span class="goal-name">${goal.name}</span>
        <span class="goal-percentage">${goal.progressPercentage}%</span>
      </div>
      <div class="goal-amounts">
        <span>Guardado: <strong>${formatCurrencyBRL(goal.current_amount)}</strong></span>
        <span>Alvo: <strong>${formatCurrencyBRL(goal.target_amount)}</strong></span>
      </div>
      <div class="progress-track">
        <div class="${progressClass}" style="width: ${goal.progressPercentage}%"></div>
      </div>
      ${actionsHtml}
    </div>
  `;
}

function renderGoalsList(goals, containerId, includeActions) {
  const container = document.getElementById(containerId);
  container.innerHTML = goals.map((goal) => buildGoalCardHtml(goal, includeActions)).join('');
}

// ============================================================================
// 8. CRUD E EVENTOS (Ações modais, POSTs, DELETEs)
// ============================================================================
async function handleTransactionFormSubmit(event) {
  event.preventDefault();
  const transactionId = document.getElementById('transaction-id').value;
  const payload = {
    type: document.getElementById('transaction-type').value,
    category: document.getElementById('transaction-category').value,
    description: document.getElementById('transaction-description').value,
    amount: Number(document.getElementById('transaction-amount').value),
    date: document.getElementById('transaction-date').value,
  };

  try {
    if (transactionId)
      await fetchApi(`/api/transactions/${transactionId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    else await fetchApi('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });

    document.getElementById('transaction-modal').classList.add('hidden');
    await fetchAndRenderDashboardData();
  } catch (error) {
    alert(error.message);
  }
}

window.deleteTransaction = async function (transactionId) {
  if (!confirm('Deseja realmente excluir esta transação?')) return;
  try {
    await fetchApi(`/api/transactions/${transactionId}`, { method: 'DELETE' });
    await fetchAndRenderDashboardData();
  } catch (error) {
    alert(error.message);
  }
};

window.openEditTransactionModal = function (transactionId) {
  const transaction = applicationState.transactions.find((t) => t.id === transactionId);
  if (!transaction) return;

  document.getElementById('transaction-modal-title').textContent = 'Editar Transação';
  document.getElementById('transaction-id').value = transaction.id;
  document.getElementById('transaction-type').value = transaction.type;
  document.getElementById('transaction-category').value = transaction.category;
  document.getElementById('transaction-description').value = transaction.description;
  document.getElementById('transaction-amount').value = transaction.amount;
  document.getElementById('transaction-date').value = transaction.date;
  document.getElementById('transaction-modal').classList.remove('hidden');
};

async function handleGoalFormSubmit(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById('goal-name').value,
    target_amount: Number(document.getElementById('goal-target-amount').value),
    current_amount: Number(document.getElementById('goal-current-amount').value),
  };

  try {
    await fetchApi('/api/goals', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('goal-modal').classList.add('hidden');
    await fetchAndRenderDashboardData();
  } catch (error) {
    alert(error.message);
  }
}

window.deleteGoal = async function (goalId) {
  if (!confirm('Deseja realmente excluir esta meta?')) return;
  try {
    await fetchApi(`/api/goals/${goalId}`, { method: 'DELETE' });
    await fetchAndRenderDashboardData();
  } catch (error) {
    alert(error.message);
  }
};

// ============================================================================
// 9. INICIALIZAÇÃO DA INTERFACE E EVENT LISTENERS
// ============================================================================
function navigateToView(viewName) {
  document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.remove('active'));
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

  document.getElementById('view-dashboard').classList.add('hidden');
  document.getElementById('view-transactions').classList.add('hidden');
  document.getElementById('view-goals').classList.add('hidden');

  document.getElementById(`view-${viewName}`).classList.remove('hidden');
  document.getElementById('page-title').textContent =
    viewName === 'dashboard' ? 'Dashboard' : viewName === 'transactions' ? 'Transações' : 'Metas';
}

function registerEventListeners() {
  document.getElementById('tab-login-btn').addEventListener('click', () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('tab-login-btn').classList.add('active');
    document.getElementById('tab-register-btn').classList.remove('active');
  });

  document.getElementById('tab-register-btn').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('tab-login-btn').classList.remove('active');
    document.getElementById('tab-register-btn').classList.add('active');
  });

  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('register-form').addEventListener('submit', handleRegisterSubmit);
  document.getElementById('logout-btn').addEventListener('click', handleUserLogout);

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigateToView(btn.dataset.view));
  });

  document.getElementById('month-filter-select').addEventListener('change', (e) => {
    applicationState.selectedMonth = e.target.value;
    fetchAndRenderDashboardData();
  });

  document.getElementById('global-search-input').addEventListener('input', (e) => {
    applicationState.searchQuery = e.target.value.trim();
    navigateToView('transactions');
    renderFullTransactionsTable();
  });

  document.getElementById('open-transaction-modal-btn').addEventListener('click', () => {
    document.getElementById('transaction-form').reset();
    document.getElementById('transaction-id').value = '';
    document.getElementById('transaction-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-modal').classList.remove('hidden');
  });
  document
    .getElementById('close-transaction-modal-btn')
    .addEventListener('click', () =>
      document.getElementById('transaction-modal').classList.add('hidden')
    );
  document
    .getElementById('transaction-form')
    .addEventListener('submit', handleTransactionFormSubmit);

  document.getElementById('open-goal-modal-btn').addEventListener('click', () => {
    document.getElementById('goal-form').reset();
    document.getElementById('goal-modal').classList.remove('hidden');
  });
  document
    .getElementById('close-goal-modal-btn')
    .addEventListener('click', () => document.getElementById('goal-modal').classList.add('hidden'));
  document.getElementById('goal-form').addEventListener('submit', handleGoalFormSubmit);
}

async function startApplication() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');

  const userName = applicationState.user.name;
  document.getElementById('user-display-name').textContent = userName;
  document.getElementById('user-avatar-initials').textContent = userName.slice(0, 2).toUpperCase();

  await fetchAndRenderDashboardData();
}

document.addEventListener('DOMContentLoaded', () => {
  registerEventListeners();

  const token = localStorage.getItem(CONSTANTS.STORAGE_TOKEN);
  const userJson = localStorage.getItem(CONSTANTS.STORAGE_USER);

  if (token && userJson) {
    applicationState.token = token;
    applicationState.user = JSON.parse(userJson);
    startApplication();
  }
});

function isCommonJsModule(moduleReference) {
  return typeof moduleReference === 'object' && moduleReference !== null;
}

function installCommonJsExports(moduleReference) {
  if (!isCommonJsModule(moduleReference) || !moduleReference.exports) return;

  moduleReference.exports = {
    formatCurrencyBRL, formatDateToBrazilian, fetchApi,
    handleUserLogout, handleLoginSubmit, handleRegisterSubmit, saveUserSession, showAuthFeedback,
    fetchAndRenderDashboardData, populateMonthFilterSelect, updateSummaryCards, updateCharts,
    renderRecentTransactions, renderFullTransactionsTable, renderGoalsList,
    handleTransactionFormSubmit, handleGoalFormSubmit,
    navigateToView, registerEventListeners, startApplication,
    CONSTANTS, applicationState, installCommonJsExports, isCommonJsModule,
  };
}

installCommonJsExports(typeof module === 'undefined' ? undefined : module);
