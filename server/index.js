import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';
import { timingSafeEqual } from 'node:crypto';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'hustle254-dev-secret';
const clientOrigins = [process.env.CLIENT_URL || 'http://localhost:4173,http://localhost:4174', process.env.CORS_ORIGINS || '']
  .join(',')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const databaseUrl = process.env.DATABASE_URL || '';
const isProduction = process.env.NODE_ENV === 'production';
const ADMIN_ACCESS_PASSWORD = process.env.ADMIN_ACCESS_PASSWORD || '';
const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl || 'postgresql://postgres:postgres@localhost:5432/hustle254',
  ssl: isProduction || process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(databaseUrl)
    ? { rejectUnauthorized: false }
    : false,
  max: Number(process.env.PGPOOL_MAX || 5),
  connectionTimeoutMillis: 10000,
});

const mockUsers = [];
const mockWallets = [];
const mockTaskPosts = [];
const adminAccessAttempts = new Map();
const mockSubmissions = [];
const mockPayouts = [];
const mockWalletTransactions = [];
const mockReferrals = [];

let databaseOnline = false;

async function verifyDatabase() {
  try {
    if (isProduction && !databaseUrl) {
      throw new Error('DATABASE_URL is required in production. Configure a persistent PostgreSQL database before starting the API.');
    }

    await pool.query('SELECT 1');
    const requiredTables = [
      'users',
      'wallets',
      'wallet_transactions',
      'tasks',
      'task_posts',
      'task_submissions',
      'payouts',
      'referrals',
      'campaigns',
    ];
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [requiredTables]
    );
    const foundTables = new Set(result.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !foundTables.has(table));
    if (missingTables.length) {
      throw new Error(`Database schema is incomplete (missing: ${missingTables.join(', ')}). Apply db/schema.sql before starting the API.`);
    }
    const requiredColumns = {
      task_posts: ['poster_user_id'],
      task_submissions: ['task_post_id'],
      wallet_transactions: ['transaction_type', 'amount_kes', 'status', 'transaction_reference', 'destination'],
    };
    const columnResult = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [Object.keys(requiredColumns)]
    );
    const foundColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = Object.entries(requiredColumns)
      .flatMap(([table, columns]) => columns.filter((column) => !foundColumns.has(`${table}.${column}`)).map((column) => `${table}.${column}`));
    if (missingColumns.length) {
      throw new Error(`Database schema is incomplete (missing columns: ${missingColumns.join(', ')}). Apply the latest db/schema.sql before starting the API.`);
    }

    databaseOnline = true;
    console.log('PostgreSQL connected');
  } catch (error) {
    databaseOnline = false;
    if (isProduction) throw error;
    console.warn(`PostgreSQL unavailable. Falling back to in-memory development storage: ${error.message}`);
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

function generateToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function sanitizeUser(user) {
  const safeUser = { ...user };
  delete safeUser.password_hash;
  delete safeUser.google_sub;
  return safeUser;
}

function getAuthToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

async function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  if (databaseOnline) {
    const result = await pool.query('SELECT status FROM users WHERE id = $1', [payload.sub]);
    if (!result.rows[0] || result.rows[0].status !== 'active') {
      return res.status(403).json({ message: 'This account is inactive. Contact support for assistance.' });
    }
  }
  req.user = payload;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ message: `${role === 'poster' ? 'Poster' : 'User'} account required.` });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.adminAccess !== true) {
    return res.status(403).json({ message: 'Admin password verification required.' });
  }
  next();
}

const allowedTaskCategories = new Set([
  'Survey',
  'Social',
  'Content',
  'App install',
  'Website testing',
  'Research',
  'Other',
]);
const allowedDepositMethods = new Set(['mpesa', 'mpesa_till', 'paypal', 'usdt_bep20']);
const allowedWithdrawalMethods = new Set(['mpesa', 'paypal', 'crypto', 'till', 'bank']);

function parseKesAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return null;
  return Math.round(amount * 100) / 100;
}

function getMockWalletTransactionById(id) {
  return mockWalletTransactions.find((transaction) => String(transaction.id) === String(id));
}

function getMockWalletByUserId(userId) {
  return mockWallets.find((wallet) => String(wallet.user_id) === String(userId));
}

