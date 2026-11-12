/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, './index.html'), 'utf8');

// ----------------------------------------------------------------- helpers
const byId = (id) => document.getElementById(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

function ensureOption(id, value) {
  const el = byId(id);
  if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(value))) {
    el.appendChild(new Option(String(value), String(value)));
  }
}
function setField(id, value) {
  ensureOption(id, value);
  byId(id).value = value;
}
function mockFetch(handler) {
  global.fetch = jest.fn((url, options = {}) => {
    const { status = 200, body = {} } = handler(url.split('?')[0], options) || {};
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    });
  });
}
const hasFetchTo = (prefix) => global.fetch.mock.calls.some(([url]) => url.startsWith(prefix));

// ----------------------------------------------------------------- dados
const USER = { id: 1, name: 'Ana Maria', email: 'ana@teste.com' };
const TRANSACTIONS = [
  { id: 1, type: 'income', description: 'Salário', category: 'Outros', date: '2026-10-05', amount: 3500 },
  { id: 2, type: 'expense', description: 'Supermercado', category: 'Alimentação', date: '2026-10-08', amount: 850.5 },
  { id: 3, type: 'expense', description: 'Uber', category: 'Transporte', date: '2026-10-14', amount: 380 },
];
const GOALS = [
  { id: 7, name: 'Notebook', current_amount: 3850, target_amount: 5500, progressPercentage: 70 },
  { id: 8, name: 'Reserva', current_amount: 5000, target_amount: 5000, progressPercentage: 100 },
];
const DASHBOARD = {
  summary: { currentBalance: 2269.5, totalIncome: 3500, totalExpense: 1230.5, savedAmount: 2000, savingsRatePercentage: 65 },
  monthlyComparison: [
    { month: '2026-09', income: 100, expense: 50 },
    { month: '2026-10', income: 3500, expense: 1230.5 },
  ],
  expensesByCategory: [
    { category: 'Alimentação', total: 850.5 },
    { category: 'Transporte', total: 380 },
  ],
  recentTransactions: TRANSACTIONS,
  goals: GOALS,
};
const CHART_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

function defaultRoutes(route, options) {
  if (route === '/api/dashboard') return { body: DASHBOARD };
  if (route === '/api/transactions' && (!options.method || options.method === 'GET')) {
    return { body: TRANSACTIONS };
  }
  return { body: {} };
}

