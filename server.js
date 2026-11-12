require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

// ============================================================================
// 1. CONSTANTES (Premissa 3: Evite Números Mágicos)
// ============================================================================
const CONSTANTS = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'finansee_codigo_limpo_secret',
  PASSWORD_SALT_ROUNDS: 10,
  MIN_PASSWORD_LENGTH: 6,
  TOKEN_EXPIRATION: '24h',
  GOAL_COMPLETION_PERCENTAGE: 100,
  RECENT_TRANSACTIONS_LIMIT: 5,
  YEAR_MONTH_LENGTH: 7,
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

const TRANSACTION_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const database = new sqlite3.Database(
  process.env.DATABASE_PATH || path.join(__dirname, 'finansee.sqlite')
);

// ============================================================================
// 2. FUNÇÕES AUXILIARES DE BANCO (Premissa 5: Coesão)
// ============================================================================
function executeCommand(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function querySingle(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function queryMultiple(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

// ============================================================================
// 3. MIDDLEWARES E VALIDAÇÕES (Premissa 6: Cláusulas Guarda / Retorno Antecipado)
// ============================================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Token não fornecido.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Formato de token inválido.' });
  }

  try {
    req.user = jwt.verify(token, CONSTANTS.JWT_SECRET);
    return next(); // Caminho feliz
  } catch (error) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Sessão expirada ou inválida.' });
  }
}

// ============================================================================
// 4. AUTENTICAÇÃO E CADASTRO
// ============================================================================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Cláusulas guarda (Premissa 6)
    if (!name || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Preencha todos os campos.' });
    }
    if (password.length < CONSTANTS.MIN_PASSWORD_LENGTH) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Senha muito curta.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await querySingle('SELECT id FROM users WHERE email = ?', [
      normalizedEmail,
    ]);

    if (existingUser) {
      return res.status(HTTP_STATUS.CONFLICT).json({ error: 'E-mail já cadastrado.' });
    }

    // Fluxo Principal (Caminho feliz)
    const hashedPassword = await bcrypt.hash(password, CONSTANTS.PASSWORD_SALT_ROUNDS);
    const result = await executeCommand(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name.trim(), normalizedEmail, hashedPassword]
    );

    const user = { id: result.id, name: name.trim(), email: normalizedEmail };
    const token = jwt.sign(user, CONSTANTS.JWT_SECRET, { expiresIn: CONSTANTS.TOKEN_EXPIRATION });

    return res.status(HTTP_STATUS.CREATED).json({ user, token });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: 'Erro no servidor.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Dados incompletos.' });
    }

    const userRecord = await querySingle('SELECT * FROM users WHERE email = ?', [
      email.toLowerCase(),
    ]);
    if (!userRecord) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Usuário não encontrado.' });
    }

    const isPasswordValid = await bcrypt.compare(password, userRecord.password);
    if (!isPasswordValid) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Senha incorreta.' });
    }

    const user = { id: userRecord.id, name: userRecord.name, email: userRecord.email };
    const token = jwt.sign(user, CONSTANTS.JWT_SECRET, { expiresIn: CONSTANTS.TOKEN_EXPIRATION });

    return res.status(HTTP_STATUS.OK).json({ user, token });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: 'Erro no login.' });
  }
});

// ============================================================================
// 5. TRANSAÇÕES (Premissa 4: Linguagem Ubíqua - padronizado como "transaction")
// ============================================================================
app.get('/api/transactions', authenticateToken, async (req, res) => {
  const { month } = req.query;
  let sql = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [req.user.id];

  if (month && month !== 'all') {
    sql += ' AND substr(date, 1, ?) = ?';
    params.push(CONSTANTS.YEAR_MONTH_LENGTH, month);
  }

  sql += ' ORDER BY date DESC, id DESC';
  const transactions = await queryMultiple(sql, params);
  return res.status(HTTP_STATUS.OK).json(transactions);
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
  const { type, description, amount, category, date } = req.body;

  if (!type || !description || amount <= 0 || !category || !date) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Dados de transação inválidos.' });
  }

  const result = await executeCommand(
    'INSERT INTO transactions (user_id, type, description, amount, category, date) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, type, description, Number(amount), category, date]
  );

  const newTransaction = await querySingle('SELECT * FROM transactions WHERE id = ?', [result.id]);
  return res.status(HTTP_STATUS.CREATED).json(newTransaction);
});