function validateTaskPost(input = {}) {
  const title = String(input.title || '').trim();
  const category = String(input.category || '').trim();
  const description = String(input.description || '').trim();
  const proofRequirements = String(input.proofRequirements || '').trim();
  const taskUrl = String(input.taskUrl || '').trim();
  const participantLimit = Number(input.participantLimit);
  const payoutKes = Number(input.payoutKes);
  const dueDate = String(input.dueDate || '').trim();

  if (!title || !category || !description || !proofRequirements || !dueDate) {
    return { error: 'Complete all required fields before submitting.' };
  }
  if (title.length > 120 || description.length > 2000 || proofRequirements.length > 1500) {
    return { error: 'Some fields exceed their allowed length.' };
  }
  if (!allowedTaskCategories.has(category)) {
    return { error: 'Choose a valid task category.' };
  }
  if (!Number.isInteger(participantLimit) || participantLimit < 1 || participantLimit > 10000) {
    return { error: 'Participant count must be between 1 and 10,000.' };
  }
  if (!Number.isFinite(payoutKes) || payoutKes < 10 || payoutKes > 100000) {
    return { error: 'Reward per completion must be between KSh 10 and KSh 100,000.' };
  }
  if (participantLimit * payoutKes > 10000000) {
    return { error: 'The total reward budget cannot exceed KSh 10,000,000.' };
  }

  const parsedDueDate = new Date(`${dueDate}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(parsedDueDate.getTime()) || parsedDueDate <= today) {
    return { error: 'Choose a due date at least one day in the future.' };
  }

  if (taskUrl) {
    try {
      const parsedUrl = new URL(taskUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Invalid protocol');
    } catch {
      return { error: 'Enter a valid http or https task link.' };
    }
  }

  return {
    value: {
      title,
      category,
      description,
      task_url: taskUrl || null,
      proof_requirements: proofRequirements,
      participant_limit: participantLimit,
      payout_kes: payoutKes,
      total_budget_kes: participantLimit * payoutKes,
      due_date: dueDate,
    },
  };
}

function asPublishedTask(post) {
  return {
    id: post.id,
    title: post.title,
    category: post.category,
    payout_kes: Number(post.payout_kes),
    duration_minutes: null,
    risk_level: 'low',
    description: post.description,
    due_date: post.due_date,
    participant_limit: Number(post.participant_limit),
    task_url: post.task_url,
    proof_requirements: post.proof_requirements,
    source: 'community',
  };
}

async function findUserByIdentifier(identifier) {
  if (databaseOnline) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $1 LIMIT 1',
      [identifier]
    );
    return result.rows[0] || null;
  }

  return mockUsers.find((user) => user.email === identifier || user.phone === identifier) || null;
}

async function findUserById(id) {
  if (databaseOnline) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  return mockUsers.find((user) => user.id === Number(id)) || null;
}

async function loadWallet(userId) {
  if (databaseOnline) {
    const result = await pool.query('SELECT * FROM wallets WHERE user_id = $1 LIMIT 1', [userId]);
    return result.rows[0] || null;
  }

  return mockWallets.find((wallet) => wallet.user_id === Number(userId)) || null;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: databaseOnline ? 'connected' : 'fallback' });
});

function matchesAdminPassword(value) {
  if (!ADMIN_ACCESS_PASSWORD) return false;
  const suppliedPassword = Buffer.from(String(value || ''));
  const configuredPassword = Buffer.from(ADMIN_ACCESS_PASSWORD);
  return suppliedPassword.length === configuredPassword.length
    && timingSafeEqual(suppliedPassword, configuredPassword);
}

app.get('/api/admin/setup-status', async (req, res) => {
  if (!databaseOnline) {
    return res.status(503).json({ message: 'Admin setup requires the connected production database.' });
  }
  const result = await pool.query("SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS admin_exists");
  return res.json({ available: !result.rows[0].admin_exists });
});

app.post('/api/admin/register', async (req, res) => {
  if (!databaseOnline) {
    return res.status(503).json({ message: 'Admin setup requires the connected production database.' });
  }
  if (!ADMIN_ACCESS_PASSWORD) {
    return res.status(503).json({ message: 'Admin password is not configured on the server.' });
  }

  const { fullName, email: rawEmail, phone, adminPassword } = req.body || {};
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const normalizedName = typeof fullName === 'string' ? fullName.trim() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  if (!normalizedName || !email || !normalizedPhone || !adminPassword) {
    return res.status(400).json({ message: 'Full name, email, phone, and admin password are required.' });
  }
  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ message: 'Invalid email address. Enter a correctly formatted address.' });
  }

  const attemptKey = `setup:${req.ip}`;
  const now = Date.now();
  let attempt = adminAccessAttempts.get(attemptKey);
  if (!attempt || now - attempt.windowStartedAt >= 15 * 60 * 1000) {
    attempt = { failures: 0, windowStartedAt: now, lockedUntil: 0 };
  }
  if (attempt.lockedUntil > now) {
    res.set('Retry-After', String(Math.ceil((attempt.lockedUntil - now) / 1000)));
    return res.status(429).json({ message: 'Too many incorrect attempts. Try again in 15 minutes.' });
  }
  if (!matchesAdminPassword(adminPassword)) {
    attempt.failures += 1;
    if (attempt.failures >= 5) attempt.lockedUntil = now + 15 * 60 * 1000;
    adminAccessAttempts.set(attemptKey, attempt);
    return res.status(403).json({ message: 'Incorrect admin password.' });
  }
  adminAccessAttempts.delete(attemptKey);

  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('hustle254-admin-bootstrap'))");
    const existingAdmin = await connection.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    if (existingAdmin.rowCount) {
      await connection.query('ROLLBACK');
      return res.status(409).json({ message: 'The admin account has already been registered.' });
    }

    const passwordHash = await bcrypt.hash(ADMIN_ACCESS_PASSWORD, 10);
    const referralCode = `H${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const userResult = await connection.query(
      `INSERT INTO users (full_name, email, phone, password_hash, referral_code, role)
       VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING *`,
      [normalizedName, email, normalizedPhone, passwordHash, referralCode]
    );
    const user = userResult.rows[0];
    const walletResult = await connection.query(
      'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *',
      [user.id]
    );
    await connection.query('COMMIT');

    const token = generateToken(user);
    const adminToken = jwt.sign(
      { sub: user.id, email: user.email, role: 'admin', adminAccess: true },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    return res.status(201).json({
      token,
      adminToken,
      user: sanitizeUser(user),
      wallet: walletResult.rows[0],
    });
  } catch (error) {
    await connection.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Email or phone number is already in use.' });
    }
    throw error;
  } finally {
    connection.release();
  }
});

function isValidEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.trim().split('@');
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (
    localPart.length > 64
    || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(localPart)
  ) return false;

  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => (
    label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));
}

