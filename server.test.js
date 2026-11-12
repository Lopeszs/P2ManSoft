process.env.DATABASE_PATH = ':memory:';
process.env.PORT = '0';
const request = require('supertest');
const actualPath = jest.requireActual('path');

jest.doMock('path', () => ({
  ...actualPath,
  join: (...segments) =>
    segments[segments.length - 1] === 'finansee.sqlite'
      ? ':memory:'
      : actualPath.join(...segments),
}));

const { 
  app, 
  initializeDatabase,
  calculateFinancialSummary, 
  groupExpensesByCategory,
  groupMonthlyComparison,
  TRANSACTION_TYPES 
} = require('./server.js');

jest.setTimeout(3000);

function settleWithin(promise, milliseconds = 300) {
  return Promise.race([
    promise.then(
      (value) => ({ settled: true, value }),
      (error) => ({ settled: true, error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), milliseconds)),
  ]);
}

describe('server.js - Regras de Negócio e API', () => {
  let authToken = '';
  let demoToken = '';
  let transactionId = '';
  let goalId = '';

  beforeAll(async () => {
    const initialization = await settleWithin(initializeDatabase(), 2000);
    expect(initialization.settled).toBe(true);
    
    const uniqueEmail = `testuser_${Date.now()}@finansee.com`;
    // Cadastra usuário válido com senha no limite exato (6 caracteres)
    const response = await request(app)
      .post('/api/register')
      .send({ name: 'Usuário Teste', email: uniqueEmail, password: '123456' });
    
    authToken = response.body.token;
    const demoLogin = await request(app).post('/api/login').send({ email: 'demo@finansee.com', password: '123456' });
    demoToken = demoLogin.body.token;

  });

  describe('1. Regras de Negócio (Funções Puras)', () => {
    it('calculateFinancialSummary() - deve calcular limites e exatidão matemática', () => {
      const summary = calculateFinancialSummary([
        { type: TRANSACTION_TYPES.INCOME, amount: 5000 },
        { type: TRANSACTION_TYPES.EXPENSE, amount: 5000 }
      ]);
      expect(summary.currentBalance).toBe(0);
      expect(summary.savedAmount).toBe(0);
      expect(summary.savingsRatePercentage).toBe(0);
    });

    it('calculateFinancialSummary() - com receitas vazias (totalIncome = 0)', () => {
      const summary = calculateFinancialSummary([{ type: TRANSACTION_TYPES.EXPENSE, amount: 1500 }]);
      expect(summary.savingsRatePercentage).toBe(0);
      expect(summary.totalIncome).toBe(0);
      expect(summary.savedAmount).toBe(0);
    });

    it('groupExpensesByCategory() - com array vazio e transações de receita apenas', () => {
      expect(groupExpensesByCategory([])).toHaveLength(0);
      expect(groupExpensesByCategory([{ type: TRANSACTION_TYPES.INCOME, category: 'Salário', amount: 3000 }])).toHaveLength(0);
    });

    it('groupMonthlyComparison() - agrupamento com somatórios corretos', () => {
      const result = groupMonthlyComparison([
        { type: TRANSACTION_TYPES.INCOME, amount: 1000, date: '2026-10-15' },
        { type: TRANSACTION_TYPES.INCOME, amount: 1000, date: '2026-10-20' },
        { type: TRANSACTION_TYPES.EXPENSE, amount: 500, date: '2026-10-20' }
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ month: '2026-10', income: 2000, expense: 500 });
    });
  });

  describe('2. Autenticação e Seed do Banco', () => {
    it('cobre registro duplicado e normalização de nome/e-mail', async () => {
      const email = `duplicate_${Date.now()}@finansee.com`;
      const first = await request(app).post('/api/register').send({ name: '  Teste  ', email: ` ${email.toUpperCase()} `, password: '123456' });
      expect(first.status).toBe(201);
      expect(first.body.user).toMatchObject({ name: 'Teste', email });
      const duplicate = await request(app).post('/api/register').send({ name: 'Outro', email, password: '123456' });
      expect(duplicate.status).toBe(409);
    });

    it('login rejeita campos ausentes, usuário desconhecido e senha incorreta', async () => {
      expect((await request(app).post('/api/login').send({ email: 'demo@finansee.com' })).status).toBe(400);
      expect((await request(app).post('/api/login').send({ email: 'nao-existe@finansee.com', password: '123456' })).status).toBe(401);
      expect((await request(app).post('/api/login').send({ email: 'demo@finansee.com', password: 'errada' })).status).toBe(401);
    });

    it('Deve rejeitar registro de senha com exatamente 5 caracteres (limite inferior)', async () => {
      const res = await request(app).post('/api/register').send({ name: 'Teste', email: 'limite@t.com', password: '12345' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Senha muito curta.');
    });

    it('Deve rejeitar registro com campos falsy (strings vazias)', async () => {
      const res = await request(app).post('/api/register').send({ name: '', email: '', password: '' });
      expect(res.status).toBe(400);
    });

    it('Deve logar na conta DEMO e verificar o Seed', async () => {
      const loginRes = await request(app).post('/api/login').send({ email: 'demo@finansee.com', password: '123456' });
      expect(loginRes.status).toBe(200);
      demoToken = loginRes.body.token;
    });
  });

  describe('3. Rotas de Transações (Limites CRUD)', () => {
    it('middleware rejeita autorização ausente, sem token e token inválido', async () => {
      expect((await request(app).get('/api/transactions')).status).toBe(401);
      expect((await request(app).get('/api/transactions').set('Authorization', 'Bearer')).status).toBe(401);
      expect((await request(app).get('/api/transactions').set('Authorization', 'Bearer invalido')).status).toBe(401);
    });

    it('GET /api/transactions filtra pelo mês e retorna lista ordenada em month=all', async () => {
      const october = await request(app).get('/api/transactions?month=2026-10').set('Authorization', `Bearer ${demoToken}`);
      expect(october.status).toBe(200);
      expect(october.body.length).toBeGreaterThan(0);
      expect(october.body.every((tx) => tx.date.startsWith('2026-10'))).toBe(true);
      const all = await request(app).get('/api/transactions?month=all').set('Authorization', `Bearer ${demoToken}`);
      expect(all.body.length).toBeGreaterThan(october.body.length);
      expect(all.body[0].date >= all.body[all.body.length - 1].date).toBe(true);
    });

    it('POST /api/transactions - bloqueia valor exatamente igual a 0', async () => {
      const res = await request(app).post('/api/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'expense', description: 'Zero', amount: 0, category: 'Outros', date: '2026-11-10' });
      expect(res.status).toBe(400);
    });

    it('POST /api/transactions - cria transação valor > 0', async () => {
      const res = await request(app).post('/api/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'income', description: 'Venda', amount: 1, category: 'Outros', date: '2026-11-11' });
      expect(res.status).toBe(201);
      transactionId = res.body.id;
    });

    it('PUT atualiza transação própria e não altera transação de outro usuário', async () => {
      const created = await request(app).post('/api/transactions').set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'expense', description: 'Antes', amount: 10, category: 'Outros', date: '2026-11-10' });
      const update = { type: 'income', description: 'Depois', amount: 15, category: 'Venda', date: '2026-11-11' };
      const updated = await request(app).put(`/api/transactions/${created.body.id}`).set('Authorization', `Bearer ${authToken}`).send(update);
      expect(updated.body).toMatchObject(update);
      const forbiddenUpdate = await request(app).put(`/api/transactions/${created.body.id}`).set('Authorization', `Bearer ${demoToken}`)
        .send({ ...update, description: 'Não permitido' });
      expect(forbiddenUpdate.body.description).toBe('Depois');
    });

    it('PUT /api/transactions/:id - bloqueia campos vazios estritos', async () => {
      const res = await request(app).put(`/api/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'income', description: '', amount: 2000, category: '', date: '' });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/transactions/:id', async () => {
      const res = await request(app).delete(`/api/transactions/${transactionId}`).set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('4. Rotas de Metas Financeiras (Limites Matemáticos)', () => {
    it('GET /api/goals inclui progresso e estado de conclusão das metas seed', async () => {
      const res = await request(app).get('/api/goals').set('Authorization', `Bearer ${demoToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toContainEqual(expect.objectContaining({ progressPercentage: 68, isCompleted: false }));
    });

    it('DELETE /api/goals remove a meta do usuário autenticado', async () => {
      const created = await request(app).post('/api/goals').set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Excluir', target_amount: 100, current_amount: 20 });
      const deleted = await request(app).delete(`/api/goals/${created.body.id}`).set('Authorization', `Bearer ${authToken}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ success: true });
      const goals = await request(app).get('/api/goals').set('Authorization', `Bearer ${authToken}`);
      expect(goals.body).not.toContainEqual(expect.objectContaining({ id: created.body.id }));
    });

    it('POST /api/goals - bloqueia target_amount exatamente 0', async () => {
      const res = await request(app).post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Carro', target_amount: 0, current_amount: 100 });
      expect(res.status).toBe(400);
    });

    it('POST /api/goals - bloqueia current_amount negativo', async () => {
      const res = await request(app).post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Carro', target_amount: 1000, current_amount: -1 });
      expect(res.status).toBe(400);
    });

    it('POST /api/goals - cria meta com 100% cravado (limite superior progresso)', async () => {
      const res = await request(app).post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Meta Completa', target_amount: 5000, current_amount: 5000 });
      expect(res.status).toBe(201);
      expect(res.body.progressPercentage).toBe(100);
      expect(res.body.isCompleted).toBe(true);
      goalId = res.body.id;
    });

    it('POST /api/goals - cria meta com mais de 100% (valida Math.min)', async () => {
      const res = await request(app).post('/api/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Meta Ultrapassada', target_amount: 1000, current_amount: 5000 });
      expect(res.status).toBe(201);
      expect(res.body.progressPercentage).toBe(100); 
    });
  });

  describe('5. Rota Dashboard (Filtros Estritos)', () => {
    it('GET /api/dashboard - filtro específico', async () => {
      const res = await request(app).get('/api/dashboard?month=2026-10').set('Authorization', `Bearer ${demoToken}`);
      expect(res.status).toBe(200);
      expect(res.body.summary).toMatchObject({ totalIncome: 4200, totalExpense: 3080 });
      expect(res.body.expensesByCategory).toContainEqual({ category: 'Moradia', total: 1200 });
      expect(res.body.recentTransactions.every((tx) => tx.date.startsWith('2026-10'))).toBe(true);
    });
    
    it('GET /api/dashboard - filtro explícito all', async () => {
      const res = await request(app).get('/api/dashboard?month=all').set('Authorization', `Bearer ${demoToken}`);
      expect(res.status).toBe(200);
      expect(res.body.monthlyComparison).toEqual(expect.arrayContaining([
        expect.objectContaining({ month: '2026-09' }), expect.objectContaining({ month: '2026-10' }),
      ]));
      expect(res.body.recentTransactions.length).toBeLessThanOrEqual(5);
    });
  });
});