app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  const { type, description, amount, category, date } = req.body;

  if (!type || !description || amount <= 0 || !category || !date) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Dados inválidos.' });
  }

  await executeCommand(
    'UPDATE transactions SET type = ?, description = ?, amount = ?, category = ?, date = ? WHERE id = ? AND user_id = ?',
    [type, description, Number(amount), category, date, req.params.id, req.user.id]
  );

  const updatedTransaction = await querySingle('SELECT * FROM transactions WHERE id = ?', [
    req.params.id,
  ]);
  return res.status(HTTP_STATUS.OK).json(updatedTransaction);
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  await executeCommand('DELETE FROM transactions WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.user.id,
  ]);
  return res.status(HTTP_STATUS.OK).json({ success: true });
});

// ============================================================================
// 6. METAS FINANCEIRAS
// ============================================================================
function enrichGoalWithProgress(goal) {
  const rawPercentage = Math.round((goal.current_amount / goal.target_amount) * 100);
  const progressPercentage = Math.min(rawPercentage, CONSTANTS.GOAL_COMPLETION_PERCENTAGE);

  return {
    ...goal,
    progressPercentage,
    isCompleted: progressPercentage >= CONSTANTS.GOAL_COMPLETION_PERCENTAGE,
  };
}

app.get('/api/goals', authenticateToken, async (req, res) => {
  const goals = await queryMultiple('SELECT * FROM goals WHERE user_id = ?', [req.user.id]);
  const enrichedGoals = goals.map(enrichGoalWithProgress);
  return res.status(HTTP_STATUS.OK).json(enrichedGoals);
});

app.post('/api/goals', authenticateToken, async (req, res) => {
  const { name, target_amount, current_amount } = req.body;

  if (!name || target_amount <= 0 || current_amount < 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Dados da meta inválidos.' });
  }

  const result = await executeCommand(
    'INSERT INTO goals (user_id, name, target_amount, current_amount) VALUES (?, ?, ?, ?)',
    [req.user.id, name, Number(target_amount), Number(current_amount)]
  );

  const newGoal = await querySingle('SELECT * FROM goals WHERE id = ?', [result.id]);
  return res.status(HTTP_STATUS.CREATED).json(enrichGoalWithProgress(newGoal));
});

app.delete('/api/goals/:id', authenticateToken, async (req, res) => {
  await executeCommand('DELETE FROM goals WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.user.id,
  ]);
  return res.status(HTTP_STATUS.OK).json({ success: true });
});

// ============================================================================
// 7. DASHBOARD (Premissa 5: Lógica quebrada em funções menores coesas)
// ============================================================================
function calculateFinancialSummary(transactions) {
  let totalIncome = 0;
  let totalExpense = 0;

  for (const transaction of transactions) {
    if (transaction.type === TRANSACTION_TYPES.INCOME) totalIncome += Number(transaction.amount);
    else totalExpense += Number(transaction.amount);
  }

  const currentBalance = totalIncome - totalExpense;
  const savedAmount = Math.max(0, currentBalance);
  const savingsRatePercentage = totalIncome > 0 ? Math.round((savedAmount / totalIncome) * 100) : 0;

  return { currentBalance, totalIncome, totalExpense, savedAmount, savingsRatePercentage };
}

function groupExpensesByCategory(transactions) {
  const categories = {};
  for (const transaction of transactions) {
    if (transaction.type === TRANSACTION_TYPES.EXPENSE) {
      categories[transaction.category] =
        (categories[transaction.category] || 0) + Number(transaction.amount);
    }
  }
  return Object.entries(categories).map(([category, total]) => ({ category, total }));
}

function groupMonthlyComparison(allTransactions) {
  const monthlyData = {};
  for (const transaction of allTransactions) {
    const monthKey = transaction.date.slice(0, CONSTANTS.YEAR_MONTH_LENGTH);
    if (!monthlyData[monthKey]) monthlyData[monthKey] = { month: monthKey, income: 0, expense: 0 };

    if (transaction.type === TRANSACTION_TYPES.INCOME)
      monthlyData[monthKey].income += Number(transaction.amount);
    else monthlyData[monthKey].expense += Number(transaction.amount);
  }
  return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
}

