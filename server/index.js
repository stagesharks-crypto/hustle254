import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

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
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);
const EMAIL_VERIFICATION_TTL_MINUTES = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES || 10);
const STREAK_REWARD_USD = '0.023';
const STREAK_REWARD_KES = 2.94;
const STREAK_TIME_ZONE = 'Africa/Nairobi';
const USD_TO_KES = 128;
const MINIMUM_WITHDRAWAL_KES = USD_TO_KES;
const CPX_APP_ID = process.env.CPX_APP_ID || '';
const CPX_SURVEY_IFRAME_URL = process.env.CPX_SURVEY_IFRAME_URL || '';
const EMAIL_VERIFICATION_RESEND_SECONDS = 60;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const APP_URL = (process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:4173').replace(/\/$/, '');
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Hustle254 <noreply@hustle254.app>';
const GMAIL_RELAY_URL = process.env.GMAIL_RELAY_URL || '';
const GMAIL_RELAY_SECRET = process.env.GMAIL_RELAY_SECRET || '';
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
const mockUserStreaks = [];
const mockUserStreakCheckIns = [];
const mockStreakRewardClaims = [];
const mockTaskPosts = [];
const passwordResetTokens = new Map();
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
      'user_streaks',
      'user_streak_check_ins',
      'streak_reward_claims',
      'wallet_transactions',
      'wallet_ledger_entries',
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
      throw new Error(`Database schema is incomplete (missing: ${missingTables.join(', ')}). Apply db/schema.sql to a new database, or apply the required migrations to an existing database before starting the API.`);
    }
    const requiredColumns = {
      users: ['email_verified_at', 'email_verification_code_hash', 'email_verification_expires_at', 'email_verification_requested_at', 'email_verification_attempts', 'external_user_id', 'referred_by_user_id'],
      task_posts: ['poster_user_id'],
      task_submissions: ['task_post_id'],
      wallet_transactions: ['transaction_type', 'amount_kes', 'status', 'transaction_reference', 'destination', 'fee_amount_kes'],
      referrals: ['reward_type', 'reward_kes', 'qualifying_event_id', 'qualified_at', 'credited_at'],
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
      throw new Error(`Database schema is incomplete (missing columns: ${missingColumns.join(', ')}). Apply db/schema.sql to a new database, or apply the required migrations to an existing database before starting the API.`);
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
    console.warn(`Rejected CORS origin: ${origin}`);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

function generateToken(user) {
  const expiresIn = ['user', 'poster'].includes(user.role)
    ? getSecondsUntilNextNairobiMidnight()
    : '7d';
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn }
  );
}

function sanitizeUser(user) {
  const safeUser = { ...user };
  safeUser.external_user_id = safeUser.external_user_id || safeUser.id;
  delete safeUser.password_hash;
  delete safeUser.google_sub;
  delete safeUser.reset_token_hash;
  delete safeUser.reset_expires_at;
  delete safeUser.reset_requested_at;
  delete safeUser.reset_used_at;
  delete safeUser.email_verification_code_hash;
  delete safeUser.email_verification_expires_at;
  delete safeUser.email_verification_requested_at;
  delete safeUser.email_verification_attempts;
  return safeUser;
}

function generatePasswordResetToken() {
  return randomBytes(32).toString('hex');
}

function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function hashEmailVerificationCode(email, code) {
  return createHmac('sha256', JWT_SECRET).update(`${email}:${code}`).digest('hex');
}

function generateEmailVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function matchesEmailVerificationCode(email, code, storedHash) {
  if (!storedHash) return false;
  const suppliedHash = Buffer.from(hashEmailVerificationCode(email, code), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash);
}

async function setEmailVerificationCode(user, code) {
  const codeHash = hashEmailVerificationCode(user.email, code);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000).toISOString();

  if (databaseOnline) {
    const result = await pool.query(
      `UPDATE users
       SET email_verification_code_hash = $1,
           email_verification_expires_at = $2,
           email_verification_requested_at = NOW(),
           email_verification_attempts = 0
       WHERE id = $3
       RETURNING email_verification_requested_at`,
      [codeHash, expiresAt, user.id]
    );
    user.email_verification_code_hash = codeHash;
    user.email_verification_expires_at = expiresAt;
    user.email_verification_requested_at = result.rows[0]?.email_verification_requested_at || new Date().toISOString();
    user.email_verification_attempts = 0;
    return;
  }

  user.email_verification_code_hash = codeHash;
  user.email_verification_expires_at = expiresAt;
  user.email_verification_requested_at = new Date().toISOString();
  user.email_verification_attempts = 0;
}

async function sendEmailMessage({ to, subject, html }) {
  if (GMAIL_RELAY_URL && GMAIL_RELAY_SECRET) {
    const response = await fetch(GMAIL_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: GMAIL_RELAY_SECRET, to, subject, html }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.sent) {
      throw new Error(result?.message || `Gmail relay failed with HTTP ${response.status}.`);
    }
    return { sent: true };
  }

  if (!SMTP_USER || !SMTP_PASS) return { sent: false };

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
  return { sent: true };
}

