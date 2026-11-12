process.env.DATABASE_PATH = ':memory:';
process.env.PORT = '0';

const request = require('supertest');
const express = require('express');
const { spawn } = require('child_process');
const path = jest.requireActual('path');

const databasePathJoin = jest.fn((...segments) => {
  if (segments[segments.length - 1] === 'finansee.sqlite') return ':memory:';
  return path.join(...segments);
});

jest.doMock('path', () => ({
  ...path,
  join: databasePathJoin,
}));

const openedServers = [];
const originalListen = express.application.listen;
express.application.listen = function (...args) {
  const server = originalListen.apply(this, args);
  openedServers.push(server);
  return server;
};

const {
  app,
  database,
  initializeDatabase,
  executeCommand,
  querySingle,
  queryMultiple,
  startServerIfMain,
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

describe('server.js - Cobertura de mutantes sem cobertura', () => {
  let authToken;
  let demoToken;

  beforeAll(async () => {
    const initialization = await settleWithin(initializeDatabase(), 2000);
    expect(initialization.settled).toBe(true);
    const registration = await request(app)
      .post('/api/register')
      .send({ name: 'Usuário de Mutação', email: 'mutacao@finansee.com', password: '123456' });
    authToken = registration.body.token;
    const login = await request(app)
      .post('/api/login')
      .send({ email: 'demo@finansee.com', password: '123456' });
    demoToken = login.body.token;
  });

  afterAll(async () => {
    const listeningServers = openedServers.filter((server) => server.listening);
    await Promise.all(
      listeningServers.map(
        (server) => new Promise((resolve) => server.close(resolve))
      )
    );
    express.application.listen = originalListen;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usa o caminho padrão do banco quando DATABASE_PATH está vazio', async () => {
    const originalDatabasePath = process.env.DATABASE_PATH;
    let isolatedServer;
    const closeDatabase = jest.fn((callback) => callback());

    jest.doMock('sqlite3', () => ({
      verbose: () => ({
        Database: jest.fn(function (filename) {
          this.filename = filename;
          this.close = closeDatabase;
        }),
      }),
    }));

    process.env.DATABASE_PATH = '';

    try {
      databasePathJoin.mockClear();
      jest.isolateModules(() => {
        isolatedServer = require('./server.js');
      });

      expect(databasePathJoin).toHaveBeenCalledWith(
        expect.any(String),
        'finansee.sqlite'
      );
      await new Promise((resolve, reject) => {
        isolatedServer.database.close((error) => (error ? reject(error) : resolve()));
      });
      expect(closeDatabase).toHaveBeenCalledTimes(1);
    } finally {
      process.env.DATABASE_PATH = originalDatabasePath;
      jest.dontMock('sqlite3');
    }
  });

  it('carrega as variáveis do arquivo .env ao iniciar o módulo', () => {
    const config = jest.fn();
    let isolatedServer;
    jest.doMock('dotenv', () => ({ config }));

    try {
      jest.isolateModules(() => {
        isolatedServer = require('./server.js');
      });

      expect(config).toHaveBeenCalledTimes(1);
    } finally {
      jest.dontMock('dotenv');
    }

    return new Promise((resolve, reject) => {
      isolatedServer.database.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('resolve os helpers de banco com parâmetros padrão e propaga callbacks', async () => {
    const commandResult = await settleWithin(
      executeCommand('CREATE TABLE helper_test (value INTEGER)')
    );
    expect(commandResult).toEqual({
      settled: true,
      value: { id: expect.any(Number), changes: expect.any(Number) },
    });
    await expect(settleWithin(querySingle('SELECT 1 AS value')))
      .resolves.toEqual({ settled: true, value: { value: 1 } });
    await expect(settleWithin(queryMultiple('SELECT 1 AS value')))
      .resolves.toEqual({ settled: true, value: [{ value: 1 }] });

    const databaseError = new Error('falha simulada');
    jest.spyOn(database, 'get').mockImplementation((sql, params, callback) => {
      callback(databaseError);
      return database;
    });

    await expect(settleWithin(querySingle('SELECT 1 AS value'))).resolves.toEqual({
      settled: true,
      error: databaseError,
    });

    jest.spyOn(database, 'run').mockImplementation((sql, params, callback) => {
      callback(databaseError);
      return database;
    });
    await expect(settleWithin(executeCommand('INSERT INTO helper_test VALUES (1)'))).resolves.toEqual({
      settled: true,
      error: databaseError,
    });

    jest.spyOn(database, 'all').mockImplementation((sql, params, callback) => {
      callback(databaseError);
      return database;
    });
    await expect(settleWithin(queryMultiple('SELECT 1 AS value'))).resolves.toEqual({
      settled: true,
      error: databaseError,
    });
  });

  it('retorna erro 500 quando a gravação do cadastro falha', async () => {
    jest.spyOn(database, 'run').mockImplementation((sql, params, callback) => {
      callback(new Error('falha simulada'));
      return database;
    });

    const response = await request(app)
      .post('/api/register')
      .send({ name: 'Cadastro', email: 'falha@finansee.com', password: '123456' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Erro no servidor.' });
  });

  it('retorna erro 500 quando a consulta do login falha', async () => {
    jest.spyOn(database, 'get').mockImplementation((sql, params, callback) => {
      callback(new Error('falha simulada'));
      return database;
    });

    const response = await request(app)
      .post('/api/login')
      .send({ email: 'demo@finansee.com', password: '123456' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Erro no login.' });
  });

  it('retorna erro 500 quando a consulta do dashboard falha', async () => {
    jest.spyOn(database, 'all').mockImplementation((sql, params, callback) => {
      callback(new Error('falha simulada'));
      return database;
    });

    const response = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Erro ao carregar dashboard.' });
  });

  it('inicia o servidor somente quando chamado como módulo principal', async () => {
    const server = { listening: false };
    const listen = jest.spyOn(app, 'listen').mockImplementation((port, callback) => {
      callback();
      return server;
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(startServerIfMain({}, {})).toBeUndefined();
    expect(listen).not.toHaveBeenCalled();

    const currentModule = {};
    await expect(startServerIfMain(currentModule, currentModule)).resolves.toBe(server);
    expect(listen).toHaveBeenCalledWith('0', expect.any(Function));
    expect(log).toHaveBeenCalledWith('Servidor rodando em http://localhost:0');
  });

  it('inicia o processo do servidor quando server.js é o ponto de entrada', async () => {
    const serverPath = path.join(__dirname, 'server.js');
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        DATABASE_PATH: ':memory:',
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('O processo não iniciou o servidor no prazo esperado.')),
          2000
        );
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('Servidor rodando em http://localhost:0')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`O processo encerrou antes de iniciar (${code}).`));
        });
      });

      expect(output).toContain('Servidor rodando em http://localhost:0');
    } finally {
      child.kill();
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => child.once('exit', resolve));
      }
    }
  });

  it('habilita CORS e serve os arquivos estáticos da aplicação', async () => {
    const preflight = await request(app)
      .options('/api/login')
      .set('Origin', 'https://cliente.teste')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');

    const page = await request(app).get('/index.html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('FinanSee');
  });

  it('usa a porta padrão quando PORT está vazio', async () => {
    const originalPort = process.env.PORT;
    let isolatedServer;

    process.env.PORT = '';
    try {
      jest.isolateModules(() => {
        isolatedServer = require('./server.js');
      });
      expect(isolatedServer.CONSTANTS.PORT).toBe(3000);
    } finally {
      process.env.PORT = originalPort;
      if (isolatedServer) {
        await new Promise((resolve, reject) => {
          isolatedServer.database.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  });

  it('mantém a duração de 24 horas nos tokens emitidos', async () => {
    const response = await request(app)
      .post('/api/register')
      .send({ name: 'Token Teste', email: 'token@finansee.com', password: '123456' });
    const login = await request(app)
      .post('/api/login')
      .send({ email: 'token@finansee.com', password: '123456' });
    const jwt = require('jsonwebtoken');
    const registrationDecoded = jwt.decode(response.body.token);
    const loginDecoded = jwt.decode(login.body.token);

    expect(response.status).toBe(201);
    expect(login.status).toBe(200);
    expect(registrationDecoded.exp - registrationDecoded.iat).toBe(24 * 60 * 60);
    expect(loginDecoded.exp - loginDecoded.iat).toBe(24 * 60 * 60);
  });

  it('retorna exatamente as transações e metas inseridas pelo seed', async () => {
    const demoUser = await querySingle('SELECT id FROM users WHERE email = ?', [
      'demo@finansee.com',
    ]);
    expect(await querySingle('SELECT name FROM users WHERE id = ?', [demoUser.id])).toEqual({
      name: 'Estudante Demo',
    });
    const transactions = await queryMultiple(
      'SELECT type, description, amount, category, date FROM transactions WHERE user_id = ? ORDER BY date, id',
      [demoUser.id]
    );
    const goals = await queryMultiple(
      'SELECT name, target_amount, current_amount FROM goals WHERE user_id = ? ORDER BY id',
      [demoUser.id]
    );

    expect(transactions).toEqual([
      { type: 'expense', description: 'Aluguel', amount: 1200, category: 'Moradia', date: '2026-09-06' },
      { type: 'income', description: 'Freelance API', amount: 1200, category: 'Outros', date: '2026-09-15' },
      { type: 'expense', description: 'Compras Online', amount: 450, category: 'Compras', date: '2026-09-20' },
      { type: 'income', description: 'Salário Estágio', amount: 3500, category: 'Outros', date: '2026-10-05' },
      { type: 'expense', description: 'Aluguel', amount: 1200, category: 'Moradia', date: '2026-10-06' },
      { type: 'expense', description: 'Supermercado', amount: 850, category: 'Alimentação', date: '2026-10-08' },
      { type: 'income', description: 'Bolsa Pesquisa', amount: 700, category: 'Educação', date: '2026-10-10' },
      { type: 'expense', description: 'Faculdade', amount: 650, category: 'Educação', date: '2026-10-12' },
      { type: 'expense', description: 'Uber', amount: 380, category: 'Transporte', date: '2026-10-14' },
    ]);
    expect(goals).toEqual([
      { name: 'Reserva Financeira', target_amount: 10000, current_amount: 6800 },
      { name: 'Notebook Novo', target_amount: 5500, current_amount: 3850 },
      { name: 'Viagem de Férias', target_amount: 4000, current_amount: 1800 },
    ]);
    await expect(initializeDatabase()).resolves.toBeUndefined();
  });

  it('não inclui metas pertencentes a outro usuário no dashboard', async () => {
    const owner = await request(app)
      .post('/api/register')
      .send({ name: 'Dono do Dashboard', email: 'dashboard-owner@finansee.com', password: '123456' });
    const otherUser = await request(app)
      .post('/api/register')
      .send({ name: 'Outro Usuário', email: 'dashboard-other@finansee.com', password: '123456' });

    const ownerGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${owner.body.token}`)
      .send({ name: 'Meta do dono', target_amount: 200, current_amount: 80 });
    const otherGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${otherUser.body.token}`)
      .send({ name: 'Meta privada', target_amount: 100, current_amount: 20 });

    const dashboard = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${owner.body.token}`);

    expect(dashboard.status).toBe(200);
    expect(ownerGoal.status).toBe(201);
    expect(otherGoal.status).toBe(201);
    expect(dashboard.body.goals).toHaveLength(1);
    expect(dashboard.body.goals[0]).toMatchObject({
      id: ownerGoal.body.id,
      name: 'Meta do dono',
    });
  });

  it('distingue as mensagens de erro de autenticação', async () => {
    const missingHeader = await request(app).get('/api/transactions');
    const missingToken = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer');
    const invalidToken = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer token-invalido');

    expect(missingHeader.body).toEqual({ error: 'Token não fornecido.' });
    expect(missingToken.body).toEqual({ error: 'Formato de token inválido.' });
    expect(invalidToken.body).toEqual({ error: 'Sessão expirada ou inválida.' });
  });

  it.each([
    [{ email: 'missing-name@finansee.com', password: '123456' }],
    [{ name: 'Teste', password: '123456' }],
    [{ name: 'Teste', email: 'missing-password@finansee.com' }],
  ])('rejeita individualmente cada campo obrigatório do cadastro', async (body) => {
    const response = await request(app).post('/api/register').send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Preencha todos os campos.' });
  });

  it('retorna erros de cadastro e login com as mensagens públicas esperadas', async () => {
    const duplicate = await request(app)
      .post('/api/register')
      .send({ name: 'Duplicado', email: 'demo@finansee.com', password: '123456' });
    const shortPassword = await request(app)
      .post('/api/register')
      .send({ name: 'Senha', email: 'curta@finansee.com', password: '12345' });
    const missingLogin = await request(app).post('/api/login').send({ email: 'demo@finansee.com' });
    const unknownUser = await request(app)
      .post('/api/login')
      .send({ email: 'nao-existe@finansee.com', password: '123456' });
    const wrongPassword = await request(app)
      .post('/api/login')
      .send({ email: 'demo@finansee.com', password: 'errada' });

    expect(duplicate.body).toEqual({ error: 'E-mail já cadastrado.' });
    expect(shortPassword.body).toEqual({ error: 'Senha muito curta.' });
    expect(missingLogin.body).toEqual({ error: 'Dados incompletos.' });
    expect(unknownUser.body).toEqual({ error: 'Usuário não encontrado.' });
    expect(wrongPassword.body).toEqual({ error: 'Senha incorreta.' });
  });

  it('preserva o nome normalizado no banco e a identidade dentro do JWT', async () => {
    const registration = await request(app)
      .post('/api/register')
      .send({ name: '  Nome Normalizado  ', email: 'trim-name@finansee.com', password: '123456' });
    const login = await request(app)
      .post('/api/login')
      .send({ email: 'trim-name@finansee.com', password: '123456' });
    const jwt = require('jsonwebtoken');

    expect(registration.body.user.name).toBe('Nome Normalizado');
    expect(jwt.decode(login.body.token)).toMatchObject({
      id: registration.body.user.id,
      name: 'Nome Normalizado',
      email: 'trim-name@finansee.com',
    });
  });

  it('aplica ordenação por data e por id em transações do mesmo dia', async () => {
    const first = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'expense', description: 'Primeira do dia', amount: 10, category: 'Teste', date: '2026-11-11' });
    const second = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'expense', description: 'Segunda do dia', amount: 20, category: 'Teste', date: '2026-11-11' });

    const response = await request(app)
      .get('/api/transactions?month=all')
      .set('Authorization', `Bearer ${authToken}`);
    const sameDayIds = response.body
      .filter((transaction) => transaction.date === '2026-11-11')
      .map((transaction) => transaction.id);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(sameDayIds).toEqual([second.body.id, first.body.id]);
  });

  it.each([
    [{ description: 'Teste', amount: 10, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', amount: 10, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 0, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: -1, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 10, date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 10, category: 'Teste' }],
  ])('rejeita cada campo inválido na criação de transação', async (body) => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Dados de transação inválidos.' });
  });

  it.each([
    [{ description: 'Teste', amount: 10, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', amount: 10, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 0, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: -1, category: 'Teste', date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 10, date: '2026-11-11' }],
    [{ type: 'expense', description: 'Teste', amount: 10, category: 'Teste' }],
  ])('rejeita cada campo inválido na atualização de transação', async (body) => {
    const response = await request(app)
      .put('/api/transactions/1')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Dados inválidos.' });
  });

  it('rejeita meta inválida com mensagem exata e aceita valor atual igual a zero', async () => {
    const invalid = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Inválida', target_amount: 0, current_amount: 0 });
    const zeroProgress = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Sem progresso', target_amount: 100, current_amount: 0 });

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'Dados da meta inválidos.' });
    expect(zeroProgress.status).toBe(201);
    expect(zeroProgress.body).toMatchObject({ current_amount: 0, progressPercentage: 0, isCompleted: false });
  });

  it('calcula resumo, categorias e meses com valores distintos e ordenação cronológica', () => {
    const { calculateFinancialSummary, groupExpensesByCategory, groupMonthlyComparison, TRANSACTION_TYPES } =
      require('./server.js');
    const transactions = [
      { type: TRANSACTION_TYPES.EXPENSE, category: 'Casa', amount: 20, date: '2026-10-02' },
      { type: TRANSACTION_TYPES.INCOME, amount: 800, date: '2026-10-03' },
      { type: TRANSACTION_TYPES.EXPENSE, category: 'Casa', amount: 30, date: '2026-10-04' },
      { type: TRANSACTION_TYPES.EXPENSE, category: 'Transporte', amount: 50, date: '2026-09-01' },
    ];

    expect(calculateFinancialSummary(transactions)).toEqual({
      currentBalance: 700,
      totalIncome: 800,
      totalExpense: 100,
      savedAmount: 700,
      savingsRatePercentage: 88,
    });
    expect(groupExpensesByCategory(transactions)).toEqual([
      { category: 'Casa', total: 50 },
      { category: 'Transporte', total: 50 },
    ]);
    expect(groupMonthlyComparison(transactions)).toEqual([
      { month: '2026-09', income: 0, expense: 50 },
      { month: '2026-10', income: 800, expense: 50 },
    ]);
  });

  it('não filtra o dashboard quando month=all e retorna os totais completos', async () => {
    const response = await request(app)
      .get('/api/dashboard?month=all')
      .set('Authorization', `Bearer ${demoToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      currentBalance: 670,
      totalIncome: 5400,
      totalExpense: 4730,
      savedAmount: 670,
      savingsRatePercentage: 12,
    });
    expect(response.body.monthlyComparison.map(({ month }) => month)).toEqual(['2026-09', '2026-10']);
  });
});