async function registerUser(req, res, role = 'user') {
  const { fullName, phone, password, referralCode } = req.body || {};
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ message: 'Full name, email, phone, and password are required.' });
  }
  if (!isValidEmailAddress(email)) {
    return res.status(400).json({
      message: 'Invalid email address. Check the spelling and enter a correctly formatted address.',
    });
  }

  const existingUser = await findUserByIdentifier(email || phone);
  if (existingUser) {
    return res.status(409).json({ message: 'User already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const nextReferralCode = referralCode || `H${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  let nextUser;
  let wallet;

  if (databaseOnline) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const userResult = await connection.query(
        `INSERT INTO users (full_name, email, phone, password_hash, referral_code, role)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [fullName.trim(), email.trim().toLowerCase(), phone.trim(), passwordHash, nextReferralCode, role]
      );
      [nextUser] = userResult.rows;
      const walletResult = await connection.query(
        'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *',
        [nextUser.id]
      );
      [wallet] = walletResult.rows;
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      if (error.code === '23505') {
        return res.status(409).json({ message: 'Email, phone number, or referral code is already in use.' });
      }
      throw error;
    } finally {
      connection.release();
    }
  } else {
    nextUser = {
      id: Date.now(),
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password_hash: passwordHash,
      role,
      referral_code: nextReferralCode,
      status: 'active',
      is_verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    wallet = { id: Date.now() + 1, user_id: nextUser.id, balance_kes: 0, pending_kes: 0, withdrawn_kes: 0 };
    mockUsers.push(nextUser);
    mockWallets.push(wallet);
  }

  const token = generateToken(nextUser);
  return res.status(201).json({
    token,
    user: sanitizeUser(nextUser),
    wallet,
  });
}

app.post('/api/auth/signup', (req, res) => registerUser(req, res));
app.post('/api/auth/poster-signup', (req, res) => registerUser(req, res, 'poster'));

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password, expectedRole } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Identifier and password are required.' });
  }

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ message: 'This account is inactive. Contact support for assistance.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash || user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
  if (expectedRole === 'poster' && user.role !== 'poster') {
    return res.status(403).json({ message: 'These credentials are not for a poster account. Use regular login or register as a poster.' });
  }

  const wallet = await loadWallet(user.id);
  const token = generateToken(user);

  return res.json({
    token,
    user: sanitizeUser(user),
    wallet,
  });
});

app.post('/api/admin/access', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'An admin account is required.' });
  }
  if (!ADMIN_ACCESS_PASSWORD) {
    return res.status(503).json({ message: 'Admin password is not configured on the server.' });
  }

  const accountId = String(req.user.sub);
  const now = Date.now();
  let attempt = adminAccessAttempts.get(accountId);
  if (!attempt || now - attempt.windowStartedAt >= 15 * 60 * 1000) {
    attempt = { failures: 0, windowStartedAt: now, lockedUntil: 0 };
  }
  if (attempt.lockedUntil > now) {
    res.set('Retry-After', String(Math.ceil((attempt.lockedUntil - now) / 1000)));
    return res.status(429).json({ message: 'Too many incorrect attempts. Try again in 15 minutes.' });
  }

  if (!matchesAdminPassword(req.body?.password)) {
    attempt.failures += 1;
    if (attempt.failures >= 5) attempt.lockedUntil = now + 15 * 60 * 1000;
    adminAccessAttempts.set(accountId, attempt);
    return res.status(403).json({ message: 'Incorrect admin password.' });
  }
  adminAccessAttempts.delete(accountId);

  const adminToken = jwt.sign(
    { sub: req.user.sub, email: req.user.email, role: 'admin', adminAccess: true },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  return res.json({ adminToken, expiresIn: 900 });
});

app.get('/api/tasks', async (req, res) => {
  if (databaseOnline) {
    const [tasksResult, postsResult] = await Promise.all([
      pool.query(
        `SELECT id, title, category, payout_kes, duration_minutes, risk_level, description
         FROM tasks WHERE active = TRUE ORDER BY created_at DESC`
      ),
      pool.query(
        "SELECT * FROM task_posts WHERE status = 'approved' AND due_date >= CURRENT_DATE ORDER BY created_at DESC"
      ),
    ]);
    return res.json({ tasks: [...tasksResult.rows, ...postsResult.rows.map(asPublishedTask)] });
  }

  const publishedPosts = mockTaskPosts
    .filter((post) => post.status === 'approved' && new Date(`${post.due_date}T00:00:00.000Z`) >= new Date(new Date().toISOString().slice(0, 10)))
    .map(asPublishedTask);
  res.json({ tasks: publishedPosts });
});

app.post('/api/task-posts', requireAuth, requireRole('poster'), async (req, res) => {
  const validation = validateTaskPost(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const values = validation.value;
  const user = await findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: 'Poster account not found.' });
  let taskPost;

  if (databaseOnline) {
    const result = await pool.query(
      `INSERT INTO task_posts
        (poster_user_id, poster_name, poster_email, title, category, description, task_url, proof_requirements,
         participant_limit, payout_kes, total_budget_kes, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [user.id, user.full_name, user.email, values.title, values.category, values.description,
        values.task_url, values.proof_requirements, values.participant_limit, values.payout_kes,
        values.total_budget_kes, values.due_date]
    );
    [taskPost] = result.rows;
  } else {
    taskPost = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      poster_user_id: user.id,
      poster_name: user.full_name,
      poster_email: user.email,
      ...values,
      status: 'pending_review',
      created_at: new Date().toISOString(),
      reviewed_at: null,
    };
    mockTaskPosts.unshift(taskPost);
  }

  return res.status(201).json({
    message: 'Your job is in the admin review queue. It will appear in Tasks after approval.',
    taskPost,
  });
});