async function sendEmailVerificationCode(toEmail, code) {
  return sendEmailMessage({
    to: toEmail,
    subject: 'Verify your Hustle254 email',
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 12px;">Confirm your email</h2>
        <p>Enter this one-time code in Hustle254 to finish creating your account:</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px;">${code}</p>
        <p>This code expires in ${EMAIL_VERIFICATION_TTL_MINUTES} minutes and can only be used once.</p>
        <p>If you did not create a Hustle254 account, you can ignore this email.</p>
      </div>
    `,
  });
}

function getResetLink(token) {
  return `${APP_URL}/?reset=${encodeURIComponent(token)}`;
}

async function sendPasswordResetEmail(toEmail, token) {
  const resetLink = getResetLink(token);
  return sendEmailMessage({
    to: toEmail,
    subject: 'Reset your Hustle254 password',
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 12px;">Reset your password</h2>
        <p>We received a request to reset the password for your Hustle254 account.</p>
        <p>Click the link below to set a new password. This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.</p>
        <p><a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">Reset password</a></p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p style="word-break:break-all;">${resetLink}</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

async function setUserResetToken(user, token) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

  if (databaseOnline) {
    await pool.query(
      `UPDATE users
       SET reset_token_hash = $1,
           reset_expires_at = $2,
           reset_requested_at = NOW(),
           reset_used_at = NULL
       WHERE id = $3`,
      [tokenHash, expiresAt, user.id]
    );
    return { hash: tokenHash, expiresAt, userId: user.id };
  }

  passwordResetTokens.set(String(user.id), { hash: tokenHash, expiresAt, userId: user.id, usedAt: null });
  return { hash: tokenHash, expiresAt, userId: user.id };
}

async function consumeUserResetToken(token) {
  const tokenHash = hashToken(token);

  if (databaseOnline) {
    const result = await pool.query(
      `SELECT * FROM users
       WHERE reset_token_hash = $1
         AND reset_expires_at IS NOT NULL
         AND reset_expires_at > NOW()
         AND reset_used_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  const record = [...passwordResetTokens.values()].find((entry) => entry.hash === tokenHash && entry.expiresAt && new Date(entry.expiresAt) > new Date() && !entry.usedAt);
  if (!record) return null;
  const user = await findUserById(record.userId);
  return user;
}

async function clearUserResetToken(userId) {
  if (databaseOnline) {
    await pool.query(
      `UPDATE users
       SET reset_token_hash = NULL,
           reset_expires_at = NULL,
           reset_requested_at = NULL,
           reset_used_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return;
  }

  const record = passwordResetTokens.get(String(userId));
  if (record) {
    record.usedAt = new Date().toISOString();
    record.hash = null;
    record.expiresAt = null;
  }
}

function getAuthToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function generateReferralCode() {
  return `H${randomBytes(6).toString('hex').toUpperCase()}`;
}

function normalizePhoneForComparison(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function hasMatchingPhone(left, right) {
  const normalizedLeft = normalizePhoneForComparison(left);
  const normalizedRight = normalizePhoneForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

async function createVerifiedReferral(connection, user) {
  if (!user.referred_by_user_id || !['user', 'poster'].includes(user.role)) return;

  await connection.query(
    `INSERT INTO referrals (referrer_id, referred_user_id, reward_type, reward_kes)
     SELECT referrer.id, referred.id,
            CASE referred.role WHEN 'poster' THEN 'poster' ELSE 'tasker' END,
            CASE referred.role WHEN 'poster' THEN 30 ELSE 5 END
     FROM users AS referred
     JOIN users AS referrer ON referrer.id = referred.referred_by_user_id
     WHERE referred.id = $1
       AND referred.id <> referrer.id
       AND referrer.role IN ('user', 'poster')
       AND referrer.status = 'active'
       AND referrer.email_verified_at IS NOT NULL
       AND LOWER(referrer.email) <> LOWER(referred.email)
       AND (referrer.phone IS NULL OR referred.phone IS NULL OR referrer.phone <> referred.phone)
     ON CONFLICT DO NOTHING`,
    [user.id]
  );
}

async function creditReferralReward(connection, referredUserId, rewardType) {
  const referralResult = await connection.query(
    `SELECT referrals.id, referrals.referrer_id, referrals.referred_user_id,
            referrals.reward_kes, referrals.created_at, referred.role
     FROM referrals
     JOIN users AS referred ON referred.id = referrals.referred_user_id
     WHERE referrals.referred_user_id = $1
       AND referrals.reward_type = $2
       AND referrals.status = 'pending'
     FOR UPDATE OF referrals`,
    [referredUserId, rewardType]
  );
  const referral = referralResult.rows[0];
  if (!referral) return false;

  let eventId;
  if (rewardType === 'tasker' && referral.role === 'user') {
    const submissionResult = await connection.query(
      `SELECT id FROM task_submissions
       WHERE user_id = $1 AND status = 'approved' AND created_at >= $2
       ORDER BY reviewed_at ASC NULLS LAST, created_at ASC
       LIMIT 1`,
      [referredUserId, referral.created_at]
    );
    eventId = submissionResult.rows[0]?.id;
  } else if (rewardType === 'poster' && referral.role === 'poster') {
    const taskPostResult = await connection.query(
      `SELECT id, total_budget_kes, created_at
       FROM task_posts
       WHERE poster_user_id = $1 AND status = 'approved' AND created_at >= $2
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [referredUserId, referral.created_at]
    );
    const firstApprovedPost = taskPostResult.rows[0];
    if (firstApprovedPost && Number(firstApprovedPost.total_budget_kes) > 0) {
      const depositResult = await connection.query(
        `SELECT COALESCE(SUM(amount_kes), 0) AS verified_deposits_kes
         FROM wallet_transactions
         WHERE user_id = $1 AND transaction_type = 'deposit' AND status = 'approved'`,
        [referredUserId]
      );
      if (Number(depositResult.rows[0].verified_deposits_kes) >= Number(firstApprovedPost.total_budget_kes)) {
        eventId = firstApprovedPost.id;
      }
    }
  }
  if (!eventId) return false;

  const walletResult = await connection.query(
    'SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE',
    [referral.referrer_id]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new Error('Referrer wallet is missing; the referral reward cannot be credited.');

  const amountKes = Number(referral.reward_kes);
  if (!Number.isFinite(amountKes) || amountKes <= 0) {
    throw new Error('Referral reward amount is invalid; the referral cannot be credited.');
  }
  const ledgerResult = await connection.query(
    `INSERT INTO wallet_ledger_entries
      (wallet_id, user_id, entry_type, amount_kes, source_type, source_id, description)
     VALUES ($1, $2, 'referral_reward', $3, 'referral_reward', $4, $5)
     ON CONFLICT (source_type, source_id) DO NOTHING
     RETURNING id`,
    [
      wallet.id,
      referral.referrer_id,
      amountKes,
      referral.id,
      `Verified ${rewardType} referral reward`,
    ]
  );
  if (!ledgerResult.rowCount) {
    throw new Error('Referral reward ledger entry already exists for an unpaid referral.');
  }

  await connection.query(
    'UPDATE wallets SET balance_kes = balance_kes + $2, updated_at = NOW() WHERE id = $1',
    [wallet.id, amountKes]
  );
  await connection.query(
    `UPDATE referrals
     SET status = 'paid', commission_kes = reward_kes, qualifying_event_id = $2,
         qualified_at = NOW(), credited_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [referral.id, String(eventId)]
  );
  return true;
}

async function creditMockReferralReward(referredUserId, rewardType) {
  const referral = mockReferrals.find((item) => (
    String(item.referred_user_id) === String(referredUserId)
    && item.reward_type === rewardType
    && item.status === 'pending'
  ));
  const referredUser = mockUsers.find((item) => String(item.id) === String(referredUserId));
  if (!referral || !referredUser) return false;

  let eventId;
  if (rewardType === 'tasker' && referredUser.role === 'user') {
    eventId = mockSubmissions.find((item) => (
      String(item.user_id) === String(referredUserId) && item.status === 'approved'
    ))?.id;
  } else if (rewardType === 'poster' && referredUser.role === 'poster') {
    const firstApprovedPost = mockTaskPosts
      .filter((item) => String(item.poster_user_id) === String(referredUserId) && item.status === 'approved')
      .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))[0];
    const verifiedDepositsKes = mockWalletTransactions
      .filter((item) => String(item.user_id) === String(referredUserId)
        && item.transaction_type === 'deposit' && item.status === 'approved')
      .reduce((total, item) => total + Number(item.amount_kes || 0), 0);
    if (firstApprovedPost && verifiedDepositsKes >= Number(firstApprovedPost.total_budget_kes)) {
      eventId = firstApprovedPost.id;
    }
  }
  if (!eventId) return false;

  const wallet = getMockWalletByUserId(referral.referrer_id);
  if (!wallet) throw new Error('Referrer wallet is missing; the referral reward cannot be credited.');
  const amountKes = Number(referral.reward_kes);
  if (!Number.isFinite(amountKes) || amountKes <= 0) {
    throw new Error('Referral reward amount is invalid; the referral cannot be credited.');
  }
  wallet.balance_kes = Number(wallet.balance_kes) + amountKes;
  referral.status = 'paid';
  referral.commission_kes = amountKes;
  referral.qualifying_event_id = String(eventId);
  referral.qualified_at = new Date().toISOString();
  referral.credited_at = referral.qualified_at;
  mockWalletTransactions.unshift({
    id: `referral-reward-${referral.id}`,
    user_id: referral.referrer_id,
    transaction_type: 'referral_reward',
    amount_kes: amountKes,
    status: 'approved',
    description: `Verified ${rewardType} referral reward`,
    created_at: referral.credited_at,
  });
  return true;
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

  if (
    ['user', 'poster'].includes(payload.role)
    && getNairobiDateKey(new Date(Number(payload.iat) * 1000)) !== getNairobiDateKey()
  ) {
    return res.status(401).json({ message: 'Your daily sign-in has expired. Please log in again.' });
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

function getNairobiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STREAK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function getCalendarDayDifference(previousDate, currentDate) {
  const toDayNumber = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  };
  return toDayNumber(currentDate) - toDayNumber(previousDate);
}

function getWithdrawalFeeKes(amountKes) {
  if (amountKes <= USD_TO_KES * 3) return 10;
  if (amountKes <= USD_TO_KES * 7) return 15;
  return 25;
}

function formatWithdrawalKes(amountKes) {
  return `KSh ${Number(amountKes).toLocaleString('en-KE')}`;
}

function getCpxSurveyUrl(user) {
  if (!CPX_APP_ID || !CPX_SURVEY_IFRAME_URL) return null;

  let surveyUrl;
  try {
    surveyUrl = new URL(CPX_SURVEY_IFRAME_URL);
  } catch {
    throw new Error('CPX_SURVEY_IFRAME_URL must be a valid HTTPS URL.');
  }
  if (
    surveyUrl.protocol !== 'https:'
    || !/(^|\.)cpx-research\.com$/i.test(surveyUrl.hostname)
  ) {
    throw new Error('CPX survey URL must use HTTPS on a cpx-research.com domain.');
  }
  surveyUrl.searchParams.set('app_id', CPX_APP_ID);
  surveyUrl.searchParams.set('ext_user_id', String(user.external_user_id));
  return surveyUrl.toString();
}

function calculateStreakStatistics(checkInDates, today) {
  const dates = [...new Set(checkInDates)].sort();
  let consecutiveDays = 0;
  let longestStreak = 0;
  let previousDate = null;

  for (const date of dates) {
    consecutiveDays = previousDate && getCalendarDayDifference(previousDate, date) === 1
      ? consecutiveDays + 1
      : 1;
    longestStreak = Math.max(longestStreak, consecutiveDays);
    previousDate = date;
  }

  const activeConsecutiveDays = previousDate === today ? consecutiveDays : 0;
  return {
    currentDays: activeConsecutiveDays ? ((activeConsecutiveDays - 1) % 7) + 1 : 0,
    longestStreak,
    totalCheckIns: dates.length,
  };
}

function getSecondsUntilNextNairobiMidnight(now = new Date()) {
  const today = getNairobiDateKey(now);
  let low = now.getTime();
  let high = low + 36 * 60 * 60 * 1000;

  while (getNairobiDateKey(new Date(high)) === today) {
    high += 12 * 60 * 60 * 1000;
  }

  while (high - low > 1000) {
    const midpoint = Math.floor((low + high) / 2);
    if (getNairobiDateKey(new Date(midpoint)) === today) low = midpoint;
    else high = midpoint;
  }

  return Math.max(1, Math.ceil((high - now.getTime()) / 1000));
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
  const emailTransport = GMAIL_RELAY_URL && GMAIL_RELAY_SECRET
    ? 'gmail_https_relay'
    : SMTP_USER && SMTP_PASS
      ? 'smtp'
      : 'not_configured';
  res.json({ status: 'ok', database: databaseOnline ? 'connected' : 'fallback', emailTransport });
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
    const referralCode = generateReferralCode();
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
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const submittedReferralCode = typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ message: 'Full name, email, phone, and password are required.' });
  }
  if (submittedReferralCode.length > 40) {
    return res.status(400).json({ message: 'Referral code is not valid.' });
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
  const nextReferralCode = generateReferralCode();
  let nextUser;
  let wallet;

  if (databaseOnline) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      let referrerId = null;
      if (submittedReferralCode) {
        const referrerResult = await connection.query(
          `SELECT id, role, status, email, phone, email_verified_at
           FROM users
           WHERE UPPER(referral_code) = $1
           FOR SHARE`,
          [submittedReferralCode]
        );
        const referrer = referrerResult.rows[0];
        if (
          !referrer
          || !['user', 'poster'].includes(referrer.role)
          || referrer.status !== 'active'
          || !referrer.email_verified_at
          || referrer.email.toLowerCase() === email
          || hasMatchingPhone(referrer.phone, phone)
        ) {
          await connection.query('ROLLBACK');
          return res.status(400).json({ message: 'Referral code is invalid or cannot be used for this account.' });
        }
        referrerId = referrer.id;
      }
      const userResult = await connection.query(
        `INSERT INTO users (full_name, email, phone, password_hash, referral_code, role, referred_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [fullName.trim(), email, phone.trim(), passwordHash, nextReferralCode, role, referrerId]
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
    const referrer = submittedReferralCode
      ? mockUsers.find((user) => String(user.referral_code).toUpperCase() === submittedReferralCode)
      : null;
    if (submittedReferralCode && (
      !referrer
      || !['user', 'poster'].includes(referrer.role)
      || referrer.status !== 'active'
      || !referrer.email_verified_at
      || referrer.email.toLowerCase() === email
      || hasMatchingPhone(referrer.phone, phone)
    )) {
      return res.status(400).json({ message: 'Referral code is invalid or cannot be used for this account.' });
    }
    nextUser = {
      id: Date.now(),
      full_name: fullName.trim(),
      email,
      phone: phone.trim(),
      password_hash: passwordHash,
      role,
      referral_code: nextReferralCode,
      referred_by_user_id: referrer?.id || null,
      status: 'active',
      is_verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    wallet = { id: Date.now() + 1, user_id: nextUser.id, balance_kes: 0, pending_kes: 0, withdrawn_kes: 0 };
    mockUsers.push(nextUser);
    mockWallets.push(wallet);
  }

  const verificationCode = generateEmailVerificationCode();
  await setEmailVerificationCode(nextUser, verificationCode);
  let delivery = { sent: false };
  try {
    delivery = await sendEmailVerificationCode(nextUser.email, verificationCode);
  } catch (error) {
    console.error(`Could not send verification email: ${error.message}`);
  }

  return res.status(201).json({
    verificationRequired: true,
    email: nextUser.email,
    message: delivery.sent
      ? `We sent a 6-digit verification code to ${nextUser.email}. It expires in ${EMAIL_VERIFICATION_TTL_MINUTES} minutes.`
      : 'Your account is created, but we could not send the code. Check the email settings, then use Resend code.',
    resendAfterSeconds: EMAIL_VERIFICATION_RESEND_SECONDS,
    ...(!delivery.sent && !isProduction ? { devVerificationCode: verificationCode } : {}),
  });
}

app.post('/api/auth/signup', (req, res) => registerUser(req, res));
app.post('/api/auth/poster-signup', (req, res) => registerUser(req, res, 'poster'));

app.post('/api/auth/verify-email', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!isValidEmailAddress(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the valid email address and 6-digit code.' });
  }

  const user = await findUserByIdentifier(email);
  if (!user || user.role === 'admin') {
    return res.status(400).json({ message: 'That code is invalid or expired. Request a new code and try again.' });
  }
  if (user.email_verified_at) {
    return res.status(400).json({ message: 'This email is already verified. Please log in.' });
  }
  if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at) <= new Date()) {
    return res.status(400).json({ message: 'That code has expired. Request a new code and try again.' });
  }
  if (Number(user.email_verification_attempts || 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many incorrect codes. Request a new code to continue.' });
  }

  if (!matchesEmailVerificationCode(email, code, user.email_verification_code_hash)) {
    if (databaseOnline) {
      await pool.query(
        `UPDATE users
         SET email_verification_attempts = email_verification_attempts + 1
         WHERE id = $1
           AND email_verification_expires_at > NOW()
           AND email_verification_attempts < $2`,
        [user.id, EMAIL_VERIFICATION_MAX_ATTEMPTS]
      );
    } else {
      user.email_verification_attempts = Number(user.email_verification_attempts || 0) + 1;
    }
    return res.status(400).json({ message: 'That code is incorrect. Check it and try again.' });
  }

  let verifiedUser = user;
  if (databaseOnline) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await connection.query(
        `UPDATE users
         SET email_verified_at = NOW(),
             email_verification_code_hash = NULL,
             email_verification_expires_at = NULL,
             email_verification_requested_at = NULL,
             email_verification_attempts = 0,
             updated_at = NOW()
         WHERE id = $1
           AND email_verification_code_hash = $2
           AND email_verification_expires_at > NOW()
           AND email_verification_attempts < $3
         RETURNING *`,
        [user.id, user.email_verification_code_hash, EMAIL_VERIFICATION_MAX_ATTEMPTS]
      );
      [verifiedUser] = result.rows;
      if (!verifiedUser) {
        await connection.query('ROLLBACK');
        return res.status(400).json({ message: 'That code is invalid or expired. Request a new code and try again.' });
      }
      await createVerifiedReferral(connection, verifiedUser);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  } else {
    verifiedUser.email_verified_at = new Date().toISOString();
    verifiedUser.email_verification_code_hash = null;
    verifiedUser.email_verification_expires_at = null;
    verifiedUser.email_verification_requested_at = null;
    verifiedUser.email_verification_attempts = 0;
    const referrer = mockUsers.find((item) => String(item.id) === String(verifiedUser.referred_by_user_id));
    if (
      referrer
      && ['user', 'poster'].includes(referrer.role)
      && referrer.status === 'active'
      && referrer.email_verified_at
      && !mockReferrals.some((item) => String(item.referred_user_id) === String(verifiedUser.id))
    ) {
      mockReferrals.push({
        id: `referral-${verifiedUser.id}`,
        referrer_id: referrer.id,
        referred_user_id: verifiedUser.id,
        full_name: verifiedUser.full_name,
        reward_type: verifiedUser.role === 'poster' ? 'poster' : 'tasker',
        reward_kes: verifiedUser.role === 'poster' ? 30 : 5,
        commission_kes: 0,
        status: 'pending',
        created_at: verifiedUser.email_verified_at,
      });
    }
  }

  return res.json({
    token: generateToken(verifiedUser),
    user: sanitizeUser(verifiedUser),
    wallet: await loadWallet(verifiedUser.id),
    message: 'Email verified. Your account is ready.',
  });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }

  const user = await findUserByIdentifier(email);
  if (!user || user.role === 'admin' || user.email_verified_at) {
    return res.json({ message: 'If that account needs verification, a code has been sent.' });
  }

  const requestedAt = user.email_verification_requested_at ? new Date(user.email_verification_requested_at).getTime() : 0;
  const elapsedSeconds = (Date.now() - requestedAt) / 1000;
  if (elapsedSeconds < EMAIL_VERIFICATION_RESEND_SECONDS) {
    return res.json({
      message: 'If that account needs verification, a code has been sent.',
      resendAfterSeconds: Math.ceil(EMAIL_VERIFICATION_RESEND_SECONDS - elapsedSeconds),
    });
  }

  const verificationCode = generateEmailVerificationCode();
  await setEmailVerificationCode(user, verificationCode);
  let delivery = { sent: false };
  try {
    delivery = await sendEmailVerificationCode(user.email, verificationCode);
  } catch (error) {
    console.error(`Could not send verification email: ${error.message}`);
  }

  return res.json({
    message: 'If that account needs verification, a code has been sent.',
    resendAfterSeconds: EMAIL_VERIFICATION_RESEND_SECONDS,
    ...(!delivery.sent && !isProduction ? { devVerificationCode: verificationCode } : {}),
  });
});

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
  if (['user', 'poster'].includes(user.role) && !user.email_verified_at) {
    return res.status(403).json({
      code: 'EMAIL_NOT_VERIFIED',
      email: user.email,
      resendAfterSeconds: Math.max(0, EMAIL_VERIFICATION_RESEND_SECONDS - Math.floor((Date.now() - new Date(user.email_verification_requested_at || 0).getTime()) / 1000)),
      message: 'Verify your email to finish setting up your account.',
    });
  }
  const wallet = await loadWallet(user.id);
  const token = generateToken(user);

  return res.json({
    token,
    user: sanitizeUser(user),
    wallet,
  });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const email = rawEmail.toLowerCase();

  if (!email || !isValidEmailAddress(email)) {
    return res.status(400).json({ message: 'Enter a valid email address to receive a reset link.' });
  }

  const user = await findUserByIdentifier(email);
  if (!user) {
    return res.json({ message: 'If an account with that email exists, we sent a reset link.' });
  }

  const token = generatePasswordResetToken();
  await setUserResetToken(user, token);
  const emailResult = await sendPasswordResetEmail(user.email, token);

  if (!emailResult.sent && !isProduction) {
    return res.json({
      message: 'If an account with that email exists, we sent a reset link.',
      devResetToken: token,
      resetLink: getResetLink(token),
    });
  }

  return res.json({ message: 'If an account with that email exists, we sent a reset link.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const rawToken = String(req.body?.token || '').trim();
  const rawPassword = String(req.body?.password || '');

  if (!rawToken) {
    return res.status(400).json({ message: 'A reset token is required. Use the link from your email.' });
  }

  if (rawPassword.length < 8) {
    return res.status(400).json({ message: 'Choose a password with at least 8 characters.' });
  }

  const user = await consumeUserResetToken(rawToken);
  if (!user) {
    return res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new password reset link.' });
  }

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  if (databaseOnline) {
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token_hash = NULL,
           reset_expires_at = NULL,
           reset_requested_at = NULL,
           reset_used_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, user.id]
    );
  } else {
    user.password_hash = passwordHash;
    user.updated_at = new Date().toISOString();
    await clearUserResetToken(user.id);
  }

  return res.json({ message: 'Your password has been updated successfully. You can now log in with your new password.' });
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
    message: 'Your job is in the review queue. It will appear in Tasks after approval.',
    taskPost,
  });
});

