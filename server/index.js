import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleOAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl || 'postgresql://postgres:postgres@localhost:5432/hustle254',
  ssl: isProduction || process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(databaseUrl)
    ? { rejectUnauthorized: false }
    : false,
  max: Number(process.env.PGPOOL_MAX || 5),
  connectionTimeoutMillis: 10000,
});

const mockUsers = [
  {
    id: 1,
    full_name: 'Admin Hustle254',
    email: 'admin@hustle254.co.ke',
    phone: '+254700000001',
    password_hash: '$2a$10$7H0Wtw6kvPP3Dd4YVt8qj.u0cX7BUy0YLuVvUQq2BVd/8ah7kS4y2',
    role: 'admin',
    referral_code: 'ADMIN254',
    status: 'active',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    full_name: 'Jane Wanjiku',
    email: 'jane@hustle254.co.ke',
    phone: '+254712345678',
    password_hash: '$2a$10$7H0Wtw6kvPP3Dd4YVt8qj.u0cX7BUy0YLuVvUQq2BVd/8ah7kS4y2',
    role: 'user',
    referral_code: 'JANE254',
    status: 'active',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockWallets = [
  { id: 1, user_id: 1, balance_kes: 0, pending_kes: 0, withdrawn_kes: 0 },
  { id: 2, user_id: 2, balance_kes: 7840, pending_kes: 1430, withdrawn_kes: 500 },
];

const mockTasks = [
  { id: 'task-1', title: 'Quick survey', category: 'Survey', payout_kes: 80, duration_minutes: 6, risk_level: 'low', description: 'Fast survey with clear verification steps.' },
  { id: 'task-2', title: 'App install trial', category: 'Offer wall', payout_kes: 160, duration_minutes: 12, risk_level: 'medium', description: 'Install and verify an app in a live session.' },
  { id: 'task-3', title: 'Social engagement task', category: 'Social', payout_kes: 110, duration_minutes: 8, risk_level: 'low', description: 'Follow, like, or share content using the required steps.' },
  { id: 'task-4', title: 'Referral bonus', category: 'Referral', payout_kes: 250, duration_minutes: 3, risk_level: 'low', description: 'Reward for successful qualifying referral.' },
  { id: 'task-5', title: 'Daily streak reward', category: 'Bonus', payout_kes: 45, duration_minutes: 1, risk_level: 'low', description: 'Daily streak loyalty bonus.' },
  { id: 'task-6', title: 'Brand campaign', category: 'Campaign', payout_kes: 220, duration_minutes: 15, risk_level: 'medium', description: 'Complete a qualifying brand task and submit proof.' },
];

const mockTaskPosts = [];
const adminAccessAttempts = new Map();

const mockSubmissions = [
  { id: 'sub-1', user_id: 2, task_id: 'task-1', status: 'approved', proof_type: 'camera_capture', notes: 'submitted and verified', created_at: new Date().toISOString() },
  { id: 'sub-2', user_id: 2, task_id: 'task-2', status: 'pending_review', proof_type: 'camera_capture', notes: 'awaiting review', created_at: new Date().toISOString() },
];

const mockPayouts = [
  { id: 'payout-1', user_id: 2, method: 'M-Pesa', destination: '+254712345678', amount_kes: 500, status: 'approved', created_at: new Date().toISOString() },
];

const mockReferrals = [
  { id: 'ref-1', referrer_id: 2, referred_user_id: 1, commission_kes: 250, status: 'approved' },
];

let databaseOnline = false;

async function verifyDatabase() {
  try {
    if (isProduction && !databaseUrl) {
      throw new Error('DATABASE_URL is required in production. Configure a persistent PostgreSQL database before starting the API.');
    }

    await pool.query('SELECT 1');
    const requiredTables = ['users', 'wallets', 'task_posts'];
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

    databaseOnline = true;
    console.log('PostgreSQL connected');
  } catch (error) {
    databaseOnline = false;
    if (isProduction) throw error;
    console.warn('PostgreSQL unavailable. Falling back to mock data.');
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

function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
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

function validateTaskPost(input = {}) {
  const posterName = String(input.posterName || '').trim();
  const posterEmail = String(input.posterEmail || '').trim().toLowerCase();
  const title = String(input.title || '').trim();
  const category = String(input.category || '').trim();
  const description = String(input.description || '').trim();
  const proofRequirements = String(input.proofRequirements || '').trim();
  const taskUrl = String(input.taskUrl || '').trim();
  const participantLimit = Number(input.participantLimit);
  const payoutKes = Number(input.payoutKes);
  const dueDate = String(input.dueDate || '').trim();

  if (!posterName || !posterEmail || !title || !category || !description || !proofRequirements || !dueDate) {
    return { error: 'Complete all required fields before submitting.' };
  }
  if (posterName.length > 100 || title.length > 120 || description.length > 2000 || proofRequirements.length > 1500) {
    return { error: 'Some fields exceed their allowed length.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(posterEmail)) {
    return { error: 'Enter a valid contact email.' };
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
      poster_name: posterName,
      poster_email: posterEmail,
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

app.get('/', (req, res) => {
  res.json({
    service: 'Hustle254 API',
    status: 'ok',
    database: databaseOnline ? 'connected' : 'fallback',
    endpoints: {
      health: '/api/health',
      tasks: '/api/tasks',
    },
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: databaseOnline ? 'connected' : 'fallback' });
});

app.post('/api/auth/signup', async (req, res) => {
  const { fullName, email, phone, password, referralCode } = req.body || {};

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ message: 'Full name, email, phone, and password are required.' });
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
        `INSERT INTO users (full_name, email, phone, password_hash, referral_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fullName.trim(), email.trim().toLowerCase(), phone.trim(), passwordHash, nextReferralCode]
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
      role: 'user',
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
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Identifier and password are required.' });
  }

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash || user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const wallet = await loadWallet(user.id);
  const token = generateToken(user);

  return res.json({
    token,
    user: sanitizeUser(user),
    wallet,
  });
});

app.post('/api/auth/google', async (req, res) => {
  if (!googleOAuthClient) {
    return res.status(503).json({ message: 'Google sign-in is not configured for this deployment.' });
  }

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ message: 'Google credential is required.' });

  let googleProfile;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    googleProfile = ticket.getPayload();
  } catch {
    return res.status(401).json({ message: 'Google could not verify this sign-in. Please try again.' });
  }

  if (!googleProfile?.email || googleProfile.email_verified !== true || !googleProfile.sub) {
    return res.status(401).json({ message: 'A verified Google email is required.' });
  }

  let user;
  if (databaseOnline) {
    user = (await pool.query('SELECT * FROM users WHERE google_sub = $1 LIMIT 1', [googleProfile.sub])).rows[0];
    if (!user) user = (await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [googleProfile.email])).rows[0];

    if (user?.google_sub && user.google_sub !== googleProfile.sub) {
      return res.status(409).json({ message: 'This email is linked to a different Google account.' });
    }

    if (user && !user.google_sub) {
      const linked = await pool.query('UPDATE users SET google_sub = $2 WHERE id = $1 RETURNING *', [user.id, googleProfile.sub]);
      [user] = linked.rows;
    }

    if (!user) {
      const generatedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
      const referralCode = `H${randomBytes(4).toString('hex').toUpperCase()}`;
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const inserted = await connection.query(
          `INSERT INTO users (full_name, email, phone, password_hash, google_sub, referral_code, is_verified)
           VALUES ($1, $2, NULL, $3, $4, $5, TRUE) RETURNING *`,
          [googleProfile.name || googleProfile.email.split('@')[0], googleProfile.email.toLowerCase(), generatedPassword, googleProfile.sub, referralCode]
        );
        [user] = inserted.rows;
        await connection.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ message: 'This Google account is already linked. Please sign in again.' });
        throw error;
      } finally {
        connection.release();
      }
    }
  } else {
    user = mockUsers.find((item) => item.google_sub === googleProfile.sub)
      || mockUsers.find((item) => item.email.toLowerCase() === googleProfile.email.toLowerCase());

    if (user?.google_sub && user.google_sub !== googleProfile.sub) {
      return res.status(409).json({ message: 'This email is linked to a different Google account.' });
    }

    if (!user) {
      user = {
        id: Date.now(),
        full_name: googleProfile.name || googleProfile.email.split('@')[0],
        email: googleProfile.email.toLowerCase(),
        phone: null,
        password_hash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        google_sub: googleProfile.sub,
        role: 'user',
        referral_code: `H${randomBytes(4).toString('hex').toUpperCase()}`,
        status: 'active',
        is_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockUsers.push(user);
      mockWallets.push({ id: Date.now() + 1, user_id: user.id, balance_kes: 0, pending_kes: 0, withdrawn_kes: 0 });
    } else if (!user.google_sub) {
      user.google_sub = googleProfile.sub;
    }
  }

  return res.json({ token: generateToken(user), user: sanitizeUser(user) });
});

app.post('/api/admin/access', requireAuth, (req, res) => {
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

  const suppliedPassword = Buffer.from(String(req.body?.password || ''));
  const configuredPassword = Buffer.from(ADMIN_ACCESS_PASSWORD);
  if (suppliedPassword.length !== configuredPassword.length || !timingSafeEqual(suppliedPassword, configuredPassword)) {
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
    const result = await pool.query(
      "SELECT * FROM task_posts WHERE status = 'approved' AND due_date >= CURRENT_DATE ORDER BY created_at DESC"
    );
    return res.json({ tasks: [...mockTasks, ...result.rows.map(asPublishedTask)] });
  }

  const publishedPosts = mockTaskPosts
    .filter((post) => post.status === 'approved' && new Date(`${post.due_date}T00:00:00.000Z`) >= new Date(new Date().toISOString().slice(0, 10)))
    .map(asPublishedTask);
  res.json({ tasks: [...mockTasks, ...publishedPosts] });
});

app.post('/api/task-posts', async (req, res) => {
  const validation = validateTaskPost(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const values = validation.value;
  let taskPost;

  if (databaseOnline) {
    const result = await pool.query(
      `INSERT INTO task_posts
        (poster_name, poster_email, title, category, description, task_url, proof_requirements,
         participant_limit, payout_kes, total_budget_kes, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [values.poster_name, values.poster_email, values.title, values.category, values.description,
        values.task_url, values.proof_requirements, values.participant_limit, values.payout_kes,
        values.total_budget_kes, values.due_date]
    );
    [taskPost] = result.rows;
  } else {
    taskPost = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  const submission = {
    id: `sub-${Date.now()}`,
    user_id: Number(req.user.sub),
    task_id: id,
    status: 'pending_review',
    proof_type: proofType,
    notes,
    image_url: imageUrl,
    created_at: new Date().toISOString(),
  };

  mockSubmissions.unshift(submission);

  return res.status(201).json({
    message: 'Task proof submitted successfully and moved to admin review.',
    submission,
  });
});

app.get('/api/user/dashboard', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.sub);
  const wallet = await loadWallet(req.user.sub);

  res.json({
    user: sanitizeUser(user),
    wallet,
    stats: {
      today: 420,
      weekly: 2890,
      tasksDone: 26,
      referrals: 11,
    },
    recentActivity: [
      'Survey completed and approved',
      'Referral bonus unlocked',
      'Streak reward increased',
      'Withdrawal request submitted',
    ],
  });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  res.json({
    usersOnline: 2480,
    payoutsPending: 164,
    taskApprovals: 932,
    fraudAlerts: 12,
    queue: mockSubmissions,
    revenue: 2400000,
  });
});

app.get('/api/admin/tasks', requireAuth, requireAdmin, (req, res) => {
  res.json({ tasks: mockSubmissions });
});

app.patch('/api/admin/tasks/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const submission = mockSubmissions.find((item) => item.id === req.params.id);

  if (!submission) {
    return res.status(404).json({ message: 'Submission not found.' });
  }

  submission.status = status || 'approved';
  return res.json({ message: 'Submission status updated.', submission });
});

app.post('/api/payouts/request', requireAuth, async (req, res) => {
  const { method, destination, amount } = req.body || {};
  const wallet = await loadWallet(req.user.sub);

  if (!wallet || Number(wallet.balance_kes) < Number(amount || 0)) {
    return res.status(400).json({ message: 'Insufficient available balance for this payout.' });
  }

  const payout = {
    id: `payout-${Date.now()}`,
    user_id: Number(req.user.sub),
    method,
    destination,
    amount_kes: Number(amount),
    status: 'pending_approval',
    created_at: new Date().toISOString(),
  };

  mockPayouts.unshift(payout);
  return res.status(201).json({ message: 'Payout request submitted to the admin queue.', payout });
});

app.get('/api/admin/payouts', requireAuth, requireAdmin, (req, res) => {
  res.json({ payouts: mockPayouts });
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