app.get('/api/poster/dashboard', requireAuth, requireRole('poster'), async (req, res) => {
  if (databaseOnline) {
    const [user, posts] = await Promise.all([
      findUserById(req.user.sub),
      pool.query(
        `SELECT task_posts.*,
                COALESCE(submission_counts.submissions_count, 0)::int AS submissions_count,
                COALESCE(submission_counts.pending_count, 0)::int AS pending_count,
                COALESCE(submission_counts.approved_count, 0)::int AS approved_count,
                COALESCE(submission_counts.rejected_count, 0)::int AS rejected_count
         FROM task_posts
         LEFT JOIN (
           SELECT task_posts.id,
                  COUNT(task_submissions.id) AS submissions_count,
                  COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'pending_review') AS pending_count,
                  COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'approved') AS approved_count,
                  COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'rejected') AS rejected_count
           FROM task_posts
           LEFT JOIN task_submissions ON task_submissions.task_post_id = task_posts.id
           WHERE task_posts.poster_user_id = $1 OR (task_posts.poster_user_id IS NULL AND LOWER(task_posts.poster_email) = LOWER($2))
           GROUP BY task_posts.id
         ) AS submission_counts ON submission_counts.id = task_posts.id
         WHERE task_posts.poster_user_id = $1
            OR (task_posts.poster_user_id IS NULL AND LOWER(task_posts.poster_email) = LOWER($2))
         ORDER BY task_posts.created_at DESC`,
        [req.user.sub, user?.email || '']
      ),
    ]);
    if (!user) return res.status(404).json({ message: 'Poster account not found.' });
    return res.json({
      account: sanitizeUser(user),
      billing: { status: 'not_configured', message: 'Deposits and poster balances will be available after payment setup in Step 5.' },
      posts: posts.rows,
      totals: {
        posts: posts.rows.length,
        pending_review: posts.rows.filter((post) => post.status === 'pending_review').length,
        approved: posts.rows.filter((post) => post.status === 'approved').length,
        rejected: posts.rows.filter((post) => post.status === 'rejected').length,
        estimated_requested_budget_kes: posts.rows.reduce((total, post) => total + Number(post.total_budget_kes || 0), 0),
      },
    });
  }

  const user = await findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: 'Poster account not found.' });
  const posts = mockTaskPosts
    .filter((post) => String(post.poster_user_id) === String(user.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return res.json({
    account: sanitizeUser(user),
    billing: { status: 'not_configured', message: 'Deposits and poster balances will be available after payment setup in Step 5.' },
    posts,
    totals: {
      posts: posts.length,
      pending_review: posts.filter((post) => post.status === 'pending_review').length,
      approved: posts.filter((post) => post.status === 'approved').length,
      rejected: posts.filter((post) => post.status === 'rejected').length,
      estimated_requested_budget_kes: posts.reduce((total, post) => total + Number(post.total_budget_kes || 0), 0),
    },
  });
});

app.get('/api/admin/task-posts', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      "SELECT * FROM task_posts WHERE status = 'pending_review' ORDER BY created_at ASC"
    );
    return res.json({ taskPosts: result.rows });
  }

  res.json({ taskPosts: mockTaskPosts.filter((post) => post.status === 'pending_review') });
});

app.patch('/api/admin/task-posts/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved or rejected.' });
  }

  let taskPost;
  if (databaseOnline) {
    const result = await pool.query(
      `UPDATE task_posts SET status = $2, reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending_review' RETURNING *`,
      [req.params.id, status]
    );
    [taskPost] = result.rows;
  } else {
    taskPost = mockTaskPosts.find((post) => post.id === req.params.id && post.status === 'pending_review');
    if (taskPost) {
      taskPost.status = status;
      taskPost.reviewed_at = new Date().toISOString();
    }
  }

  if (!taskPost) return res.status(404).json({ message: 'Pending task post not found.' });
  return res.json({ message: `Task post ${status}.`, taskPost });
});

app.post('/api/tasks/:id/submit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { notes = '', proofType = 'camera_capture', imageUrl = '' } = req.body || {};
  if (typeof notes !== 'string' || notes.length > 2000) {
    return res.status(400).json({ message: 'Proof notes must be 2,000 characters or fewer.' });
  }
  if (typeof imageUrl !== 'string' || imageUrl.length > 4_200_000) {
    return res.status(400).json({ message: 'Proof image must be 3 MB or smaller.' });
  }
  if (imageUrl && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)) {
    return res.status(400).json({ message: 'Proof image must be a valid JPEG, PNG, or WebP image.' });
  }

  let submission;
  if (databaseOnline) {
    const result = await pool.query(
      `INSERT INTO task_submissions (user_id, task_id, task_post_id, proof_type, notes, image_url, status)
       SELECT $1, tasks.id, NULL, $3, $4, $5, 'pending_review'
       FROM tasks WHERE tasks.id = $2 AND tasks.active = TRUE
       UNION ALL
       SELECT $1, NULL, task_posts.id, $3, $4, $5, 'pending_review'
       FROM task_posts
       WHERE task_posts.id = $2 AND task_posts.status = 'approved' AND task_posts.due_date >= CURRENT_DATE
       RETURNING *`,
      [req.user.sub, id, proofType, notes, imageUrl]
    );
    [submission] = result.rows;
  } else {
    const task = mockTaskPosts.find((item) => item.id === id && item.status === 'approved');
    if (task) {
      return res.status(400).json({ message: 'This task cannot accept submissions in development fallback mode.' });
    }
  }

  if (!databaseOnline || !submission) {
    return res.status(404).json({ message: 'Active database task not found.' });
  }

  return res.status(201).json({
    message: 'Task proof submitted successfully and moved to admin review.',
    submission,
  });
});