app.get('/api/poster/dashboard', requireAuth, requireRole('poster'), async (req, res) => {
  if (databaseOnline) {
    const user = await findUserById(req.user.sub);
    if (!user) return res.status(404).json({ message: 'Poster account not found.' });
    const posts = await pool.query(
      `SELECT task_posts.*,
              COALESCE(submission_counts.submissions_count, 0)::int AS submissions_count,
              COALESCE(submission_counts.pending_count, 0)::int AS pending_count,
              COALESCE(submission_counts.approved_count, 0)::int AS approved_count,
              COALESCE(submission_counts.rejected_count, 0)::int AS rejected_count
       FROM task_posts
       LEFT JOIN LATERAL (
         SELECT COUNT(task_submissions.id) AS submissions_count,
                COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'pending_review') AS pending_count,
                COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'approved') AS approved_count,
                COUNT(task_submissions.id) FILTER (WHERE task_submissions.status = 'rejected') AS rejected_count
         FROM task_submissions
         WHERE task_submissions.task_post_id = task_posts.id
       ) AS submission_counts ON TRUE
       WHERE task_posts.poster_user_id = $1
          OR (task_posts.poster_user_id IS NULL AND LOWER(task_posts.poster_email) = LOWER($2))
       ORDER BY task_posts.created_at DESC`,
      [req.user.sub, user.email || '']
    );
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
      'SELECT * FROM task_posts ORDER BY created_at DESC'
    );
    return res.json({ taskPosts: result.rows });
  }

  res.json({ taskPosts: mockTaskPosts });
});

