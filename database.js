const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

const FIREBASE_URL = 'https://tnekqkd-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_PATH = process.env.VERCEL ? '/tmp/sudabang.db' : path.join(__dirname, 'sudabang.db');

const ALL_TABLES = [
  'users', 'teachers', 'students', 'school_groups', 'school_group_members',
  'attendance_school', 'school_announcements', 'school_albums', 'album_photos', 'student_warnings',
  'friends', 'blocks', 'posts', 'post_hearts', 'comments', 'comment_likes',
  'chat_rooms', 'chat_room_members', 'messages', 'message_reads',
  'dm_rooms', 'dm_messages', 'attendance', 'coin_transactions',
  'shop_items', 'user_inventory', 'notifications', 'reports', 'admin_logs',
  'heart_rewards', 'attendance_rewards', 'teacher_chat_rooms', 'teacher_messages',
  'polls', 'poll_options', 'poll_votes', 'fcm_tokens',
  'referral_codes', 'referral_uses', 'coupons', 'coupon_uses',
  'achievements', 'user_achievements', 'user_mission_progress',
  'event_banners', 'minigame_records', 'gallery_posts', 'gallery_photos',
  'level_rewards', 'user_titles', 'report_auto_actions'
];

class BetterSqlite3Compat {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._dirty = false;
  }

  prepare(sql) {
    const self = this;
    const db = this._db;
    return {
      run(...params) {
        db.run(sql, params);
        const lastId = db.exec('SELECT last_insert_rowid() as id')[0];
        const changes = db.getRowsModified();
        self._dirty = true;
        return { lastInsertRowid: lastId ? lastId.values[0][0] : 0, changes };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        const cols = stmt.getColumnNames();
        while (stmt.step()) {
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql)) {
      this._dirty = true;
    }
  }

  pragma(str) {
    try {
      this._db.run(`PRAGMA ${str}`);
    } catch (e) {}
  }

  save() {
    if (process.env.VERCEL) return;
    const data = this._db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function getTableColumns(db, tableName) {
  const results = db._db.exec(`PRAGMA table_info(${tableName})`);
  if (!results.length) return [];
  return results[0].values.map(row => row[1]);
}

function getAllRows(db, tableName) {
  try {
    return db.prepare(`SELECT * FROM ${tableName}`).all();
  } catch (e) {
    return [];
  }
}

async function saveToFirebase(db) {
  if (!db._dirty) return;
  try {
    const payload = {};
    for (const table of ALL_TABLES) {
      const rows = getAllRows(db, table);
      if (rows.length > 0) {
        payload[table] = {};
        for (const row of rows) {
          payload[table][`r_${row.id}`] = row;
        }
      } else {
        payload[table] = null;
      }
    }
    payload._meta = { updatedAt: new Date().toISOString(), tableCount: ALL_TABLES.length };

    const res = await fetch(`${FIREBASE_URL}/sudabang.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      db._dirty = false;
      console.log('[Firebase] 테이블별 데이터 저장 완료');
    } else {
      console.error('[Firebase] 저장 실패:', res.status);
    }
  } catch (e) {
    console.error('[Firebase] 저장 실패:', e.message);
    db.save();
  }
}

async function loadFromFirebase() {
  try {
    const res = await fetch(`${FIREBASE_URL}/sudabang.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && data._meta) {
        console.log('[Firebase] 테이블별 데이터 로드 완료');
        return data;
      }
    }
  } catch (e) {
    console.error('[Firebase] 로드 실패:', e.message);
  }
  return null;
}

function insertRowsFromFirebase(db, tableName, tableData) {
  if (!tableData || typeof tableData !== 'object') return;
  const rows = Object.values(tableData).filter(r => r && typeof r === 'object' && r.id !== undefined);
  if (rows.length === 0) return;

  const tableColumns = getTableColumns(db, tableName);
  if (tableColumns.length === 0) return;

  const placeholders = tableColumns.map(() => '?').join(', ');
  const colNames = tableColumns.join(', ');

  for (const row of rows) {
    try {
      const vals = tableColumns.map(c => row[c] === undefined ? null : row[c]);
      db._db.run(`INSERT OR REPLACE INTO ${tableName} (${colNames}) VALUES (${placeholders})`, vals);
    } catch (e) {}
  }

  try {
    const maxId = rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
    if (maxId > 0) {
      db._db.run(`UPDATE sqlite_sequence SET seq = ${maxId} WHERE name = '${tableName}'`);
    }
  } catch (e) {}
}

let db = null;
let saveInterval = null;

async function initDatabase() {
  let wasmBinary;
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  try {
    wasmBinary = fs.readFileSync(wasmPath);
  } catch (e) {
    console.error('[DB] WASM 파일 읽기 실패:', wasmPath, e.message);
  }

  const sqlOptions = wasmBinary
    ? { wasmBinary }
    : { locateFile: () => wasmPath };

  const SQL = await initSqlJs(sqlOptions);

  const sqlDb = new SQL.Database();
  db = new BetterSqlite3Compat(sqlDb);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT UNIQUE NOT NULL,
      profile_image TEXT DEFAULT '/default-avatar.png',
      profile_frame TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      title TEXT DEFAULT '',
      level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0,
      coins INTEGER DEFAULT 0,
      role TEXT DEFAULT 'user',
      theme TEXT DEFAULT 'light',
      is_online INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      ban_reason TEXT DEFAULT '',
      chat_restricted INTEGER DEFAULT 0,
      post_restricted INTEGER DEFAULT 0,
      comment_restricted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    school_name TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    warning_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS school_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    school_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS school_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'student',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES school_groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS attendance_school (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'absent',
    recorded_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (group_id) REFERENCES school_groups(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS school_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES school_groups(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS school_albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES school_groups(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS album_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    uploaded_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (album_id) REFERENCES school_albums(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS student_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT DEFAULT '',
    reported_to INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id),
    UNIQUE(user_id, friend_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id),
    UNIQUE(user_id, blocked_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    hearts INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    is_notice INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    heart_reward_given INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS post_hearts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(post_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS comment_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES comments(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(comment_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    announcement TEXT DEFAULT '',
    type TEXT DEFAULT 'public',
    password TEXT DEFAULT '',
    owner_id INTEGER NOT NULL,
    max_members INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS chat_room_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(room_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    reply_to INTEGER DEFAULT NULL,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS message_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(message_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS dm_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id),
    UNIQUE(user1_id, user2_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    is_read INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES dm_rooms(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, date)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS coin_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    is_equipped INTEGER DEFAULT 0,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES shop_items(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    detail TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id INTEGER DEFAULT 0,
    detail TEXT DEFAULT '',
    before_value TEXT DEFAULT '',
    after_value TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS heart_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    milestone INTEGER NOT NULL,
    rewarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    UNIQUE(post_id, milestone)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS attendance_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    milestone INTEGER NOT NULL,
    rewarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, milestone)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS teacher_chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS teacher_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES teacher_chat_rooms(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    creator_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    type TEXT DEFAULT 'poll',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id),
    FOREIGN KEY (creator_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    option_text TEXT NOT NULL,
    votes INTEGER DEFAULT 0,
    FOREIGN KEY (poll_id) REFERENCES polls(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS poll_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (poll_id) REFERENCES polls(id),
    FOREIGN KEY (option_id) REFERENCES poll_options(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(poll_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fcm_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, token)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS referral_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    reward_coins INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS referral_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (code_id) REFERENCES referral_codes(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(code_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    reward_coins INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS coupon_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(coupon_id, user_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '🏆',
    reward_coins INTEGER DEFAULT 0,
    condition_type TEXT NOT NULL,
    condition_value INTEGER DEFAULT 1
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (achievement_id) REFERENCES achievements(id),
    UNIQUE(user_id, achievement_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_mission_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mission_key TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    claimed INTEGER DEFAULT 0,
    mission_date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, mission_key, mission_date)
  )`);

  // 이벤트/공지 배너
  db.exec(`CREATE TABLE IF NOT EXISTS event_banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    link TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    starts_at DATETIME,
    ends_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 미니게임 기록
  db.exec(`CREATE TABLE IF NOT EXISTS minigame_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    bet_amount INTEGER DEFAULT 0,
    result TEXT NOT NULL,
    reward INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // 갤러리 게시글
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    hearts INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // 갤러리 사진
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gallery_id) REFERENCES gallery_posts(id)
  )`);

  // 레벨업 보상 기록
  db.exec(`CREATE TABLE IF NOT EXISTS level_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    reward_coins INTEGER DEFAULT 0,
    reward_title TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, level)
  )`);

  // 유저 칭호
  db.exec(`CREATE TABLE IF NOT EXISTS user_titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_equipped INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // 신고 자동 제재 기록
  db.exec(`CREATE TABLE IF NOT EXISTS report_auto_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    report_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  const firebaseData = await loadFromFirebase();
  if (firebaseData) {
    for (const table of ALL_TABLES) {
      if (firebaseData[table]) {
        insertRowsFromFirebase(db, table, firebaseData[table]);
      }
    }
    console.log('[Firebase] 모든 테이블 데이터 복원 완료');
  }

  const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin1234', 10);
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('ree1203');
  if (!adminExists) {
    db.prepare(`
      INSERT INTO users (username, password, nickname, role, level, coins)
      VALUES (?, ?, ?, 'admin', 99, 99999)
    `).run('ree1203', adminPassword, '개발자');
  } else {
    db.prepare('UPDATE users SET password = ?, role = ? WHERE username = ?').run(adminPassword, 'admin', 'ree1203');
  }

  const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM shop_items').get();
  if (itemCount.cnt === 0) {
    const items = [
      ['골드 프레임', '반짝이는 골드 프로필 프레임', '🖼️', 'frame', 100],
      ['실버 프레임', '깔끔한 실버 프로필 프레임', '🖼️', 'frame', 50],
      ['레인보우 프레임', '무지개빛 프로필 프레임', '🖼️', 'frame', 200],
      ['다이아 프레임', '다이아몬드 프로필 프레임', '🖼️', 'frame', 500],
      ['별빛 배경', '반짝이는 별빛 채팅 배경', '🌟', 'background', 80],
      ['바다 배경', '시원한 바다 채팅 배경', '🌊', 'background', 80],
      ['숲 배경', '편안한 숲 채팅 배경', '🌲', 'background', 80],
      ['우주 배경', '신비로운 우주 채팅 배경', '🚀', 'background', 150],
      ['굵은 닉네임', '닉네임을 굵게 표시', '✏️', 'nickname', 60],
      ['컬러 닉네임 - 빨강', '닉네임을 빨간색으로', '🔴', 'nickname', 100],
      ['컬러 닉네임 - 파랑', '닉네임을 파란색으로', '🔵', 'nickname', 100],
      ['컬러 닉네임 - 초록', '닉네임을 초록색으로', '🟢', 'nickname', 100],
      ['VIP 뱃지', '프로필에 VIP 뱃지 표시', '👑', 'badge', 300],
      ['스타 뱃지', '프로필에 스타 뱃지 표시', '⭐', 'badge', 200],
    ];
    for (const item of items) {
      db.prepare('INSERT INTO shop_items (name, description, image, category, price) VALUES (?, ?, ?, ?, ?)').run(...item);
    }
  }

  const achCount = db.prepare('SELECT COUNT(*) as cnt FROM achievements').get();
  if (achCount.cnt === 0) {
    const achs = [
      ['first_post', '첫 게시글', '첫 번째 게시글을 작성했어요!', '📝', 10, 'posts', 1],
      ['posts_10', '글쟁이', '게시글 10개를 작성했어요!', '✍️', 30, 'posts', 10],
      ['posts_50', '작가님', '게시글 50개를 작성했어요!', '📖', 100, 'posts', 50],
      ['first_comment', '첫 댓글', '첫 번째 댓글을 달았어요!', '💬', 5, 'comments', 1],
      ['comments_50', '수다쟁이', '댓글 50개를 달았어요!', '🗣️', 50, 'comments', 50],
      ['friends_5', '사교왕', '친구 5명을 만들었어요!', '🤝', 20, 'friends', 5],
      ['friends_10', '인싸', '친구 10명을 만들었어요!', '🌟', 50, 'friends', 10],
      ['friends_30', '인맥왕', '친구 30명을 만들었어요!', '👑', 150, 'friends', 30],
      ['attendance_7', '출석 7일', '7일 연속 출석했어요!', '📅', 30, 'attendance_streak', 7],
      ['attendance_30', '한 달 개근', '30일 연속 출석했어요!', '🔥', 100, 'attendance_streak', 30],
      ['attendance_100', '출석의 신', '100일 연속 출석했어요!', '💎', 500, 'attendance_streak', 100],
      ['level_5', '성장중', '레벨 5에 도달했어요!', '⬆️', 20, 'level', 5],
      ['level_10', '중수', '레벨 10에 도달했어요!', '🎯', 50, 'level', 10],
      ['level_30', '고수', '레벨 30에 도달했어요!', '🏅', 200, 'level', 30],
      ['hearts_10', '인기인', '하트를 10개 받았어요!', '❤️', 30, 'hearts_received', 10],
      ['hearts_50', '스타', '하트를 50개 받았어요!', '💖', 100, 'hearts_received', 50],
    ];
    for (const a of achs) {
      db.prepare('INSERT INTO achievements (key, name, description, icon, reward_coins, condition_type, condition_value) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...a);
    }
  }

  const roomCount = db.prepare('SELECT COUNT(*) as cnt FROM chat_rooms').get();
  if (roomCount.cnt === 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('ree1203');
    if (admin) {
      db.prepare(`
        INSERT INTO chat_rooms (name, description, type, owner_id)
        VALUES ('전체 채팅', '모든 사용자가 참여할 수 있는 전체 채팅방입니다.', 'public', ?)
      `).run(admin.id);
    }
  }

  db.pragma('foreign_keys = ON');

  db._dirty = true;
  await saveToFirebase(db);

  saveInterval = setInterval(() => {
    saveToFirebase(db).catch(() => {});
  }, 10000);

  process.on('SIGINT', async () => {
    await saveToFirebase(db);
    process.exit(0);
  });

  return db;
}

function getDb() {
  return db;
}

module.exports = { getDb, initDatabase, saveToFirebase };