app.get('/api/user/dashboard', requireAuth, async (req, res) => {
  if (databaseOnline) {
    const user = await findUserById(req.user.sub);
    if (!user) return res.status(404).json({ message: 'User account not found.' });
    const [wallet, statsResult, activityResult] = await Promise.all([
      loadWallet(req.user.sub),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_submissions,
           COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_submissions,
           COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_submissions
         FROM task_submissions WHERE user_id = $1`,
        [req.user.sub]
      ),
      pool.query(
        `SELECT activity_type, description, status, created_at, amount_kes
         FROM (
           SELECT 'task'::text AS activity_type, COALESCE(tasks.title, task_posts.title) AS description,
                 task_submissions.status, task_submissions.created_at,
                 NULL::numeric AS amount_kes
           FROM task_submissions
           LEFT JOIN tasks ON tasks.id = task_submissions.task_id
           LEFT JOIN task_posts ON task_posts.id = task_submissions.task_post_id
           WHERE task_submissions.user_id = $1
           UNION ALL
           SELECT 'payout'::text AS activity_type, payouts.method AS description,
                  payouts.status, payouts.created_at, payouts.amount_kes
           FROM payouts WHERE payouts.user_id = $1
           UNION ALL
           SELECT wallet_transactions.transaction_type::text AS activity_type,
                  COALESCE(wallet_transactions.description, wallet_transactions.payment_method, wallet_transactions.destination) AS description,
                  wallet_transactions.status, wallet_transactions.created_at, wallet_transactions.amount_kes
           FROM wallet_transactions WHERE wallet_transactions.user_id = $1
         ) AS activity
         ORDER BY created_at DESC LIMIT 10`,
        [req.user.sub]
      ),
    ]);
    const referralsResult = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(commission_kes), 0)::numeric AS commission_kes
       FROM referrals WHERE referrer_id = $1`,
      [req.user.sub]
    );
    return res.json({
      user: sanitizeUser(user),
      wallet,
      stats: { ...statsResult.rows[0], ...referralsResult.rows[0] },
      recentActivity: activityResult.rows,
    });
  }

  const user = await findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: 'User account not found.' });
  const wallet = await loadWallet(req.user.sub);
  const userSubmissions = mockSubmissions.filter((item) => String(item.user_id) === String(req.user.sub));
  const userReferrals = mockReferrals.filter((item) => String(item.referrer_id) === String(req.user.sub));
  const recentActivity = [
    ...userSubmissions.map((item) => ({
      activity_type: 'task',
      description: item.title || 'Task submission',
      status: item.status,
      created_at: item.created_at,
      amount_kes: null,
    })),
    ...mockWalletTransactions
      .filter((item) => String(item.user_id) === String(req.user.sub))
      .map((item) => ({
        activity_type: item.transaction_type,
        description: item.description || item.payment_method || item.destination || item.transaction_reference,
        status: item.status,
        created_at: item.created_at,
        amount_kes: item.amount_kes,
      })),
    ...mockPayouts.filter((item) => String(item.user_id) === String(req.user.sub)).map((item) => ({
      activity_type: 'payout',
      description: item.method,
      status: item.status,
      created_at: item.created_at,
      amount_kes: item.amount_kes,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  return res.json({
    user: sanitizeUser(user),
    wallet,
    stats: {
      approved_submissions: userSubmissions.filter((item) => item.status === 'approved').length,
      pending_submissions: userSubmissions.filter((item) => item.status === 'pending_review').length,
      rejected_submissions: userSubmissions.filter((item) => item.status === 'rejected').length,
      count: userReferrals.length,
      commission_kes: userReferrals.reduce((total, item) => total + Number(item.commission_kes || 0), 0),
    },
    recentActivity,
  });
});

app.get('/api/wallet/transactions', requireAuth, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      `SELECT id, transaction_type, amount_kes, status, payment_method,
              transaction_reference, destination, description, created_at, reviewed_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.sub]
    );
    return res.json({ transactions: result.rows });
  }
  return res.json({
    transactions: mockWalletTransactions
      .filter((item) => String(item.user_id) === String(req.user.sub))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
  });
});

app.post('/api/wallet/deposits', requireAuth, requireRole('poster'), async (req, res) => {
  const amount = parseKesAmount(req.body?.amountKes);
  const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase();
  const transactionReference = String(req.body?.transactionReference || '').trim();
  if (!amount) return res.status(400).json({ message: 'Enter a valid deposit amount in KSh.' });
  if (!allowedDepositMethods.has(paymentMethod)) {
    return res.status(400).json({ message: 'Choose M-Pesa direct, M-Pesa Till, PayPal, or USDT BEP20 for a poster deposit.' });
  }
  if (transactionReference.length < 3 || transactionReference.length > 160) {
    return res.status(400).json({ message: 'Enter the payment transaction code or blockchain transaction hash (3–160 characters).' });
  }

  if (databaseOnline) {
    const connection = await pool.connect();
    let transaction;
    try {
      await connection.query('BEGIN');
      const walletResult = await connection.query('SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.sub]);
      const wallet = walletResult.rows[0];
      if (!wallet) {
        await connection.query('ROLLBACK');
        return res.status(409).json({ message: 'Your wallet record is unavailable. Contact support before sending funds.' });
      }
      const result = await connection.query(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, transaction_type, amount_kes, status, payment_method, transaction_reference, description)
         VALUES ($1, $2, 'deposit', $3, 'pending_review', $4, $5, 'Poster deposit awaiting manual verification')
         RETURNING id, transaction_type, amount_kes, status, payment_method, transaction_reference, created_at`,
        [wallet.id, req.user.sub, amount, paymentMethod, transactionReference]
      );
      [transaction] = result.rows;
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      if (error.code === '23505') {
        return res.status(409).json({ message: 'That transaction reference has already been submitted.' });
      }
      throw error;
    } finally {
      connection.release();
    }
    return res.status(201).json({
      message: 'Deposit reference submitted. Funds will be added after admin verification.',
      transaction,
    });
  }

  if (mockWalletTransactions.some((item) => item.transaction_reference?.toLowerCase() === transactionReference.toLowerCase())) {
    return res.status(409).json({ message: 'That transaction reference has already been submitted.' });
  }
  const transaction = {
    id: `deposit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: req.user.sub,
    transaction_type: 'deposit',
    amount_kes: amount,
    status: 'pending_review',
    payment_method: paymentMethod,
    transaction_reference: transactionReference,
    created_at: new Date().toISOString(),
  };
  mockWalletTransactions.unshift(transaction);
  return res.status(201).json({ message: 'Deposit reference submitted. Funds will be added after admin verification.', transaction });
});

app.post('/api/wallet/withdrawals', requireAuth, async (req, res) => {
  if (!['user', 'poster'].includes(req.user.role)) {
    return res.status(403).json({ message: 'A user or poster account is required to request a withdrawal.' });
  }
  const amount = parseKesAmount(req.body?.amountKes);
  const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase();
  const destination = String(req.body?.destination || '').trim();
  if (!amount) return res.status(400).json({ message: 'Enter a valid withdrawal amount in KSh.' });
  if (!allowedWithdrawalMethods.has(paymentMethod)) {
    return res.status(400).json({ message: 'Choose M-Pesa, PayPal, cryptocurrency, till, or bank transfer.' });
  }
  if (!destination || destination.length > 300) {
    return res.status(400).json({ message: 'Enter the account, wallet address, or destination details for the withdrawal.' });
  }

  if (databaseOnline) {
    const connection = await pool.connect();
    let transaction;
    try {
      await connection.query('BEGIN');
      const walletResult = await connection.query(
        'SELECT id, balance_kes FROM wallets WHERE user_id = $1 FOR UPDATE',
        [req.user.sub]
      );
      const wallet = walletResult.rows[0];
      if (!wallet) {
        await connection.query('ROLLBACK');
        return res.status(409).json({ message: 'Your wallet record is unavailable. Contact support.' });
      }
      if (Number(wallet.balance_kes) < amount) {
        await connection.query('ROLLBACK');
        return res.status(400).json({ message: 'Insufficient available balance for this withdrawal.' });
      }
      const result = await connection.query(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, transaction_type, amount_kes, status, payment_method, destination, description)
         VALUES ($1, $2, 'withdrawal', $3, 'pending_review', $4, $5, 'Withdrawal request awaiting manual admin processing')
         RETURNING id, transaction_type, amount_kes, status, payment_method, destination, created_at`,
        [wallet.id, req.user.sub, amount, paymentMethod, destination]
      );
      [transaction] = result.rows;
      await connection.query(
        `UPDATE wallets
         SET balance_kes = balance_kes - $2, pending_kes = pending_kes + $2, updated_at = NOW()
         WHERE id = $1`,
        [wallet.id, amount]
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return res.status(201).json({
      message: 'Withdrawal request sent to admin. The requested amount is reserved until the request is approved or rejected.',
      transaction,
    });
  }

  const wallet = getMockWalletByUserId(req.user.sub);
  if (!wallet) return res.status(409).json({ message: 'Your wallet record is unavailable. Contact support.' });
  if (Number(wallet.balance_kes) < amount) {
    return res.status(400).json({ message: 'Insufficient available balance for this withdrawal.' });
  }
  wallet.balance_kes = Number(wallet.balance_kes) - amount;
  wallet.pending_kes = Number(wallet.pending_kes) + amount;
  const transaction = {
    id: `withdrawal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: req.user.sub,
    transaction_type: 'withdrawal',
    amount_kes: amount,
    status: 'pending_review',
    payment_method: paymentMethod,
    destination,
    created_at: new Date().toISOString(),
  };
  mockWalletTransactions.unshift(transaction);
  return res.status(201).json({
    message: 'Withdrawal request sent to admin. The requested amount is reserved until the request is approved or rejected.',
    transaction,
  });
});

app.get('/api/user/referrals', requireAuth, async (req, res) => {
  if (databaseOnline) {
    const [user, referrals] = await Promise.all([
      findUserById(req.user.sub),
      pool.query(
        `SELECT referrals.id, users.full_name, referrals.commission_kes,
                referrals.status, referrals.created_at
         FROM referrals
         JOIN users ON users.id = referrals.referred_user_id
         WHERE referrals.referrer_id = $1
         ORDER BY referrals.created_at DESC`,
        [req.user.sub]
      ),
    ]);
    if (!user) return res.status(404).json({ message: 'User account not found.' });
    return res.json({ referralCode: user.referral_code, referrals: referrals.rows });
  }

  const user = await findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: 'User account not found.' });
  return res.json({
    referralCode: user.referral_code,
    referrals: mockReferrals
      .filter((item) => String(item.referrer_id) === String(req.user.sub))
      .map((item) => ({
        id: item.id,
        full_name: item.full_name || 'Referred account',
        commission_kes: item.commission_kes,
        status: item.status,
        created_at: item.created_at,
      })),
  });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const [users, posters, payouts, deposits, withdrawals, submissions, taskPosts, campaigns] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'poster'"),
      pool.query("SELECT COUNT(*)::int AS count FROM payouts WHERE status IN ('pending', 'pending_approval')"),
      pool.query("SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE transaction_type = 'deposit' AND status = 'pending_review'"),
      pool.query("SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE transaction_type = 'withdrawal' AND status = 'pending_review'"),
      pool.query("SELECT COUNT(*)::int AS count FROM task_submissions WHERE status = 'pending_review'"),
      pool.query("SELECT COUNT(*)::int AS count FROM task_posts WHERE status = 'pending_review'"),
      pool.query('SELECT COUNT(*)::int AS count FROM campaigns WHERE active = TRUE'),
    ]);
    return res.json({
      usersTotal: users.rows[0].count,
      postersTotal: posters.rows[0].count,
      payoutsPending: payouts.rows[0].count,
      depositsPending: deposits.rows[0].count,
      withdrawalsPending: withdrawals.rows[0].count,
      submissionsPending: submissions.rows[0].count,
      taskPostsPending: taskPosts.rows[0].count,
      campaignsActive: campaigns.rows[0].count,
    });
  }

  return res.json({
    usersTotal: mockUsers.length,
    postersTotal: mockUsers.filter((user) => user.role === 'poster').length,
    payoutsPending: mockPayouts.filter((item) => ['pending', 'pending_approval'].includes(item.status)).length,
    depositsPending: mockWalletTransactions.filter((item) => item.transaction_type === 'deposit' && item.status === 'pending_review').length,
    withdrawalsPending: mockWalletTransactions.filter((item) => item.transaction_type === 'withdrawal' && item.status === 'pending_review').length,
    submissionsPending: mockSubmissions.filter((item) => item.status === 'pending_review').length,
    taskPostsPending: mockTaskPosts.filter((item) => item.status === 'pending_review').length,
    campaignsActive: 0,
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      `SELECT users.id, users.full_name, users.email, users.phone, users.role,
              users.status, users.is_verified, users.created_at,
              wallets.balance_kes, wallets.pending_kes, wallets.withdrawn_kes,
              COALESCE(post_counts.posts_count, 0)::int AS posts_count,
              COALESCE(submission_counts.submissions_count, 0)::int AS submissions_count
       FROM users
       LEFT JOIN wallets ON wallets.user_id = users.id
       LEFT JOIN (
         SELECT users.id AS user_id, COUNT(task_posts.id) AS posts_count
         FROM users
         LEFT JOIN task_posts
           ON task_posts.poster_user_id = users.id
           OR (task_posts.poster_user_id IS NULL AND LOWER(task_posts.poster_email) = LOWER(users.email))
         GROUP BY users.id
       ) AS post_counts ON post_counts.user_id = users.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS submissions_count
         FROM task_submissions GROUP BY user_id
       ) AS submission_counts ON submission_counts.user_id = users.id
       ORDER BY users.created_at DESC LIMIT 500`
    );
    return res.json({ users: result.rows });
  }
  return res.json({
    users: mockUsers.map((user) => ({
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      is_verified: user.is_verified,
      created_at: user.created_at,
      ...(mockWallets.find((wallet) => String(wallet.user_id) === String(user.id)) || {
        balance_kes: null,
        pending_kes: null,
        withdrawn_kes: null,
      }),
      posts_count: mockTaskPosts.filter((post) => String(post.poster_user_id) === String(user.id)).length,
      submissions_count: mockSubmissions.filter((submission) => String(submission.user_id) === String(user.id)).length,
    })),
  });
});

app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ message: 'Account status must be active or suspended.' });
  }
  if (String(req.params.id) === String(req.user.sub)) {
    return res.status(400).json({ message: 'You cannot change your own account status.' });
  }

  let user;
  if (databaseOnline) {
    const result = await pool.query(
      `UPDATE users SET status = $2, updated_at = NOW()
       WHERE id = $1 AND role IN ('user', 'poster')
       RETURNING id, full_name, email, phone, role, status, is_verified, created_at`,
      [req.params.id, status]
    );
    [user] = result.rows;
  } else {
    user = mockUsers.find((item) => String(item.id) === String(req.params.id) && ['user', 'poster'].includes(item.role));
    if (user) {
      user.status = status;
      user.updated_at = new Date().toISOString();
    }
  }
  if (!user) return res.status(404).json({ message: 'User or poster account not found.' });
  return res.json({ user });
});

app.get('/api/admin/campaigns', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    return res.json({ campaigns: result.rows });
  }
  return res.json({ campaigns: [] });
});

app.get('/api/admin/catalog', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    return res.json({ tasks: result.rows });
  }
  return res.json({ tasks: [] });
});

app.patch('/api/admin/catalog/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ message: 'Task active status must be true or false.' });
  }
  if (!databaseOnline) return res.status(404).json({ message: 'Task not found in the development data store.' });
  const result = await pool.query(
    'UPDATE tasks SET active = $2 WHERE id = $1 RETURNING *',
    [req.params.id, active]
  );
  if (!result.rows[0]) return res.status(404).json({ message: 'Task not found.' });
  return res.json({ task: result.rows[0] });
});

app.patch('/api/admin/campaigns/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ message: 'Campaign active status must be true or false.' });
  }
  if (!databaseOnline) return res.status(404).json({ message: 'Campaign not found in the development data store.' });
  const result = await pool.query(
    'UPDATE campaigns SET active = $2 WHERE id = $1 RETURNING *',
    [req.params.id, active]
  );
  if (!result.rows[0]) return res.status(404).json({ message: 'Campaign not found.' });
  return res.json({ campaign: result.rows[0] });
});

app.get('/api/admin/tasks', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      `SELECT task_submissions.id, users.full_name AS user_name, users.email AS user_email,
              COALESCE(tasks.title, task_posts.title) AS task_title,
              COALESCE(tasks.payout_kes, task_posts.payout_kes) AS amount_kes,
              task_submissions.status, task_submissions.proof_type, task_submissions.notes, task_submissions.image_url,
              task_submissions.created_at
       FROM task_submissions
       JOIN users ON users.id = task_submissions.user_id
       LEFT JOIN tasks ON tasks.id = task_submissions.task_id
       LEFT JOIN task_posts ON task_posts.id = task_submissions.task_post_id
       ORDER BY task_submissions.created_at DESC LIMIT 100`
    );
    return res.json({ tasks: result.rows });
  }
  return res.json({ tasks: mockSubmissions });
});

app.patch('/api/admin/tasks/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved or rejected.' });
  }

  if (databaseOnline) {
    const result = await pool.query(
      `UPDATE task_submissions SET status = $2, reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending_review' RETURNING *`,
      [req.params.id, status]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Pending submission not found.' });
    return res.json({
      message: 'Submission review status updated. This task review does not change the wallet balance.',
      submission: result.rows[0],
    });
  }

  const submission = mockSubmissions.find((item) => item.id === req.params.id && item.status === 'pending_review');
  if (!submission) {
    return res.status(404).json({ message: 'Submission not found.' });
  }
  submission.status = status;
  submission.reviewed_at = new Date().toISOString();
  return res.json({
    message: 'Submission review status updated. This task review does not change the wallet balance.',
    submission,
  });
});