app.delete('/api/admin/task-posts/:id', requireAuth, requireAdmin, async (req, res) => {
  let taskPost;
  if (databaseOnline) {
    const result = await pool.query(
      'DELETE FROM task_posts WHERE id = $1 RETURNING id, title',
      [req.params.id]
    );
    [taskPost] = result.rows;
  } else {
    const postIndex = mockTaskPosts.findIndex((post) => post.id === req.params.id);
    if (postIndex !== -1) {
      [taskPost] = mockTaskPosts.splice(postIndex, 1);
      for (let index = mockSubmissions.length - 1; index >= 0; index -= 1) {
        if (String(mockSubmissions[index].task_post_id) === String(taskPost.id)) {
          mockSubmissions.splice(index, 1);
        }
      }
    }
  }

  if (!taskPost) return res.status(404).json({ message: 'Task post not found.' });
  return res.json({ message: 'Task post deleted.', taskPost });
});

app.patch('/api/admin/task-posts/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved or rejected.' });
  }

  let taskPost;
  if (databaseOnline) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await connection.query(
        `UPDATE task_posts SET status = $2, reviewed_at = NOW()
         WHERE id = $1 AND status = 'pending_review' RETURNING *`,
        [req.params.id, status]
      );
      [taskPost] = result.rows;
      if (!taskPost) {
        await connection.query('ROLLBACK');
        return res.status(404).json({ message: 'Pending task post not found.' });
      }
      if (status === 'approved' && taskPost.poster_user_id) {
        await creditReferralReward(connection, taskPost.poster_user_id, 'poster');
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  } else {
    taskPost = mockTaskPosts.find((post) => post.id === req.params.id && post.status === 'pending_review');
    if (taskPost) {
      taskPost.status = status;
      taskPost.reviewed_at = new Date().toISOString();
      if (status === 'approved' && taskPost.poster_user_id) {
        await creditMockReferralReward(taskPost.poster_user_id, 'poster');
      }
    }
  }

  return res.json({ message: `Task post ${status}.`, taskPost });
});