app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const { month } = req.query;
    const allTransactions = await queryMultiple(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC',
      [req.user.id]
    );

    const filteredTransactions =
      month && month !== 'all'
        ? allTransactions.filter((t) => t.date.slice(0, CONSTANTS.YEAR_MONTH_LENGTH) === month)
        : allTransactions;

    const summary = calculateFinancialSummary(filteredTransactions);
    const expensesByCategory = groupExpensesByCategory(filteredTransactions);
    const monthlyComparison = groupMonthlyComparison(allTransactions);

    const goals = await queryMultiple('SELECT * FROM goals WHERE user_id = ?', [req.user.id]);
    const enrichedGoals = goals.map(enrichGoalWithProgress);

    return res.status(HTTP_STATUS.OK).json({
      summary,
      expensesByCategory,
      monthlyComparison,
      recentTransactions: filteredTransactions.slice(0, CONSTANTS.RECENT_TRANSACTIONS_LIMIT),
      goals: enrichedGoals,
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: 'Erro ao carregar dashboard.' });
  }
});

// ============================================================================
// 8. INICIALIZAÇÃO DE BANCO E SEED
// ============================================================================
async function initializeDatabase() {
  await executeCommand(
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT)`
  );
  await executeCommand(
    `CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, description TEXT, amount REAL, category TEXT, date TEXT)`
  );
  await executeCommand(
    `CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, target_amount REAL, current_amount REAL)`
  );

  const demoUser = await querySingle('SELECT id FROM users WHERE email = ?', ['demo@finansee.com']);
  if (!demoUser) {
    const passwordHash = await bcrypt.hash('123456', CONSTANTS.PASSWORD_SALT_ROUNDS);
    const userResult = await executeCommand(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      ['Estudante Demo', 'demo@finansee.com', passwordHash]
    );

    const initialTransactions = [
      ['income', 'Salário Estágio', 3500, 'Outros', '2026-10-05'],
      ['income', 'Bolsa Pesquisa', 700, 'Educação', '2026-10-10'],
      ['expense', 'Aluguel', 1200, 'Moradia', '2026-10-06'],
      ['expense', 'Supermercado', 850, 'Alimentação', '2026-10-08'],
      ['expense', 'Faculdade', 650, 'Educação', '2026-10-12'],
      ['expense', 'Uber', 380, 'Transporte', '2026-10-14'],
      ['income', 'Freelance API', 1200, 'Outros', '2026-09-15'],
      ['expense', 'Aluguel', 1200, 'Moradia', '2026-09-06'],
      ['expense', 'Compras Online', 450, 'Compras', '2026-09-20'],
    ];

    for (const tx of initialTransactions) {
      await executeCommand(
        'INSERT INTO transactions (user_id, type, description, amount, category, date) VALUES (?, ?, ?, ?, ?, ?)',
        [userResult.id, ...tx]
      );
    }

    const initialGoals = [
      ['Reserva Financeira', 10000, 6800],
      ['Notebook Novo', 5500, 3850],
      ['Viagem de Férias', 4000, 1800],
    ];

    for (const gl of initialGoals) {
      await executeCommand(
        'INSERT INTO goals (user_id, name, target_amount, current_amount) VALUES (?, ?, ?, ?)',
        [userResult.id, ...gl]
      );
    }
  }
}

function startServer() {
  return initializeDatabase().then(() =>
    app.listen(CONSTANTS.PORT, () =>
      console.log(`Servidor rodando em http://localhost:${CONSTANTS.PORT}`)
    )
  );
}

// Apenas inicializa o banco e o servidor se o arquivo for executado diretamente (ex: node server.js)
function startServerIfMain(currentModule, mainModule) {
  if (currentModule === mainModule) return startServer();
}

startServerIfMain(module, require.main);

if (require.main !== module) {
  module.exports = {
    app, database, CONSTANTS, initializeDatabase,
    calculateFinancialSummary, groupExpensesByCategory, groupMonthlyComparison, TRANSACTION_TYPES,
    executeCommand, querySingle, queryMultiple, startServer, startServerIfMain,
  };
}