app.post('/api/payouts/request', requireAuth, (req, res) => {
  return res.status(410).json({
    message: 'This payout endpoint is retired. Submit withdrawals through POST /api/wallet/withdrawals so funds are reserved and audited.',
  });
});

app.get('/api/admin/wallet-transactions', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      `SELECT wallet_transactions.id, wallet_transactions.user_id,
              users.full_name AS user_name, users.email AS user_email, users.role AS user_role,
              wallet_transactions.transaction_type, wallet_transactions.amount_kes,
              wallet_transactions.status, wallet_transactions.payment_method,
              wallet_transactions.transaction_reference, wallet_transactions.destination,
              wallet_transactions.description, wallet_transactions.created_at,
              wallet_transactions.reviewed_at
       FROM wallet_transactions
       JOIN users ON users.id = wallet_transactions.user_id
       WHERE wallet_transactions.status = 'pending_review'
          OR wallet_transactions.id IN (
            SELECT id FROM wallet_transactions
            WHERE status != 'pending_review'
            ORDER BY created_at DESC
            LIMIT 200
          )
       ORDER BY (wallet_transactions.status = 'pending_review') DESC, wallet_transactions.created_at DESC
      `
    );
    return res.json({ transactions: result.rows });
  }
  return res.json({
    transactions: mockWalletTransactions.map((transaction) => ({
      ...transaction,
      user_name: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.full_name || 'Account unavailable',
      user_email: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.email || '',
      user_role: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.role || 'user',
    })),
  });
});