app.post('/api/tasks/:id/submit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const rawBody = req.body || {};
  const notes = typeof rawBody.notes === 'string' ? rawBody.notes : (typeof rawBody.note === 'string' ? rawBody.note : '');
  const proofType = ['camera_capture', 'notes'].includes(rawBody.proofType)
    ? rawBody.proofType
    : (['camera_capture', 'notes'].includes(rawBody.proof_type) ? rawBody.proof_type : 'camera_capture');
  const imageUrl = typeof rawBody.imageUrl === 'string'
    ? rawBody.imageUrl
    : (typeof rawBody.image_data_url === 'string'
      ? rawBody.image_data_url
      : (typeof rawBody.imageDataUrl === 'string' ? rawBody.imageDataUrl : ''));

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
    try {
      const result = await pool.query(
        `INSERT INTO task_submissions (user_id, task_id, task_post_id, proof_type, notes, image_url, status)
         SELECT $1::uuid, tasks.id, NULL::uuid, $3::text, $4::text, $5::text, 'pending_review'
         FROM tasks WHERE tasks.id = $2::uuid AND tasks.active = TRUE
         UNION ALL
         SELECT $1::uuid, NULL::uuid, task_posts.id, $3::text, $4::text, $5::text, 'pending_review'
         FROM task_posts
         WHERE task_posts.id = $2::uuid AND task_posts.status = 'approved' AND task_posts.due_date >= CURRENT_DATE
         RETURNING *`,
        [req.user.sub, id, proofType, notes, imageUrl]
      );
      [submission] = result.rows;
    } catch (error) {
      console.error('Task proof submission failed.', {
        taskId: id,
        userId: req.user.sub,
        code: error.code,
        column: error.column,
        constraint: error.constraint,
      });
      if (error.code === '23502' && error.column === 'task_id') {
        return res.status(503).json({
          code: 'TASK_SUBMISSION_SCHEMA_OUTDATED',
          message: 'Task submissions are temporarily unavailable. The administrator must apply the task submission database migration, then try again.',
        });
      }
      return res.status(500).json({
        code: 'TASK_SUBMISSION_FAILED',
        message: 'We could not save your proof right now. Please try again shortly.',
      });
    }
  } else {
    const task = mockTaskPosts.find((item) => item.id === id && item.status === 'approved');
    if (task) {
      return res.status(400).json({ message: 'This task cannot accept submissions in development fallback mode.' });
    }
    const localSubmission = {
      id: `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: req.user.sub,
      task_id: id,
      task_post_id: null,
      proof_type: proofType,
      notes,
      image_url: imageUrl,
      status: 'pending_review',
      created_at: new Date().toISOString(),
      reviewed_at: null,
    };
    mockSubmissions.unshift(localSubmission);
    submission = localSubmission;
  }

  if (!submission) {
    return res.status(404).json({ message: 'Active database task not found.' });
  }

  return res.status(201).json({
    message: 'Task proof submitted successfully and moved to review.',
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

app.get('/api/surveys/config', requireAuth, async (req, res) => {
  if (!['user', 'poster'].includes(req.user.role)) {
    return res.status(403).json({ message: 'A user or poster account is required to access surveys.' });
  }
  const user = await findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: 'User account not found.' });
  const iframeUrl = getCpxSurveyUrl(user);
  return res.json({
    available: Boolean(iframeUrl),
    iframeUrl,
    externalUserId: String(user.external_user_id),
    currency: 'KES',
    message: iframeUrl ? undefined : 'Survey partner setup is not complete yet.',
  });
});

app.get('/api/wallet/transactions', requireAuth, async (req, res) => {
  if (databaseOnline) {
    const [result, ledger, totals] = await Promise.all([
      pool.query(
        `SELECT id, transaction_type, amount_kes, fee_amount_kes, status, payment_method,
                transaction_reference, destination, description, created_at, reviewed_at,
                NULL::text AS entry_type
         FROM wallet_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.sub]
      ),
      pool.query(
        `SELECT id, entry_type AS transaction_type, amount_kes, 0::numeric AS fee_amount_kes,
                'approved'::text AS status, NULL::text AS payment_method,
                NULL::text AS transaction_reference, NULL::text AS destination,
                description, created_at, NULL::timestamptz AS reviewed_at, entry_type
         FROM wallet_ledger_entries
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [req.user.sub]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'pending_review'), 0) AS pending_deposits_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'approved'), 0) AS approved_deposits_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'rejected'), 0) AS rejected_deposits_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'pending_review'), 0) AS pending_withdrawals_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'rejected'), 0) AS rejected_withdrawals_kes,
           COALESCE(SUM(amount_kes - fee_amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'approved'), 0) AS withdrawn_kes
         FROM wallet_transactions
         WHERE user_id = $1`,
        [req.user.sub]
      ),
    ]);
    const transactions = [...result.rows, ...ledger.rows]
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
      .slice(0, 100);
    return res.json({ transactions, summary: totals.rows[0] });
  }
  const userTransactions = mockWalletTransactions.filter((item) => String(item.user_id) === String(req.user.sub));
  const sumTransactions = (type, status) => userTransactions
    .filter((item) => item.transaction_type === type && item.status === status)
    .reduce((sum, item) => sum + Number(item.amount_kes || 0), 0);
  return res.json({
    transactions: userTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    summary: {
      pending_deposits_kes: sumTransactions('deposit', 'pending_review'),
      approved_deposits_kes: sumTransactions('deposit', 'approved'),
      rejected_deposits_kes: sumTransactions('deposit', 'rejected'),
      pending_withdrawals_kes: sumTransactions('withdrawal', 'pending_review'),
      rejected_withdrawals_kes: sumTransactions('withdrawal', 'rejected'),
      withdrawn_kes: userTransactions
        .filter((item) => item.transaction_type === 'withdrawal' && item.status === 'approved')
        .reduce((sum, item) => sum + Number(item.amount_kes || 0) - Number(item.fee_amount_kes || 0), 0),
    },
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
         VALUES ($1, $2, 'deposit', $3, 'pending_review', $4, $5, 'Poster deposit awaiting verification')
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
      message: 'Deposit reference submitted for verification.',
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
  return res.status(201).json({ message: 'Deposit reference submitted for verification.', transaction });
});