// ----------------------------------------------------------------- testes
describe('script.js - Utilitários e Manipulação de DOM', () => {
  let script;

  beforeEach(() => {
    document.documentElement.innerHTML = html.toString();
    localStorage.clear();
    jest.resetModules();
    global.Chart = jest.fn().mockImplementation(function (canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.destroy = jest.fn();
    });
    global.alert = jest.fn();
    global.confirm = jest.fn(() => true);
    mockFetch(defaultRoutes);
    script = require('./script.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ---------------------------------------------------------- constantes
  describe('Constantes e estado inicial', () => {
    it('CONSTANTS tem exatamente os valores esperados', () => {
      expect(script.CONSTANTS).toEqual({
        HTTP_UNAUTHORIZED: 401,
        GOAL_COMPLETION_PERCENTAGE: 100,
        LOCALE: 'pt-BR',
        CURRENCY: 'BRL',
        STORAGE_TOKEN: 'finansee_auth_token',
        STORAGE_USER: 'finansee_auth_user',
      });
    });

    it('applicationState começa vazio', () => {
      expect(script.applicationState).toEqual({
        user: null,
        token: null,
        selectedMonth: 'all',
        searchQuery: '',
        transactions: [],
        dashboardData: null,
        incomeVsExpenseChart: null,
        categoryPieChart: null,
      });
    });
  });

  // ---------------------------------------------------------- formatação
  describe('Funções de Formatação', () => {
    it('formatDateToBrazilian() - deve converter corretamente', () => {
      expect(script.formatDateToBrazilian('2026-10-21')).toBe('21/10/2026');
    });

    it('formatDateToBrazilian() - deve capturar todos os tipos falsy', () => {
      expect(script.formatDateToBrazilian(null)).toBe('-');
      expect(script.formatDateToBrazilian(undefined)).toBe('-');
      expect(script.formatDateToBrazilian('')).toBe('-');
    });

    it('formatCurrencyBRL() - deve formatar exatamente 0 (mata mutante || vs &&)', () => {
      expect(script.formatCurrencyBRL(0)).toMatch(/0,00/);
      expect(script.formatCurrencyBRL(null)).toMatch(/0,00/);
      expect(script.formatCurrencyBRL(undefined)).toMatch(/0,00/);
    });

    it('formatCurrencyBRL() - formata valores diferentes de zero', () => {
      expect(script.formatCurrencyBRL(1500.5)).toMatch(/^R\$\s1\.500,50$/);
      expect(script.formatCurrencyBRL('42')).toMatch(/^R\$\s42,00$/);
    });
  });

  // ---------------------------------------------------------- fetchApi
  describe('fetchApi()', () => {
    it('sem token: cache buster com "?", headers e opções exatos', async () => {
      mockFetch(() => ({ body: { ok: 1 } }));
      const result = await script.fetchApi('/api/x');

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/x\?t=\d+$/);
      expect(options).toEqual({
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      expect(result).toEqual({ ok: 1 });
    });

    it('com token e query string: usa "&", envia Authorization e repassa opções', async () => {
      script.applicationState.token = 'abc123';
      mockFetch(() => ({ body: {} }));

      await script.fetchApi('/api/x?month=all', { method: 'POST', body: '{"a":1}' });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/x\?month=all&t=\d+$/);
      expect(options).toEqual({
        method: 'POST',
        body: '{"a":1}',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc123' },
        cache: 'no-store',
      });
    });

    it('401 faz logout e lança erro de sessão expirada', async () => {
      script.applicationState.token = 'abc';
      script.applicationState.user = USER;
      localStorage.setItem('finansee_auth_token', 'abc');
      byId('auth-screen').classList.add('hidden');
      mockFetch(() => ({ status: 401, body: { error: 'qualquer' } }));

      await expect(script.fetchApi('/api/x')).rejects.toThrow('Sessão expirada. Faça login novamente.');

      expect(script.applicationState.token).toBeNull();
      expect(localStorage.getItem('finansee_auth_token')).toBeNull();
      expect(byId('app-layout').classList.contains('hidden')).toBe(true);
      expect(byId('auth-screen').classList.contains('hidden')).toBe(false);
    });

    it('resposta não-ok propaga a mensagem do servidor', async () => {
      mockFetch(() => ({ status: 400, body: { error: 'Dados inválidos.' } }));
      await expect(script.fetchApi('/api/x')).rejects.toThrow('Dados inválidos.');
    });

    it('resposta não-ok sem mensagem usa o texto padrão', async () => {
      mockFetch(() => ({ status: 500, body: {} }));
      await expect(script.fetchApi('/api/x')).rejects.toThrow('Erro na requisição.');
    });
  });

  // ---------------------------------------------------------- sessão / auth
  describe('Autenticação', () => {
    it('saveUserSession() salva no estado e no localStorage', () => {
      script.saveUserSession(USER, 'tok');
      expect(script.applicationState.user).toEqual(USER);
      expect(script.applicationState.token).toBe('tok');
      expect(localStorage.getItem('finansee_auth_user')).toBe(JSON.stringify(USER));
      expect(localStorage.getItem('finansee_auth_token')).toBe('tok');
    });

    it('showAuthFeedback() - visibilidade nítida', () => {
      byId('auth-feedback').classList.add('hidden');
      script.showAuthFeedback('Aviso');
      const feedbackEl = byId('auth-feedback');
      expect(feedbackEl.textContent).toBe('Aviso');
      expect(feedbackEl.classList.contains('hidden')).toBe(false);
    });

    it('handleUserLogout() - varre todo localStorage e states', () => {
      script.applicationState.user = { name: 'Admin' };
      script.applicationState.token = 'xyz';
      localStorage.setItem(script.CONSTANTS.STORAGE_USER, '{"name":"Admin"}');
      localStorage.setItem(script.CONSTANTS.STORAGE_TOKEN, 'xyz');

      byId('app-layout').classList.remove('hidden');
      byId('auth-screen').classList.add('hidden');

      script.handleUserLogout();

      expect(script.applicationState.user).toBeNull();
      expect(script.applicationState.token).toBeNull();
      expect(localStorage.getItem('finansee_auth_user')).toBeNull();
      expect(localStorage.getItem('finansee_auth_token')).toBeNull();
      expect(byId('app-layout').classList.contains('hidden')).toBe(true);
      expect(byId('auth-screen').classList.contains('hidden')).toBe(false);
    });

    describe.each([
      ['handleLoginSubmit', '/api/login', ['login-email', 'login-password']],
      ['handleRegisterSubmit', '/api/register', ['register-email', 'register-password']],
    ])('%s()', (handlerName, endpoint, [emailId, passwordId]) => {
      beforeEach(() => {
        byId('app-layout').classList.add('hidden');
        byId('auth-screen').classList.remove('hidden');
        setField(emailId, 'ana@teste.com');
        setField(passwordId, 'segredo1');
        if (handlerName === 'handleRegisterSubmit') setField('register-name', 'Ana Maria');
      });

      it('envia POST, salva a sessão e inicia a aplicação', async () => {
        mockFetch((route, options) =>
          route === endpoint ? { body: { user: USER, token: 'tok-ok' } } : defaultRoutes(route, options)
        );
        const event = { preventDefault: jest.fn() };

        await script[handlerName](event);

        expect(event.preventDefault).toHaveBeenCalled();
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toMatch(new RegExp(`^${endpoint}\\?t=\\d+$`));
        expect(options.method).toBe('POST');
        const expectedBody = { email: 'ana@teste.com', password: 'segredo1' };
        if (handlerName === 'handleRegisterSubmit') expectedBody.name = 'Ana Maria';
        expect(JSON.parse(options.body)).toEqual(expectedBody);

        expect(script.applicationState.token).toBe('tok-ok');
        expect(localStorage.getItem('finansee_auth_token')).toBe('tok-ok');
        expect(byId('app-layout').classList.contains('hidden')).toBe(false);
        expect(byId('auth-screen').classList.contains('hidden')).toBe(true);
        expect(byId('user-display-name').textContent).toBe('Ana Maria');
        expect(byId('user-avatar-initials').textContent).toBe('AN');
      });

      it('mostra o erro retornado pela API', async () => {
        mockFetch(() => ({ status: 400, body: { error: 'Dados incompletos.' } }));
        byId('auth-feedback').classList.add('hidden');

        await script[handlerName]({ preventDefault: jest.fn() });

        expect(byId('auth-feedback').textContent).toBe('Dados incompletos.');
        expect(byId('auth-feedback').classList.contains('hidden')).toBe(false);
        expect(script.applicationState.token).toBeNull();
      });
    });

    it('startApplication() mostra o layout, iniciais em maiúsculas e carrega dados', async () => {
      script.applicationState.user = { name: 'maria' };
      byId('app-layout').classList.add('hidden');
      byId('auth-screen').classList.remove('hidden');

      await script.startApplication();

      expect(byId('auth-screen').classList.contains('hidden')).toBe(true);
      expect(byId('app-layout').classList.contains('hidden')).toBe(false);
      expect(byId('user-display-name').textContent).toBe('maria');
      expect(byId('user-avatar-initials').textContent).toBe('MA');
      expect(hasFetchTo('/api/dashboard')).toBe(true);
    });
  });

  // ---------------------------------------------------------- dashboard
  describe('Dashboard', () => {
    it('updateSummaryCards() - deve lidar com valores exatos zero', () => {
      script.updateSummaryCards({
        currentBalance: 0, totalIncome: 0, totalExpense: 0, savedAmount: 0, savingsRatePercentage: 0,
      });
      expect(byId('card-balance').textContent).toMatch(/0,00/);
      expect(byId('card-savings-rate').textContent).toBe('0% poupado');
    });

    it('updateSummaryCards() - escreve cada valor no card correto', () => {
      script.updateSummaryCards({
        currentBalance: 1500, totalIncome: 4000, totalExpense: 2500, savedAmount: 1000, savingsRatePercentage: 25,
      });
      expect(byId('card-balance').textContent).toMatch(/1\.500,00/);
      expect(byId('card-income').textContent).toMatch(/4\.000,00/);
      expect(byId('card-expense').textContent).toMatch(/2\.500,00/);
      expect(byId('card-saved').textContent).toMatch(/1\.000,00/);
      expect(byId('card-savings-rate').textContent).toBe('25% poupado');
    });

    it('populateMonthFilterSelect() - com array vazio', () => {
      script.populateMonthFilterSelect([]);
      const selectEl = byId('month-filter-select');
      expect(selectEl.options.length).toBe(1);
      expect(selectEl.options[0].value).toBe('all');
    });

    it('populateMonthFilterSelect() - com valores', () => {
      script.applicationState.selectedMonth = '2026-10';
      script.populateMonthFilterSelect([{ month: '2026-09' }, { month: '2026-10' }]);

      const selectEl = byId('month-filter-select');
      expect(selectEl.options.length).toBe(3);
      expect(selectEl.options[1].value).toBe('2026-10');
      expect(selectEl.options[1].selected).toBe(true);
    });

    it('populateMonthFilterSelect() - só o mês selecionado recebe o atributo selected', () => {
      script.applicationState.selectedMonth = '2026-10';
      script.populateMonthFilterSelect([{ month: '2026-09' }, { month: '2026-10' }]);

      const [all, oct, sep] = byId('month-filter-select').options;
      expect(all.textContent).toBe('Todos os meses');
      expect(oct.getAttributeNames()).toEqual(['value', 'selected']);
      expect(sep.getAttributeNames()).toEqual(['value']);
      expect(sep.textContent).toBe('2026-09');
    });

    it('fetchAndRenderDashboardData() busca o mês selecionado e renderiza tudo', async () => {
      script.applicationState.selectedMonth = '2026-10';

      await script.fetchAndRenderDashboardData();

      const urls = global.fetch.mock.calls.map(([url]) => url);
      expect(urls[0]).toMatch(/^\/api\/dashboard\?month=2026-10&t=\d+$/);
      expect(urls[1]).toMatch(/^\/api\/transactions\?month=2026-10&t=\d+$/);
      expect(script.applicationState.dashboardData).toEqual(DASHBOARD);
      expect(script.applicationState.transactions).toEqual(TRANSACTIONS);

      expect(byId('card-balance').textContent).toMatch(/2\.269,50/);
      expect(byId('month-filter-select').options.length).toBe(3);
      expect(byId('recent-transactions-tbody').rows.length).toBe(3);
      expect(byId('full-transactions-tbody').rows.length).toBe(3);
      expect(byId('dashboard-goals-list').querySelectorAll('.goal-item-card').length).toBe(2);
      expect(byId('dashboard-goals-list').querySelector('.goal-actions-row')).toBeNull();
      expect(byId('full-goals-grid').querySelectorAll('.goal-actions-row').length).toBe(2);
      expect(global.Chart).toHaveBeenCalledTimes(2);
      expect(script.applicationState.incomeVsExpenseChart).toBe(global.Chart.mock.instances[0]);
      expect(script.applicationState.categoryPieChart).toBe(global.Chart.mock.instances[1]);
    });

    it('fetchAndRenderDashboardData() destrói os gráficos antigos antes de recriar', async () => {
      await script.fetchAndRenderDashboardData();
      const [firstLine, firstPie] = global.Chart.mock.instances;
      expect(firstLine.destroy).not.toHaveBeenCalled();

      await script.fetchAndRenderDashboardData();

      expect(firstLine.destroy).toHaveBeenCalledTimes(1);
      expect(firstPie.destroy).toHaveBeenCalledTimes(1);
      expect(global.Chart).toHaveBeenCalledTimes(4);
    });

    it('fetchAndRenderDashboardData() registra erro no console quando a API falha', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch(() => ({ status: 500, body: { error: 'Falhou' } }));

      await script.fetchAndRenderDashboardData();

      expect(spy).toHaveBeenCalledWith('Erro ao buscar dados:', 'Falhou');
    });
  });

  // ---------------------------------------------------------- gráficos
  describe('updateCharts()', () => {
    it('configura o gráfico de linha (receitas x despesas)', () => {
      script.updateCharts(DASHBOARD);
      const [canvas, config] = global.Chart.mock.calls[0];
      expect(canvas).toBe(byId('income-vs-expense-chart'));
      expect(config).toEqual({
        type: 'line',
        data: {
          labels: ['2026-09', '2026-10'],
          datasets: [
            { label: 'Receitas', data: [100, 3500], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.35, fill: true },
            { label: 'Despesas', data: [50, 1230.5], borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.08)', tension: 0.35, fill: true },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    });

    it('configura a pizza com as despesas por categoria', () => {
      script.updateCharts(DASHBOARD);
      const [canvas, config] = global.Chart.mock.calls[1];
      expect(canvas).toBe(byId('category-pie-chart'));
      expect(config).toEqual({
        type: 'pie',
        data: {
          labels: ['Alimentação', 'Transporte'],
          datasets: [{ data: [850.5, 380], backgroundColor: CHART_COLORS }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    });

    it('pizza sem despesas usa o placeholder cinza', () => {
      script.updateCharts({ ...DASHBOARD, expensesByCategory: [] });
      const [, config] = global.Chart.mock.calls[1];
      expect(config.data).toEqual({
        labels: ['Sem despesas'],
        datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }],
      });
    });
  });

  // ---------------------------------------------------------- tabelas
  describe('renderRecentTransactions()', () => {
    it('renderiza descrição, categoria, data e valor com sinal', () => {
      script.renderRecentTransactions([TRANSACTIONS[0], TRANSACTIONS[1]]);

      const tbody = byId('recent-transactions-tbody');
      expect(tbody.rows.length).toBe(2);
      const [income, expense] = tbody.rows;

      expect(income.querySelector('strong').textContent).toBe('Salário');
      expect(income.querySelector('.badge-category').textContent).toBe('Outros');
      expect(income.cells[2].textContent).toBe('05/10/2026');
      expect(income.cells[3].classList.contains('text-right')).toBe(true);
      expect(income.cells[3].classList.contains('amount-income')).toBe(true);
      expect(income.cells[3].classList.contains('amount-expense')).toBe(false);
      expect(normalize(income.cells[3].textContent)).toBe('+ R$ 3.500,00');

      expect(expense.cells[3].classList.contains('amount-expense')).toBe(true);
      expect(expense.cells[3].classList.contains('amount-income')).toBe(false);
      expect(normalize(expense.cells[3].textContent)).toBe('- R$ 850,50');

      // texto solto dentro de <table> é movido para fora do tbody pelo parser (foster parenting)
      expect(tbody.closest('table').parentElement.textContent).not.toContain('Stryker was here!');
    });

    it('lista vazia limpa o tbody', () => {
      script.renderRecentTransactions(TRANSACTIONS);
      script.renderRecentTransactions([]);
      expect(byId('recent-transactions-tbody').rows.length).toBe(0);
    });
  });

  describe('renderFullTransactionsTable()', () => {
    beforeEach(() => {
      script.applicationState.transactions = TRANSACTIONS;
    });

    it('sem busca exibe todas as linhas com badges e botões de ação', () => {
      script.renderFullTransactionsTable();

      const tbody = byId('full-transactions-tbody');
      expect(tbody.rows.length).toBe(3);
      const [income, expense] = tbody.rows;

      expect(income.querySelector('.badge-type').className).toBe('badge-type income');
      expect(income.querySelector('.badge-type').textContent).toBe('Receita');
      expect(expense.querySelector('.badge-type').className).toBe('badge-type expense');
      expect(expense.querySelector('.badge-type').textContent).toBe('Despesa');

      expect(income.querySelector('strong').textContent).toBe('Salário');
      expect(income.cells[2].querySelector('.badge-category').textContent).toBe('Outros');
      expect(income.cells[3].textContent).toBe('05/10/2026');
      expect(income.cells[4].classList.contains('amount-income')).toBe(true);
      expect(normalize(income.cells[4].textContent)).toBe('+ R$ 3.500,00');
      expect(expense.cells[4].classList.contains('amount-expense')).toBe(true);
      expect(normalize(expense.cells[4].textContent)).toBe('- R$ 850,50');

      expect(expense.cells[5].className).toBe('text-center');
      const [edit, remove] = expense.querySelectorAll('button');
      expect(edit.textContent).toBe('Editar');
      expect(edit.className).toBe('btn-icon-action');
      expect(edit.getAttribute('onclick')).toBe('openEditTransactionModal(2)');
      expect(remove.textContent).toBe('Excluir');
      expect(remove.className).toBe('btn-icon-action delete');
      expect(remove.getAttribute('onclick')).toBe('deleteTransaction(2)');

      expect(tbody.closest('table').parentElement.textContent).not.toContain('Stryker was here!');
    });

    it.each([
      ['mercado', ['Supermercado']], // só na descrição
      ['MERCADO', ['Supermercado']], // case-insensitive
      ['transp', ['Uber']], // só na categoria
      ['inexistente', []],
    ])('filtra pela busca "%s"', (query, expected) => {
      script.applicationState.searchQuery = query;
      script.renderFullTransactionsTable();
      const names = [...byId('full-transactions-tbody').rows].map((r) => r.querySelector('strong').textContent);
      expect(names).toEqual(expected);
    });
  });

  // ---------------------------------------------------------- metas
  describe('renderGoalsList()', () => {
    const strayText = (container) =>
      [...container.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() !== '');

    it('card sem ações', () => {
      script.renderGoalsList([GOALS[0]], 'dashboard-goals-list', false);

      const container = byId('dashboard-goals-list');
      const card = container.querySelector('.goal-item-card');
      expect(normalize(card.textContent)).toBe('Notebook 70% Guardado: R$ 3.850,00 Alvo: R$ 5.500,00');
      expect(card.querySelector('.goal-name').textContent).toBe('Notebook');
      expect(card.querySelector('.goal-percentage').textContent).toBe('70%');
      expect(card.querySelector('.progress-track')).not.toBeNull();
      const fill = card.querySelector('.progress-fill');
      expect(fill.className).toBe('progress-fill');
      expect(fill.style.width).toBe('70%');
      expect(card.querySelector('.goal-actions-row')).toBeNull();
    });

    it('meta com exatamente 100% é concluída e tem botão de excluir', () => {
      script.renderGoalsList([GOALS[1]], 'full-goals-grid', true);

      const card = byId('full-goals-grid').querySelector('.goal-item-card');
      expect(card.querySelector('.progress-fill').className).toBe('progress-fill completed');
      const button = card.querySelector('.goal-actions-row button');
      expect(button.className).toBe('btn-icon-action delete');
      expect(button.textContent).toBe('Excluir');
      expect(button.getAttribute('onclick')).toBe('deleteGoal(8)');
    });

    it('99% ainda não está concluída', () => {
      script.renderGoalsList([{ ...GOALS[0], progressPercentage: 99 }], 'dashboard-goals-list', false);
      expect(byId('dashboard-goals-list').querySelector('.progress-fill').className).toBe('progress-fill');
    });

    it('renderiza vários cards sem texto solto e esvazia com lista vazia', () => {
      const container = byId('full-goals-grid');
      script.renderGoalsList(GOALS, 'full-goals-grid', true);
      expect(container.querySelectorAll('.goal-item-card').length).toBe(2);
      expect(strayText(container)).toHaveLength(0);

      script.renderGoalsList([], 'full-goals-grid', true);
      expect(container.innerHTML).toBe('');
    });
  });

  // ---------------------------------------------------------- CRUD
  describe('handleTransactionFormSubmit()', () => {
    function fillForm(id) {
      setField('transaction-id', id);
      setField('transaction-type', 'expense');
      setField('transaction-category', 'Moradia');
      setField('transaction-description', 'Aluguel');
      setField('transaction-amount', '1200.5');
      setField('transaction-date', '2026-10-06');
      byId('transaction-modal').classList.remove('hidden');
    }
    const okRoutes = (route, options) =>
      ['POST', 'PUT'].includes(options.method) ? { status: 200, body: { id: 9 } } : defaultRoutes(route, options);

    it('sem id: POST /api/transactions, fecha o modal e recarrega', async () => {
      fillForm('');
      mockFetch(okRoutes);
      const event = { preventDefault: jest.fn() };

      await script.handleTransactionFormSubmit(event);

      expect(event.preventDefault).toHaveBeenCalled();
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/transactions\?t=\d+$/);
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        type: 'expense', category: 'Moradia', description: 'Aluguel', amount: 1200.5, date: '2026-10-06',
      });
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(true);
      expect(hasFetchTo('/api/dashboard')).toBe(true);
    });

    it('com id: PUT /api/transactions/:id', async () => {
      fillForm('5');
      mockFetch(okRoutes);

      await script.handleTransactionFormSubmit({ preventDefault: jest.fn() });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/transactions\/5\?t=\d+$/);
      expect(options.method).toBe('PUT');
    });

    it('mostra alerta e mantém o modal aberto quando a API falha', async () => {
      fillForm('');
      mockFetch(() => ({ status: 400, body: { error: 'Dados de transação inválidos.' } }));

      await script.handleTransactionFormSubmit({ preventDefault: jest.fn() });

      expect(global.alert).toHaveBeenCalledWith('Dados de transação inválidos.');
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(false);
    });
  });

  describe('window.deleteTransaction()', () => {
    it('confirma, envia DELETE e recarrega o dashboard', async () => {
      mockFetch((route, options) =>
        options.method === 'DELETE' ? { body: { success: true } } : defaultRoutes(route, options)
      );

      await window.deleteTransaction(3);

      expect(global.confirm).toHaveBeenCalledWith('Deseja realmente excluir esta transação?');
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/transactions\/3\?t=\d+$/);
      expect(options.method).toBe('DELETE');
      expect(hasFetchTo('/api/dashboard')).toBe(true);
    });

    it('não faz nada se o usuário cancelar', async () => {
      global.confirm.mockReturnValue(false);
      await window.deleteTransaction(3);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('alerta quando a API falha', async () => {
      mockFetch(() => ({ status: 500, body: { error: 'Erro no servidor.' } }));
      await window.deleteTransaction(3);
      expect(global.alert).toHaveBeenCalledWith('Erro no servidor.');
    });
  });

  describe('window.openEditTransactionModal()', () => {
    beforeEach(() => {
      script.applicationState.transactions = TRANSACTIONS;
      ensureOption('transaction-type', 'expense');
      ensureOption('transaction-category', 'Alimentação');
      byId('transaction-modal').classList.add('hidden');
    });

    it('preenche o formulário com a transação certa e abre o modal', () => {
      window.openEditTransactionModal(2);

      expect(byId('transaction-modal-title').textContent).toBe('Editar Transação');
      expect(byId('transaction-id').value).toBe('2');
      expect(byId('transaction-type').value).toBe('expense');
      expect(byId('transaction-category').value).toBe('Alimentação');
      expect(byId('transaction-description').value).toBe('Supermercado');
      expect(byId('transaction-amount').value).toBe('850.5');
      expect(byId('transaction-date').value).toBe('2026-10-08');
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(false);
    });

    it('id inexistente não altera nada', () => {
      const titleBefore = byId('transaction-modal-title').textContent;
      window.openEditTransactionModal(999);
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(true);
      expect(byId('transaction-modal-title').textContent).toBe(titleBefore);
    });
  });

  describe('handleGoalFormSubmit() e window.deleteGoal()', () => {
    it('cria meta com POST /api/goals', async () => {
      setField('goal-name', 'Carro');
      setField('goal-target-amount', '20000');
      setField('goal-current-amount', '1500.75');
      byId('goal-modal').classList.remove('hidden');
      mockFetch((route, options) =>
        options.method === 'POST' ? { status: 201, body: { id: 1 } } : defaultRoutes(route, options)
      );
      const event = { preventDefault: jest.fn() };

      await script.handleGoalFormSubmit(event);

      expect(event.preventDefault).toHaveBeenCalled();
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/goals\?t=\d+$/);
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ name: 'Carro', target_amount: 20000, current_amount: 1500.75 });
      expect(byId('goal-modal').classList.contains('hidden')).toBe(true);
      expect(hasFetchTo('/api/dashboard')).toBe(true);
    });

    it('alerta quando a criação falha e mantém o modal', async () => {
      byId('goal-modal').classList.remove('hidden');
      mockFetch(() => ({ status: 400, body: { error: 'Dados da meta inválidos.' } }));
      await script.handleGoalFormSubmit({ preventDefault: jest.fn() });
      expect(global.alert).toHaveBeenCalledWith('Dados da meta inválidos.');
      expect(byId('goal-modal').classList.contains('hidden')).toBe(false);
    });

    it('deleteGoal() confirma, envia DELETE e recarrega', async () => {
      mockFetch((route, options) =>
        options.method === 'DELETE' ? { body: { success: true } } : defaultRoutes(route, options)
      );

      await window.deleteGoal(8);

      expect(global.confirm).toHaveBeenCalledWith('Deseja realmente excluir esta meta?');
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toMatch(/^\/api\/goals\/8\?t=\d+$/);
      expect(options.method).toBe('DELETE');
      expect(hasFetchTo('/api/dashboard')).toBe(true);
    });

    it('deleteGoal() não faz nada se cancelar', async () => {
      global.confirm.mockReturnValue(false);
      await window.deleteGoal(8);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('deleteGoal() alerta quando a API falha', async () => {
      mockFetch(() => ({ status: 500, body: { error: 'Falhou' } }));
      await window.deleteGoal(8);
      expect(global.alert).toHaveBeenCalledWith('Falhou');
    });
  });

  // ---------------------------------------------------------- navegação
  describe('navigateToView()', () => {
    it.each([
      ['dashboard', 'Dashboard'],
      ['transactions', 'Transações'],
      ['goals', 'Metas'],
    ])('navega para %s', (view, title) => {
      script.navigateToView(view);

      expect(document.querySelector(`[data-view="${view}"]`).classList.contains('active')).toBe(true);
      document.querySelectorAll('.nav-item').forEach((btn) => {
        expect(btn.classList.contains('active')).toBe(btn.dataset.view === view);
      });
      ['dashboard', 'transactions', 'goals'].forEach((v) => {
        expect(byId(`view-${v}`).classList.contains('hidden')).toBe(v !== view);
      });
      expect(byId('page-title').textContent).toBe(title);
    });
  });

  // ---------------------------------------------------------- listeners
  describe('registerEventListeners()', () => {
    beforeEach(() => {
      script.registerEventListeners();
    });

    it('alterna entre as abas de login e cadastro', () => {
      byId('tab-register-btn').click();
      expect(byId('login-form').classList.contains('hidden')).toBe(true);
      expect(byId('register-form').classList.contains('hidden')).toBe(false);
      expect(byId('tab-login-btn').classList.contains('active')).toBe(false);
      expect(byId('tab-register-btn').classList.contains('active')).toBe(true);

      byId('tab-login-btn').click();
      expect(byId('login-form').classList.contains('hidden')).toBe(false);
      expect(byId('register-form').classList.contains('hidden')).toBe(true);
      expect(byId('tab-login-btn').classList.contains('active')).toBe(true);
      expect(byId('tab-register-btn').classList.contains('active')).toBe(false);
    });

    it('submit do login chama a API de login', async () => {
      setField('login-email', 'a@b.com');
      setField('login-password', '123456');
      mockFetch((route, options) =>
        route === '/api/login' ? { body: { user: USER, token: 't-login' } } : defaultRoutes(route, options)
      );

      byId('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();

      expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/login\?/);
      expect(script.applicationState.token).toBe('t-login');
    });

    it('submit do cadastro chama a API de cadastro', async () => {
      setField('register-name', 'Ana');
      setField('register-email', 'a@b.com');
      setField('register-password', '123456');
      mockFetch((route, options) =>
        route === '/api/register' ? { body: { user: USER, token: 't-reg' } } : defaultRoutes(route, options)
      );

      byId('register-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();

      expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/register\?/);
      expect(script.applicationState.token).toBe('t-reg');
    });

    it('botão de sair faz logout', () => {
      script.applicationState.token = 'x';
      byId('app-layout').classList.remove('hidden');
      byId('logout-btn').click();
      expect(script.applicationState.token).toBeNull();
      expect(byId('app-layout').classList.contains('hidden')).toBe(true);
    });

    it('clique no menu troca a view', () => {
      document.querySelector('[data-view="goals"]').click();
      expect(byId('view-goals').classList.contains('hidden')).toBe(false);
      expect(byId('page-title').textContent).toBe('Metas');
    });

    it('trocar o mês atualiza o estado e recarrega o dashboard', async () => {
      ensureOption('month-filter-select', '2026-09');
      byId('month-filter-select').value = '2026-09';

      byId('month-filter-select').dispatchEvent(new Event('change'));
      await flush();

      expect(script.applicationState.selectedMonth).toBe('2026-09');
      expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/dashboard\?month=2026-09&t=\d+$/);
    });

    it('busca global aplica trim, vai para Transações e filtra a tabela', () => {
      script.applicationState.transactions = TRANSACTIONS;
      const input = byId('global-search-input');
      input.value = '  mercado ';

      input.dispatchEvent(new Event('input'));

      expect(script.applicationState.searchQuery).toBe('mercado');
      expect(byId('view-transactions').classList.contains('hidden')).toBe(false);
      expect(byId('full-transactions-tbody').rows.length).toBe(1);
    });

    it('novo lançamento limpa o formulário, define a data de hoje e abre o modal', () => {
      jest.useFakeTimers({ now: new Date('2026-11-11T12:00:00Z') });
      setField('transaction-id', '9');
      setField('transaction-description', 'sobra');
      byId('transaction-modal').classList.add('hidden');

      byId('open-transaction-modal-btn').click();

      expect(byId('transaction-id').value).toBe('');
      expect(byId('transaction-description').value).toBe('');
      expect(byId('transaction-date').value).toBe('2026-11-11');
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(false);
    });

    it('botão fechar esconde o modal de transação', () => {
      byId('transaction-modal').classList.remove('hidden');
      byId('close-transaction-modal-btn').click();
      expect(byId('transaction-modal').classList.contains('hidden')).toBe(true);
    });

    it('nova meta limpa o formulário e abre o modal; fechar esconde', () => {
      setField('goal-name', 'sobra');
      byId('goal-modal').classList.add('hidden');

      byId('open-goal-modal-btn').click();
      expect(byId('goal-name').value).toBe('');
      expect(byId('goal-modal').classList.contains('hidden')).toBe(false);

      byId('close-goal-modal-btn').click();
      expect(byId('goal-modal').classList.contains('hidden')).toBe(true);
    });

    it('submit dos formulários de transação e meta chama os handlers', async () => {
      setField('transaction-id', '');
      setField('transaction-type', 'income');
      setField('transaction-category', 'Outros');
      setField('transaction-description', 'Venda');
      setField('transaction-amount', '10');
      setField('transaction-date', '2026-10-10');
      mockFetch((route, options) => (options.method === 'POST' ? { status: 201, body: {} } : defaultRoutes(route, options)));

      byId('transaction-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();
      expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/transactions\?/);

      global.fetch.mockClear();
      setField('goal-name', 'Meta');
      setField('goal-target-amount', '100');
      setField('goal-current-amount', '10');
      byId('goal-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();
      expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/goals\?/);
    });
  });

  // ---------------------------------------------------------- DOMContentLoaded
  describe('inicialização (DOMContentLoaded)', () => {
    function carregar() {
      jest.resetModules();
      const spy = jest.spyOn(document, 'addEventListener');
      const mod = require('./script.js');
      const call = spy.mock.calls.find(([evento]) => evento === 'DOMContentLoaded');
      spy.mockRestore();
      return { mod, onReady: call[1] };
    }

    it('restaura a sessão salva e inicia a aplicação', async () => {
      localStorage.setItem('finansee_auth_token', 'tok-salvo');
      localStorage.setItem('finansee_auth_user', JSON.stringify({ id: 1, name: 'Carlos' }));
      const { mod, onReady } = carregar();

      onReady();
      await flush();

      expect(mod.applicationState.token).toBe('tok-salvo');
      expect(mod.applicationState.user).toEqual({ id: 1, name: 'Carlos' });
      expect(byId('user-avatar-initials').textContent).toBe('CA');
      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-salvo');
    });

    it('sem sessão salva não chama a API', async () => {
      const { mod, onReady } = carregar();
      onReady();
      await flush();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mod.applicationState.token).toBeNull();
    });

    it.each([['finansee_auth_token'], ['finansee_auth_user']])(
      'com apenas %s salvo não restaura a sessão',
      async (key) => {
        localStorage.setItem(key, key === 'finansee_auth_user' ? '{"name":"X"}' : 'tok');
        const { mod, onReady } = carregar();
        onReady();
        await flush();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mod.applicationState.token).toBeNull();
        expect(mod.applicationState.user).toBeNull();
      }
    );

    it('registra os listeners da interface', () => {
      const { onReady } = carregar();
      onReady();
      byId('tab-register-btn').click();
      expect(byId('register-form').classList.contains('hidden')).toBe(false);
    });

    it('executa no navegador sem depender de CommonJS', () => {
      const source = fs.readFileSync(path.resolve(__dirname, './script.js'), 'utf8');
      const browserWindow = {};
      const addEventListener = jest.fn();

      expect(() =>
        vm.runInNewContext(source, {
          window: browserWindow,
          document: { addEventListener },
          console,
        })
      ).not.toThrow();

      expect(addEventListener).toHaveBeenCalledTimes(1);
      expect(addEventListener.mock.calls[0][0]).toBe('DOMContentLoaded');
      expect(typeof addEventListener.mock.calls[0][1]).toBe('function');
      expect(typeof browserWindow.deleteTransaction).toBe('function');
    });

    it('só instala exports quando recebe um módulo CommonJS válido', () => {
      expect(script.isCommonJsModule(undefined)).toBe(false);
      expect(script.isCommonJsModule(null)).toBe(false);
      expect(script.isCommonJsModule({})).toBe(true);
      expect(() => script.installCommonJsExports(undefined)).not.toThrow();

      const moduleReference = { exports: {} };
      script.installCommonJsExports(moduleReference);

      expect(typeof moduleReference.exports.renderFullTransactionsTable).toBe('function');
    });
  });
});