app.patch('/api/admin/wallet-transactions/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Transaction decision must be approved or rejected.' });
  }

  if (databaseOnline) {
    const connection = await pool.connect();
    let transaction;
    try {
      await connection.query('BEGIN');
      const result = await connection.query(
        `SELECT * FROM wallet_transactions
         WHERE id = $1 AND transaction_type IN ('deposit', 'withdrawal') AND status = 'pending_review'
         FOR UPDATE`,
        [req.params.id]
      );
      [transaction] = result.rows;
      if (!transaction) {
        await connection.query('ROLLBACK');
        return res.status(404).json({ message: 'Pending deposit or withdrawal not found.' });
      }

      const walletResult = await connection.query(
        'SELECT id FROM wallets WHERE id = $1 FOR UPDATE',
        [transaction.wallet_id]
      );
      if (!walletResult.rows[0]) throw new Error('Wallet record is missing for this transaction.');

      if (transaction.transaction_type === 'deposit' && status === 'approved') {
        await connection.query(
          'UPDATE wallets SET balance_kes = balance_kes + $2, updated_at = NOW() WHERE id = $1',
          [transaction.wallet_id, transaction.amount_kes]
        );
      } else if (transaction.transaction_type === 'withdrawal' && status === 'approved') {
        await connection.query(
          `UPDATE wallets
           SET pending_kes = pending_kes - $2, withdrawn_kes = withdrawn_kes + $2, updated_at = NOW()
           WHERE id = $1`,
          [transaction.wallet_id, transaction.amount_kes]
        );
      } else if (transaction.transaction_type === 'withdrawal' && status === 'rejected') {
        await connection.query(
          `UPDATE wallets
           SET balance_kes = balance_kes + $2, pending_kes = pending_kes - $2, updated_at = NOW()
           WHERE id = $1`,
          [transaction.wallet_id, transaction.amount_kes]
        );
      }

      const updated = await connection.query(
        `UPDATE wallet_transactions
         SET status = $2, reviewer_id = $3, reviewed_at = NOW()
         WHERE id = $1 AND status = 'pending_review'
         RETURNING id, user_id, transaction_type, amount_kes, status, payment_method,
                   transaction_reference, destination, description, created_at, reviewed_at`,
        [req.params.id, status, req.user.sub]
      );
      [transaction] = updated.rows;
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return res.json({
      transaction,
      message: transaction.transaction_type === 'deposit' && status === 'approved'
        ? 'Deposit verified and credited to the poster wallet.'
        : transaction.transaction_type === 'withdrawal' && status === 'approved'
          ? 'Withdrawal approved. Complete the manual transfer to the recorded destination.'
          : transaction.transaction_type === 'withdrawal'
            ? 'Withdrawal rejected and reserved funds returned to the available wallet balance.'
            : 'Deposit rejected. No wallet credit was made.',
    });
  }

  const transaction = getMockWalletTransactionById(req.params.id);
  if (!transaction || !['deposit', 'withdrawal'].includes(transaction.transaction_type) || transaction.status !== 'pending_review') {
    return res.status(404).json({ message: 'Pending deposit or withdrawal not found.' });
  }
  const wallet = getMockWalletByUserId(transaction.user_id);
  if (!wallet) return res.status(409).json({ message: 'Wallet record is missing for this transaction.' });
  const amount = Number(transaction.amount_kes);
  if (transaction.transaction_type === 'deposit' && status === 'approved') {
    wallet.balance_kes = Number(wallet.balance_kes) + amount;
  } else if (transaction.transaction_type === 'withdrawal' && status === 'approved') {
    wallet.pending_kes = Number(wallet.pending_kes) - amount;
    wallet.withdrawn_kes = Number(wallet.withdrawn_kes) + amount;
  } else if (transaction.transaction_type === 'withdrawal' && status === 'rejected') {
    wallet.balance_kes = Number(wallet.balance_kes) + amount;
    wallet.pending_kes = Number(wallet.pending_kes) - amount;
  }
  transaction.status = status;
  transaction.reviewed_at = new Date().toISOString();
  transaction.reviewer_id = req.user.sub;
  return res.json({
    transaction,
    message: transaction.transaction_type === 'deposit' && status === 'approved'
      ? 'Deposit verified and credited to the poster wallet.'
      : transaction.transaction_type === 'withdrawal' && status === 'approved'
        ? 'Withdrawal approved. Complete the manual transfer to the recorded destination.'
        : transaction.transaction_type === 'withdrawal'
          ? 'Withdrawal rejected and reserved funds returned to the available wallet balance.'
          : 'Deposit rejected. No wallet credit was made.',
  });
});

app.get('/api/admin/payouts', requireAuth, requireAdmin, async (req, res) => {
  if (databaseOnline) {
    const result = await pool.query(
      `SELECT payouts.id, users.full_name AS user_name, payouts.method, payouts.destination,
              payouts.amount_kes, payouts.status, payouts.created_at
       FROM payouts
       JOIN users ON users.id = payouts.user_id
       ORDER BY payouts.created_at DESC LIMIT 100`
    );
    return res.json({ payouts: result.rows });
  }
  return res.json({ payouts: mockPayouts });
});

app.patch('/api/admin/payouts/:id/status', requireAuth, requireAdmin, (req, res) => {
  return res.status(410).json({
    message: 'This legacy payout workflow is read-only. Review new withdrawal requests through /api/admin/wallet-transactions.',
  });
});

async function startServer() {
  try {
    await verifyDatabase();
    app.listen(port, '0.0.0.0', () => {
      console.log(`Hustle254 API running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error(`Hustle254 API startup blocked: ${error.message}`);
    await pool.end();
    process.exitCode = 1;
  }
}

startServer();