app.post('/api/wallet/withdrawals', requireAuth, async (req, res) => {
  if (!['user', 'poster'].includes(req.user.role)) {
    return res.status(403).json({ message: 'A user or poster account is required to request a withdrawal.' });
  }
  const amount = parseKesAmount(req.body?.amountKes);
  const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase();
  const destination = String(req.body?.destination || '').trim();
  if (!amount) return res.status(400).json({ message: 'Enter a valid withdrawal amount in KSh.' });
  if (amount < MINIMUM_WITHDRAWAL_KES) {
    return res.status(400).json({ message: `The minimum withdrawal is $1.00 (${formatWithdrawalKes(MINIMUM_WITHDRAWAL_KES)}).` });
  }
  const feeAmount = getWithdrawalFeeKes(amount);
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
        return res.status(400).json({ message: 'Only confirmed, eligible funds in your available balance can be requested for withdrawal.' });
      }
      const result = await connection.query(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, transaction_type, amount_kes, fee_amount_kes, status, payment_method, destination, description)
         VALUES ($1, $2, 'withdrawal', $3, $4, 'pending_review', $5, $6, 'Withdrawal request')
         RETURNING id, transaction_type, amount_kes, fee_amount_kes, status, payment_method, destination, created_at`,
        [wallet.id, req.user.sub, amount, feeAmount, paymentMethod, destination]
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
      message: 'Your withdrawal request has been submitted. The requested amount is reserved until it is completed or declined.',
      transaction,
    });
  }

  const wallet = getMockWalletByUserId(req.user.sub);
  if (!wallet) return res.status(409).json({ message: 'Your wallet record is unavailable. Contact support.' });
  if (Number(wallet.balance_kes) < amount) {
    return res.status(400).json({ message: 'Only confirmed, eligible funds in your available balance can be requested for withdrawal.' });
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
    fee_amount_kes: feeAmount,
    created_at: new Date().toISOString(),
  };
  mockWalletTransactions.unshift(transaction);
  return res.status(201).json({
    message: 'Your withdrawal request has been submitted. The requested amount is reserved until it is completed or declined.',
    transaction,
  });
});

app.post('/api/user/streak/check-in', requireAuth, async (req, res) => {
  if (!['user', 'poster'].includes(req.user.role)) {
    return res.status(403).json({ message: 'A user or poster account is required for daily streak rewards.' });
  }

  const today = getNairobiDateKey();
  let currentStreak;
  let rewardEarnedToday = false;

  if (databaseOnline) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO user_streaks (user_id, current_streak, last_login_date)
         VALUES ($1, 0, NULL)
         ON CONFLICT (user_id) DO NOTHING`,
        [req.user.sub]
      );
      await connection.query(
        `SELECT user_id
         FROM user_streaks
         WHERE user_id = $1
         FOR UPDATE`,
        [req.user.sub]
      );

      const todayCheckIn = await connection.query(
        `INSERT INTO user_streak_check_ins (user_id, check_in_date)
         VALUES ($1, $2)
         ON CONFLICT (user_id, check_in_date) DO NOTHING
         RETURNING check_in_date`,
        [req.user.sub, today]
      );
      const checkInResult = await connection.query(
        `SELECT TO_CHAR(check_in_date, 'YYYY-MM-DD') AS check_in_date
         FROM user_streak_check_ins
         WHERE user_id = $1 AND check_in_date <= $2
         ORDER BY check_in_date`,
        [req.user.sub, today]
      );
      const streakStatistics = calculateStreakStatistics(
        checkInResult.rows.map((row) => row.check_in_date),
        today
      );
      currentStreak = streakStatistics.currentDays;

      const existingClaim = await connection.query(
        'SELECT id FROM streak_reward_claims WHERE user_id = $1 AND streak_day = $2',
        [req.user.sub, today]
      );
      rewardEarnedToday = existingClaim.rowCount > 0;

      if (todayCheckIn.rowCount && currentStreak === 7) {
        const claim = await connection.query(
          `INSERT INTO streak_reward_claims (user_id, streak_day, reward_usd, amount_kes)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, streak_day) DO NOTHING
           RETURNING id`,
          [req.user.sub, today, STREAK_REWARD_USD, STREAK_REWARD_KES]
        );
        if (claim.rowCount) {
          const walletResult = await connection.query(
            'SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE',
            [req.user.sub]
          );
          const wallet = walletResult.rows[0];
          if (!wallet) throw new Error('Wallet record is missing for the streak reward.');
          const ledgerEntry = await connection.query(
            `INSERT INTO wallet_ledger_entries
              (wallet_id, user_id, entry_type, amount_kes, source_type, source_id, description)
             VALUES ($1, $2, 'streak_reward', $3, 'streak_reward_claim', $4, 'Seven-day login streak reward')
             ON CONFLICT (source_type, source_id) DO NOTHING
             RETURNING id`,
            [wallet.id, req.user.sub, STREAK_REWARD_KES, claim.rows[0].id]
          );
          if (!ledgerEntry.rowCount) throw new Error('The streak reward was already recorded in the wallet ledger.');
          const walletUpdate = await connection.query(
            `UPDATE wallets
             SET balance_kes = balance_kes + $2, updated_at = NOW()
             WHERE id = $1
             RETURNING balance_kes`,
            [wallet.id, STREAK_REWARD_KES]
          );
          if (!walletUpdate.rowCount) throw new Error('Wallet record is missing for the streak reward.');
          rewardEarnedToday = true;
        }
      }

      await connection.query(
        `UPDATE user_streaks
         SET current_streak = $2, last_login_date = $3, updated_at = NOW()
         WHERE user_id = $1`,
        [req.user.sub, currentStreak, today]
      );

      const [rewards, totals] = await Promise.all([
        connection.query(
          `SELECT reward_usd, amount_kes, streak_day, created_at
           FROM streak_reward_claims
           WHERE user_id = $1
           ORDER BY streak_day DESC
           LIMIT 20`,
          [req.user.sub]
        ),
        connection.query(
          `SELECT COUNT(*)::int AS reward_count,
                  COALESCE(SUM(amount_kes), 0) AS total_rewards_kes
           FROM streak_reward_claims
           WHERE user_id = $1`,
          [req.user.sub]
        ),
      ]);
      await connection.query('COMMIT');
      return res.json({
        streak: {
          currentDays: currentStreak,
          lastLoginDate: today,
          rewardEarnedToday,
          nextRewardInDays: currentStreak >= 7 ? 7 : 7 - currentStreak,
          rewardUsd: STREAK_REWARD_USD,
          rewardKes: STREAK_REWARD_KES,
          timezone: STREAK_TIME_ZONE,
          longestStreak: streakStatistics.longestStreak,
          totalCheckIns: streakStatistics.totalCheckIns,
          totalRewards: totals.rows[0].reward_count,
          totalRewardsKes: totals.rows[0].total_rewards_kes,
          rewards: rewards.rows,
        },
      });
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  let streak = mockUserStreaks.find((item) => String(item.user_id) === String(req.user.sub));
  if (!streak) {
    streak = { user_id: req.user.sub, current_streak: 0, last_login_date: null };
    mockUserStreaks.push(streak);
  }
  let todayCheckIn = mockUserStreakCheckIns.find(
    (checkIn) => String(checkIn.user_id) === String(req.user.sub) && checkIn.check_in_date === today
  );
  if (!todayCheckIn) {
    todayCheckIn = { user_id: req.user.sub, check_in_date: today };
    mockUserStreakCheckIns.push(todayCheckIn);
  }
  const userCheckInDates = mockUserStreakCheckIns
    .filter((checkIn) => String(checkIn.user_id) === String(req.user.sub))
    .map((checkIn) => checkIn.check_in_date);
  const streakStatistics = calculateStreakStatistics(userCheckInDates, today);
  currentStreak = streakStatistics.currentDays;
  streak.current_streak = currentStreak;
  streak.last_login_date = today;

  if (currentStreak === 7 && !mockStreakRewardClaims.some(
    (claim) => String(claim.user_id) === String(req.user.sub) && claim.streak_day === today
  )) {
    const wallet = getMockWalletByUserId(req.user.sub);
    if (!wallet) return res.status(409).json({ message: 'Your wallet record is unavailable. Contact support.' });
    wallet.balance_kes = Number(wallet.balance_kes) + STREAK_REWARD_KES;
    mockStreakRewardClaims.unshift({
      user_id: req.user.sub,
      streak_day: today,
      reward_usd: STREAK_REWARD_USD,
      amount_kes: STREAK_REWARD_KES,
      created_at: new Date().toISOString(),
    });
    rewardEarnedToday = true;
  } else {
    rewardEarnedToday = mockStreakRewardClaims.some(
      (claim) => String(claim.user_id) === String(req.user.sub) && claim.streak_day === today
    );
  }

  const userRewards = mockStreakRewardClaims.filter((claim) => String(claim.user_id) === String(req.user.sub));
  return res.json({
    streak: {
      currentDays: currentStreak,
      lastLoginDate: today,
      rewardEarnedToday,
      nextRewardInDays: currentStreak >= 7 ? 7 : 7 - currentStreak,
      rewardUsd: STREAK_REWARD_USD,
      rewardKes: STREAK_REWARD_KES,
      timezone: STREAK_TIME_ZONE,
      longestStreak: streakStatistics.longestStreak,
      totalCheckIns: streakStatistics.totalCheckIns,
      totalRewards: userRewards.length,
      totalRewardsKes: userRewards.reduce((sum, claim) => sum + Number(claim.amount_kes), 0),
      rewards: userRewards.slice(0, 20),
    },
  });
});

app.get('/api/user/referrals', requireAuth, async (req, res) => {
  if (databaseOnline) {
    const [user, referrals] = await Promise.all([
      findUserById(req.user.sub),
      pool.query(
        `SELECT referrals.id, users.full_name, referrals.reward_type,
                referrals.reward_kes, referrals.commission_kes,
                referrals.status, referrals.created_at, referrals.qualified_at, referrals.credited_at
         FROM referrals
         JOIN users ON users.id = referrals.referred_user_id
         WHERE referrals.referrer_id = $1
         ORDER BY referrals.created_at DESC`,
        [req.user.sub]
      ),
    ]);
    if (!user) return res.status(404).json({ message: 'User account not found.' });
    return res.json({
      referralCode: user.referral_code,
      referrals: referrals.rows,
      summary: {
        paidKes: referrals.rows.reduce((sum, item) => sum + Number(item.commission_kes || 0), 0),
        pendingKes: referrals.rows
          .filter((item) => item.status === 'pending')
          .reduce((sum, item) => sum + Number(item.reward_kes || 0), 0),
      },
    });
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
        reward_type: item.reward_type,
        reward_kes: item.reward_kes,
        commission_kes: item.commission_kes,
        status: item.status,
        created_at: item.created_at,
        qualified_at: item.qualified_at,
        credited_at: item.credited_at,
      })),
    summary: {
      paidKes: mockReferrals
        .filter((item) => String(item.referrer_id) === String(req.user.sub))
        .reduce((sum, item) => sum + Number(item.commission_kes || 0), 0),
      pendingKes: mockReferrals
        .filter((item) => String(item.referrer_id) === String(req.user.sub) && item.status === 'pending')
        .reduce((sum, item) => sum + Number(item.reward_kes || 0), 0),
    },
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
    const connection = await pool.connect();
    let submission;
    try {
      await connection.query('BEGIN');
      const submissionResult = await connection.query(
        `SELECT task_submissions.*,
                COALESCE(tasks.title, task_posts.title) AS task_title,
                COALESCE(tasks.payout_kes, task_posts.payout_kes) AS reward_kes
         FROM task_submissions
         LEFT JOIN tasks ON tasks.id = task_submissions.task_id
         LEFT JOIN task_posts ON task_posts.id = task_submissions.task_post_id
         WHERE task_submissions.id = $1 AND task_submissions.status = 'pending_review'
         FOR UPDATE OF task_submissions`,
        [req.params.id]
      );
      submission = submissionResult.rows[0];
      if (!submission) {
        await connection.query('ROLLBACK');
        return res.status(404).json({ message: 'Pending submission not found.' });
      }
      if (status === 'approved') {
        const amountKes = Number(submission.reward_kes);
        if (!Number.isFinite(amountKes) || amountKes <= 0) {
          throw new Error('The task has no valid reward amount; the submission cannot be approved.');
        }
        const walletResult = await connection.query(
          'SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE',
          [submission.user_id]
        );
        const wallet = walletResult.rows[0];
        if (!wallet) throw new Error('The user wallet is missing; the task reward cannot be credited.');
        const ledgerEntry = await connection.query(
          `INSERT INTO wallet_ledger_entries
            (wallet_id, user_id, entry_type, amount_kes, source_type, source_id, description)
           VALUES ($1, $2, 'task_reward', $3, 'task_submission', $4, $5)
           ON CONFLICT (source_type, source_id) DO NOTHING
           RETURNING id`,
          [wallet.id, submission.user_id, amountKes, submission.id, `Approved task reward: ${submission.task_title}`]
        );
        if (ledgerEntry.rowCount) {
          await connection.query(
            'UPDATE wallets SET balance_kes = balance_kes + $2, updated_at = NOW() WHERE id = $1',
            [wallet.id, amountKes]
          );
        }
      }
      const updated = await connection.query(
        `UPDATE task_submissions SET status = $2, reviewed_at = NOW()
         WHERE id = $1 AND status = 'pending_review' RETURNING *`,
        [req.params.id, status]
      );
      submission = updated.rows[0];
      if (status === 'approved') {
        await creditReferralReward(connection, submission.user_id, 'tasker');
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return res.json({
      message: status === 'approved'
        ? 'Submission approved and its reward has been credited to the wallet.'
        : 'Submission declined. No reward was credited.',
      submission,
    });
  }

  const submission = mockSubmissions.find((item) => item.id === req.params.id && item.status === 'pending_review');
  if (!submission) {
    return res.status(404).json({ message: 'Submission not found.' });
  }
  let rewardAmountKes = 0;
  let rewardWallet = null;
  if (status === 'approved') {
    rewardWallet = getMockWalletByUserId(submission.user_id);
    rewardAmountKes = Number(submission.payout_kes || submission.amount_kes || 0);
    if (!rewardWallet || !Number.isFinite(rewardAmountKes) || rewardAmountKes <= 0) {
      return res.status(409).json({ message: 'The task reward or wallet is unavailable; no reward was credited.' });
    }
  }
  submission.status = status;
  submission.reviewed_at = new Date().toISOString();
  if (status === 'approved') {
    rewardWallet.balance_kes = Number(rewardWallet.balance_kes) + rewardAmountKes;
    mockWalletTransactions.unshift({
      id: `task-reward-${submission.id}`,
      user_id: submission.user_id,
      transaction_type: 'task_reward',
      amount_kes: rewardAmountKes,
      status: 'approved',
      description: 'Approved task reward',
      created_at: new Date().toISOString(),
    });
    await creditMockReferralReward(submission.user_id, 'tasker');
  }
  return res.json({
    message: status === 'approved'
      ? 'Submission approved and its reward has been credited to the wallet.'
      : 'Submission declined. No reward was credited.',
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
    const [result, totals] = await Promise.all([
      pool.query(
        `SELECT wallet_transactions.id, wallet_transactions.user_id,
                users.full_name AS user_name, users.email AS user_email, users.role AS user_role,
                wallet_transactions.transaction_type, wallet_transactions.amount_kes,
               wallet_transactions.fee_amount_kes, wallet_transactions.status,
               wallet_transactions.payment_method,
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
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'approved'), 0) AS total_received_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'pending_review'), 0) AS pending_deposits_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'deposit' AND status = 'rejected'), 0) AS rejected_deposits_kes,
           COALESCE(SUM(amount_kes - fee_amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'approved'), 0) AS total_withdrawn_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'pending_review'), 0) AS pending_withdrawals_kes,
           COALESCE(SUM(amount_kes) FILTER (WHERE transaction_type = 'withdrawal' AND status = 'rejected'), 0) AS rejected_withdrawals_kes,
           COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_transactions_count,
           (SELECT COALESCE(SUM(balance_kes), 0) FROM wallets) AS available_balance_kes,
           (SELECT COALESCE(SUM(pending_kes), 0) FROM wallets) AS reserved_balance_kes,
           (SELECT COALESCE(SUM(withdrawn_kes), 0) FROM wallets) AS wallet_withdrawn_kes
         FROM wallet_transactions`
      ),
    ]);
    return res.json({ transactions: result.rows, summary: totals.rows[0] });
  }
  const sumTransactions = (type, status) => mockWalletTransactions
    .filter((item) => item.transaction_type === type && item.status === status)
    .reduce((sum, item) => sum + Number(item.amount_kes || 0), 0);
  return res.json({
    transactions: mockWalletTransactions.map((transaction) => ({
      ...transaction,
      user_name: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.full_name || 'Account unavailable',
      user_email: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.email || '',
      user_role: mockUsers.find((user) => String(user.id) === String(transaction.user_id))?.role || 'user',
    })),
    summary: {
      total_received_kes: sumTransactions('deposit', 'approved'),
      pending_deposits_kes: sumTransactions('deposit', 'pending_review'),
      rejected_deposits_kes: sumTransactions('deposit', 'rejected'),
      total_withdrawn_kes: mockWalletTransactions
        .filter((item) => item.transaction_type === 'withdrawal' && item.status === 'approved')
        .reduce((sum, item) => sum + Number(item.amount_kes || 0) - Number(item.fee_amount_kes || 0), 0),
      pending_withdrawals_kes: sumTransactions('withdrawal', 'pending_review'),
      rejected_withdrawals_kes: sumTransactions('withdrawal', 'rejected'),
      pending_transactions_count: mockWalletTransactions.filter((item) => item.status === 'pending_review').length,
      available_balance_kes: mockWallets.reduce((sum, wallet) => sum + Number(wallet.balance_kes || 0), 0),
      reserved_balance_kes: mockWallets.reduce((sum, wallet) => sum + Number(wallet.pending_kes || 0), 0),
      wallet_withdrawn_kes: mockWallets.reduce((sum, wallet) => sum + Number(wallet.withdrawn_kes || 0), 0),
    },
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
           SET pending_kes = pending_kes - $2,
               withdrawn_kes = withdrawn_kes + $2 - $3,
               updated_at = NOW()
           WHERE id = $1`,
          [transaction.wallet_id, transaction.amount_kes, transaction.fee_amount_kes]
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
                   fee_amount_kes, transaction_reference, destination, description, created_at, reviewed_at`,
        [req.params.id, status, req.user.sub]
      );
      [transaction] = updated.rows;
      if (transaction.transaction_type === 'deposit' && status === 'approved') {
        await creditReferralReward(connection, transaction.user_id, 'poster');
      }
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
        ? 'Deposit verified and credited to the wallet.'
        : transaction.transaction_type === 'withdrawal' && status === 'approved'
          ? 'Withdrawal request completed.'
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
    wallet.withdrawn_kes = Number(wallet.withdrawn_kes) + amount - Number(transaction.fee_amount_kes || 0);
  } else if (transaction.transaction_type === 'withdrawal' && status === 'rejected') {
    wallet.balance_kes = Number(wallet.balance_kes) + amount;
    wallet.pending_kes = Number(wallet.pending_kes) - amount;
  }
  transaction.status = status;
  transaction.reviewed_at = new Date().toISOString();
  transaction.reviewer_id = req.user.sub;
  if (transaction.transaction_type === 'deposit' && status === 'approved') {
    await creditMockReferralReward(transaction.user_id, 'poster');
  }
  return res.json({
    transaction,
    message: transaction.transaction_type === 'deposit' && status === 'approved'
      ? 'Deposit verified and credited to the wallet.'
      : transaction.transaction_type === 'withdrawal' && status === 'approved'
        ? 'Withdrawal request completed.'
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
