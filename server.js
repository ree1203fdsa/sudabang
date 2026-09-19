require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const { getDb, initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sudabang_secret';
const TEACHER_CODE = process.env.TEACHER_CODE || '19467346';

let db;

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).substr(2, 9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// 미들웨어
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: '너무 많은 로그인 시도입니다. 잠시 후 다시 시도해주세요.' } });

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// 욕설/일베 필터 단어 목록
const BAD_WORDS = [
  '시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '개새끼', '병신', 'ㅂㅅ', '지랄', 'ㅈㄹ',
  '꺼져', '죽어', '니애미', '느금마', '패드립', '일베', '한남충', '김치녀',
  '틀딱', '급식충', '맘충', '좆', 'ㅈ같', '엠창', '뒤지', '디져', '니미',
  '새끼', 'ㅅㄲ', '미친', 'ㅁㅊ', '닥쳐', 'ㄷㅊ', '개같', '멍청',
];

function containsBadWords(text) {
  const lower = text.toLowerCase();
  return BAD_WORDS.some(word => lower.includes(word));
}

function filterBadWords(text) {
  let filtered = text;
  for (const word of BAD_WORDS) {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '***');
  }
  return filtered;
}

// JWT 인증 미들웨어
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
    if (user.is_banned) return res.status(403).json({ error: '정지된 계정입니다.' });
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    next();
  });
}

function teacherAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ error: '선생님 권한이 필요합니다.' });
    next();
  });
}

// 레벨 체크 미들웨어
function levelCheck(minLevel) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (req.user.level < minLevel) return res.status(403).json({ error: `레벨 ${minLevel} 이상만 사용할 수 있습니다.` });
    next();
  };
}

// 경험치/레벨 업데이트 함수
function addExp(userId) {
  const user = db.prepare('SELECT exp, level FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const newExp = user.exp + 1;
  const newLevel = Math.floor(newExp / 5) + 1;
  db.prepare('UPDATE users SET exp = ?, level = ? WHERE id = ?').run(newExp, newLevel, userId);
  if (newLevel > user.level) {
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)').run(
      userId, 'level_up', '레벨 업!', `축하합니다! 레벨 ${newLevel}이 되었습니다!`
    );
  }
}

// 코인 지급 함수
function addCoins(userId, amount, reason) {
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, userId);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(userId, amount, reason);
  if (amount > 0) {
    db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)').run(
      userId, 'coin', '코인 획득', `+${amount} COIN - ${reason}`
    );
  }
}

// 알림 생성 함수
function createNotification(userId, type, title, message, link = '') {
  db.prepare('INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)').run(
    userId, type, title, message, link
  );
  io.to(`user_${userId}`).emit('notification', { type, title, message, link });
}

// ==================== AUTH API ====================

app.post('/api/auth/register', upload.single('profileImage'), (req, res) => {
  try {
    const { username, password, nickname, role, teacherCode } = req.body;

    if (!username || !password || !nickname) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: '아이디는 3~20자로 입력해주세요.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
    }
    if (nickname.length < 2 || nickname.length > 10) {
      return res.status(400).json({ error: '닉네임은 2~10자로 입력해주세요.' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });

    const existingNick = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
    if (existingNick) return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });

    // 선생님 계정 등록
    if (role === 'teacher') {
      if (teacherCode !== TEACHER_CODE) {
        return res.status(400).json({ error: '선생님 인증 코드가 올바르지 않습니다.' });
      }
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const profileImage = req.file ? `/uploads/${req.file.filename}` : '/default-avatar.png';
    const userRole = role === 'teacher' ? 'teacher' : 'user';

    const result = db.prepare(`
      INSERT INTO users (username, password, nickname, profile_image, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, hashedPassword, nickname, profileImage, userRole);

    // 선생님이면 teachers 테이블에도 추가
    if (role === 'teacher') {
      db.prepare('INSERT INTO teachers (user_id) VALUES (?)').run(result.lastInsertRowid);
    }

    // 전체 채팅방에 자동 참여
    const publicRoom = db.prepare("SELECT id FROM chat_rooms WHERE type = 'public' LIMIT 1").get();
    if (publicRoom) {
      db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id) VALUES (?, ?)').run(publicRoom.id, result.lastInsertRowid);
    }

    res.json({ message: '회원가입이 완료되었습니다!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
    if (user.is_banned) return res.status(403).json({ error: '정지된 계정입니다. 사유: ' + (user.ban_reason || '관리자에 의한 정지') });

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });

    db.prepare('UPDATE users SET is_online = 1, last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userData } = user;
    userData.is_online = 1;

    // 선생님인 경우 teacher 정보 추가
    if (user.role === 'teacher') {
      const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(user.id);
      userData.teacher = teacher;
    }

    res.json({ token, user: userData });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  const { password, ...userData } = req.user;
  if (req.user.role === 'teacher') {
    const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
    userData.teacher = teacher;
  }
  res.json({ user: userData });
});

// ==================== USER / PROFILE API ====================

app.get('/api/users/:id', auth, (req, res) => {
  const user = db.prepare(`
    SELECT id, username, nickname, profile_image, profile_frame, bio, level, exp, coins, role, is_online, created_at
    FROM users WHERE id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  const postCount = db.prepare('SELECT COUNT(*) as cnt FROM posts WHERE user_id = ? AND is_deleted = 0').get(user.id).cnt;
  const commentCount = db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE user_id = ? AND is_deleted = 0').get(user.id).cnt;
  const heartCount = db.prepare('SELECT COALESCE(SUM(hearts), 0) as cnt FROM posts WHERE user_id = ? AND is_deleted = 0').get(user.id).cnt;
  const friendCount = db.prepare("SELECT COUNT(*) as cnt FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'").get(user.id, user.id).cnt;
  const attendanceCount = db.prepare('SELECT COUNT(*) as cnt FROM attendance WHERE user_id = ?').get(user.id).cnt;

  user.stats = { postCount, commentCount, heartCount, friendCount, attendanceCount };
  res.json({ user });
});

app.put('/api/users/profile', auth, upload.single('profileImage'), (req, res) => {
  const { nickname, bio } = req.body;
  if (nickname && nickname !== req.user.nickname) {
    const existing = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(nickname, req.user.id);
    if (existing) return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
    if (nickname.length < 2 || nickname.length > 10) return res.status(400).json({ error: '닉네임은 2~10자로 입력해주세요.' });
  }

  const profileImage = req.file ? `/uploads/${req.file.filename}` : undefined;
  if (profileImage) {
    db.prepare('UPDATE users SET profile_image = ? WHERE id = ?').run(profileImage, req.user.id);
  }
  if (nickname) db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.user.id);
  if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);

  const updated = db.prepare('SELECT id, nickname, profile_image, bio FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
});

app.put('/api/users/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(currentPassword, req.user.password)) {
    return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  }
  if (newPassword.length < 4) return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  res.json({ message: '비밀번호가 변경되었습니다.' });
});

app.put('/api/users/theme', auth, (req, res) => {
  const { theme } = req.body;
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  res.json({ message: '테마가 변경되었습니다.' });
});

app.delete('/api/users/account', auth, (req, res) => {
  const { password } = req.body;
  if (!bcrypt.compareSync(password, req.user.password)) {
    return res.status(400).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ message: '회원 탈퇴가 완료되었습니다.' });
});

app.get('/api/users/search/:query', auth, (req, res) => {
  const users = db.prepare(`
    SELECT id, nickname, profile_image, level, is_online FROM users
    WHERE nickname LIKE ? AND id != ? AND is_banned = 0
    LIMIT 20
  `).all(`%${req.params.query}%`, req.user.id);
  res.json({ users });
});

// ==================== FRIENDS API ====================

app.get('/api/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.nickname, u.profile_image, u.level, u.is_online, f.status, f.id as friendship_id,
    CASE WHEN f.user_id = ? THEN 'sent' ELSE 'received' END as direction
    FROM friends f
    JOIN users u ON (CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END) = u.id
    WHERE (f.user_id = ? OR f.friend_id = ?)
    ORDER BY f.status ASC, u.is_online DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ friends });
});

app.post('/api/friends/request', auth, (req, res) => {
  const { targetId } = req.body;
  if (targetId === req.user.id) return res.status(400).json({ error: '자신에게 친구 요청을 보낼 수 없습니다.' });

  const blocked = db.prepare('SELECT id FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(req.user.id, targetId, targetId, req.user.id);
  if (blocked) return res.status(400).json({ error: '차단된 사용자입니다.' });

  const existing = db.prepare('SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(req.user.id, targetId, targetId, req.user.id);
  if (existing) return res.status(400).json({ error: '이미 친구 요청이 있습니다.' });

  db.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?)').run(req.user.id, targetId);
  createNotification(targetId, 'friend_request', '친구 요청', `${req.user.nickname}님이 친구 요청을 보냈습니다.`, '/friends');
  res.json({ message: '친구 요청을 보냈습니다.' });
});

app.put('/api/friends/accept/:id', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ?').get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: '친구 요청을 찾을 수 없습니다.' });
  db.prepare("UPDATE friends SET status = 'accepted' WHERE id = ?").run(req.params.id);
  createNotification(request.user_id, 'friend_accepted', '친구 수락', `${req.user.nickname}님이 친구 요청을 수락했습니다.`, '/friends');
  res.json({ message: '친구 요청을 수락했습니다.' });
});

app.put('/api/friends/reject/:id', auth, (req, res) => {
  db.prepare('DELETE FROM friends WHERE id = ? AND friend_id = ?').run(req.params.id, req.user.id);
  res.json({ message: '친구 요청을 거절했습니다.' });
});

app.delete('/api/friends/:id', auth, (req, res) => {
  db.prepare('DELETE FROM friends WHERE id = ? AND (user_id = ? OR friend_id = ?)').run(req.params.id, req.user.id, req.user.id);
  res.json({ message: '친구를 삭제했습니다.' });
});

// ==================== BLOCK API ====================

app.get('/api/blocks', auth, (req, res) => {
  const blocks = db.prepare(`
    SELECT b.id, u.id as user_id, u.nickname, u.profile_image
    FROM blocks b JOIN users u ON b.blocked_id = u.id
    WHERE b.user_id = ?
  `).all(req.user.id);
  res.json({ blocks });
});

app.post('/api/blocks', auth, (req, res) => {
  const { targetId } = req.body;
  if (targetId === req.user.id) return res.status(400).json({ error: '자신을 차단할 수 없습니다.' });
  try {
    db.prepare('INSERT INTO blocks (user_id, blocked_id) VALUES (?, ?)').run(req.user.id, targetId);
    db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, targetId, targetId, req.user.id);
    res.json({ message: '사용자를 차단했습니다.' });
  } catch (e) {
    res.status(400).json({ error: '이미 차단된 사용자입니다.' });
  }
});

app.delete('/api/blocks/:id', auth, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: '차단을 해제했습니다.' });
});

// ==================== POSTS API ====================

app.get('/api/posts', auth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  let query = `
    SELECT p.*, u.nickname, u.profile_image, u.level
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.is_deleted = 0
  `;
  const params = [];
  if (search) {
    query += ' AND (p.title LIKE ? OR p.content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const posts = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM posts WHERE is_deleted = 0 ${search ? 'AND (title LIKE ? OR content LIKE ?)' : ''}`).get(...(search ? [`%${search}%`, `%${search}%`] : [])).cnt;

  res.json({ posts, total, page, totalPages: Math.ceil(total / limit) });
});

app.get('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.nickname, u.profile_image, u.level
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.id = ? AND p.is_deleted = 0
  `).get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(req.params.id);
  post.views += 1;

  const hearted = db.prepare('SELECT id FROM post_hearts WHERE post_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  post.isHearted = !!hearted;

  const comments = db.prepare(`
    SELECT c.*, u.nickname, u.profile_image, u.level
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ? AND c.is_deleted = 0
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  for (const c of comments) {
    c.isLiked = !!db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(c.id, req.user.id);
  }

  res.json({ post, comments });
});

app.post('/api/posts', auth, (req, res) => {
  if (req.user.post_restricted) return res.status(403).json({ error: '게시글 작성이 제한되어 있습니다.' });

  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: '제목과 내용을 입력해주세요.' });

  // 도배 방지
  const recentPost = db.prepare('SELECT id FROM posts WHERE user_id = ? AND created_at > datetime("now", "-30 seconds")').get(req.user.id);
  if (recentPost) return res.status(429).json({ error: '게시글을 너무 빨리 작성하고 있습니다. 잠시 후 다시 시도해주세요.' });

  const filteredTitle = filterBadWords(title);
  const filteredContent = filterBadWords(content);

  const result = db.prepare('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)').run(req.user.id, filteredTitle, filteredContent);
  addExp(req.user.id);
  res.json({ message: '게시글이 작성되었습니다.', postId: result.lastInsertRowid });
});

app.put('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!post && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });

  const { title, content } = req.body;
  db.prepare('UPDATE posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    filterBadWords(title), filterBadWords(content), req.params.id
  );
  res.json({ message: '게시글이 수정되었습니다.' });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
  if (post.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });

  db.prepare('UPDATE posts SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: '게시글이 삭제되었습니다.' });
});

// 하트
app.post('/api/posts/:id/heart', auth, (req, res) => {
  const postId = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM post_hearts WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  if (existing) {
    db.prepare('DELETE FROM post_hearts WHERE id = ?').run(existing.id);
    db.prepare('UPDATE posts SET hearts = hearts - 1 WHERE id = ?').run(postId);
    const post = db.prepare('SELECT hearts FROM posts WHERE id = ?').get(postId);
    return res.json({ hearted: false, hearts: post.hearts });
  }

  db.prepare('INSERT INTO post_hearts (post_id, user_id) VALUES (?, ?)').run(postId, req.user.id);
  db.prepare('UPDATE posts SET hearts = hearts + 1 WHERE id = ?').run(postId);

  const post = db.prepare('SELECT hearts, user_id FROM posts WHERE id = ?').get(postId);

  // 하트 보상 체크 (5개마다 30코인)
  const milestone = Math.floor(post.hearts / 5) * 5;
  if (milestone > 0 && post.hearts >= milestone) {
    const alreadyRewarded = db.prepare('SELECT id FROM heart_rewards WHERE post_id = ? AND milestone = ?').get(postId, milestone);
    if (!alreadyRewarded) {
      db.prepare('INSERT INTO heart_rewards (post_id, milestone) VALUES (?, ?)').run(postId, milestone);
      addCoins(post.user_id, 30, '게시글 하트 보상');
    }
  }

  if (post.user_id !== req.user.id) {
    createNotification(post.user_id, 'heart', '하트', `${req.user.nickname}님이 게시글에 ❤️를 눌렀습니다.`, `/post/${postId}`);
  }

  res.json({ hearted: true, hearts: post.hearts });
});

// ==================== COMMENTS API ====================

app.post('/api/posts/:id/comments', auth, (req, res) => {
  if (req.user.comment_restricted) return res.status(403).json({ error: '댓글 작성이 제한되어 있습니다.' });

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });

  const recentComment = db.prepare('SELECT id FROM comments WHERE user_id = ? AND created_at > datetime("now", "-10 seconds")').get(req.user.id);
  if (recentComment) return res.status(429).json({ error: '댓글을 너무 빨리 작성하고 있습니다.' });

  const filteredContent = filterBadWords(content);
  const result = db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, filteredContent);
  db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(req.params.id);
  addExp(req.user.id);

  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (post && post.user_id !== req.user.id) {
    createNotification(post.user_id, 'comment', '새 댓글', `${req.user.nickname}님이 댓글을 남겼습니다.`, `/post/${req.params.id}`);
  }

  const comment = db.prepare(`
    SELECT c.*, u.nickname, u.profile_image, u.level
    FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.json({ comment });
});

app.put('/api/comments/:id', auth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!comment && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });

  db.prepare('UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filterBadWords(req.body.content), req.params.id);
  res.json({ message: '댓글이 수정되었습니다.' });
});

app.delete('/api/comments/:id', auth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
  if (comment.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });

  db.prepare('UPDATE comments SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').run(comment.post_id);
  res.json({ message: '댓글이 삭제되었습니다.' });
});

app.post('/api/comments/:id/like', auth, (req, res) => {
  const existing = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE comments SET likes = MAX(0, likes - 1) WHERE id = ?').run(req.params.id);
    const comment = db.prepare('SELECT likes FROM comments WHERE id = ?').get(req.params.id);
    return res.json({ liked: false, likes: comment.likes });
  }
  db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  db.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(req.params.id);
  const comment = db.prepare('SELECT likes FROM comments WHERE id = ?').get(req.params.id);
  res.json({ liked: true, likes: comment.likes });
});

// ==================== RANKING API ====================

app.get('/api/ranking/posts', auth, (req, res) => {
  const type = req.query.type || 'hearts';
  let orderBy;
  switch (type) {
    case 'hearts': orderBy = 'p.hearts DESC'; break;
    case 'comments': orderBy = 'p.comment_count DESC'; break;
    case 'views': orderBy = 'p.views DESC'; break;
    default: orderBy = 'p.hearts DESC';
  }
  const posts = db.prepare(`
    SELECT p.*, u.nickname, u.profile_image, u.level
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.is_deleted = 0
    ORDER BY ${orderBy}
    LIMIT 50
  `).all();
  res.json({ posts });
});

app.get('/api/ranking/users', auth, (req, res) => {
  const users = db.prepare(`
    SELECT id, nickname, profile_image, level, exp, coins
    FROM users WHERE is_banned = 0 AND role != 'admin'
    ORDER BY level DESC, exp DESC
    LIMIT 50
  `).all();
  res.json({ users });
});

// ==================== ATTENDANCE API ====================

app.get('/api/attendance', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const todayAttendance = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);
  const totalDays = db.prepare('SELECT COUNT(*) as cnt FROM attendance WHERE user_id = ?').get(req.user.id).cnt;

  // 연속 출석 계산
  let streak = 0;
  const records = db.prepare('SELECT date FROM attendance WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
  if (records.length > 0) {
    const d = new Date(today);
    for (const r of records) {
      const rd = new Date(r.date);
      const diff = Math.floor((d - rd) / (1000 * 60 * 60 * 24));
      if (diff <= 1) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    if (!todayAttendance && streak > 0) {
      const lastDate = new Date(records[0].date);
      const diffFromToday = Math.floor((new Date(today) - lastDate) / (1000 * 60 * 60 * 24));
      if (diffFromToday > 1) streak = 0;
    }
  }

  const calendar = db.prepare('SELECT date FROM attendance WHERE user_id = ? ORDER BY date DESC LIMIT 365').all(req.user.id);

  res.json({
    checked: !!todayAttendance,
    totalDays,
    streak,
    calendar: calendar.map(c => c.date)
  });
});

app.post('/api/attendance', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);
  if (existing) return res.status(400).json({ error: '오늘은 이미 출석했습니다.' });

  db.prepare('INSERT INTO attendance (user_id, date) VALUES (?, ?)').run(req.user.id, today);

  // 연속 출석 체크
  const records = db.prepare('SELECT date FROM attendance WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
  let streak = 0;
  const d = new Date(today);
  for (const r of records) {
    const rd = new Date(r.date);
    const diff = Math.floor((d - rd) / (1000 * 60 * 60 * 24));
    if (diff <= 1) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }

  // 10일 연속 보상
  const milestone = Math.floor(streak / 10) * 10;
  if (milestone > 0 && streak >= milestone) {
    const alreadyRewarded = db.prepare('SELECT id FROM attendance_rewards WHERE user_id = ? AND milestone = ?').get(req.user.id, milestone);
    if (!alreadyRewarded) {
      db.prepare('INSERT INTO attendance_rewards (user_id, milestone) VALUES (?, ?)').run(req.user.id, milestone);
      addCoins(req.user.id, 100, `${milestone}일 연속 출석 보상`);
    }
  }

  res.json({ message: '출석 완료!', streak, totalDays: records.length });
});

// ==================== COINS API ====================

app.get('/api/coins', auth, (req, res) => {
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);
  const transactions = db.prepare('SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ coins: user.coins, transactions });
});

// ==================== SHOP API ====================

app.get('/api/shop', auth, (req, res) => {
  const items = db.prepare('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY category, price ASC').all();
  const inventory = db.prepare('SELECT item_id FROM user_inventory WHERE user_id = ?').all(req.user.id).map(i => i.item_id);
  res.json({ items, inventory });
});

app.post('/api/shop/buy/:id', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '아이템을 찾을 수 없습니다.' });

  const owned = db.prepare('SELECT id FROM user_inventory WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id);
  if (owned) return res.status(400).json({ error: '이미 보유한 아이템입니다.' });

  if (req.user.coins < item.price) return res.status(400).json({ error: '코인이 부족합니다.' });

  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(item.price, req.user.id);
  db.prepare('INSERT INTO user_inventory (user_id, item_id) VALUES (?, ?)').run(req.user.id, item.id);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(req.user.id, -item.price, `상점 구매: ${item.name}`);

  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);
  res.json({ message: '구매 완료!', coins: user.coins });
});

app.get('/api/inventory', auth, (req, res) => {
  const items = db.prepare(`
    SELECT ui.*, si.name, si.description, si.image, si.category, si.price
    FROM user_inventory ui JOIN shop_items si ON ui.item_id = si.id
    WHERE ui.user_id = ?
  `).all(req.user.id);
  res.json({ items });
});

app.post('/api/inventory/equip/:id', auth, (req, res) => {
  const inv = db.prepare('SELECT * FROM user_inventory WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!inv) return res.status(404).json({ error: '아이템을 찾을 수 없습니다.' });

  const item = db.prepare('SELECT category FROM shop_items WHERE id = ?').get(inv.item_id);
  db.prepare(`UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = ?)`).run(req.user.id, item.category);
  db.prepare('UPDATE user_inventory SET is_equipped = 1 WHERE id = ?').run(inv.id);

  if (item.category === 'frame') {
    const shopItem = db.prepare('SELECT name FROM shop_items WHERE id = ?').get(inv.item_id);
    db.prepare('UPDATE users SET profile_frame = ? WHERE id = ?').run(shopItem.name, req.user.id);
  }

  res.json({ message: '아이템을 장착했습니다.' });
});

// ==================== CHAT ROOMS (수다방) API ====================

app.get('/api/rooms', auth, (req, res) => {
  const rooms = db.prepare(`
    SELECT cr.*, u.nickname as owner_name,
    (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id) as member_count
    FROM chat_rooms cr JOIN users u ON cr.owner_id = u.id
    WHERE cr.is_active = 1
    ORDER BY cr.created_at DESC
  `).all();
  res.json({ rooms });
});

app.get('/api/rooms/my', auth, (req, res) => {
  const rooms = db.prepare(`
    SELECT cr.*, u.nickname as owner_name,
    (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id) as member_count
    FROM chat_rooms cr
    JOIN chat_room_members crm ON cr.id = crm.room_id
    JOIN users u ON cr.owner_id = u.id
    WHERE crm.user_id = ? AND cr.is_active = 1
    ORDER BY cr.created_at DESC
  `).all(req.user.id);
  res.json({ rooms });
});

app.post('/api/rooms', auth, levelCheck(19), (req, res) => {
  const { name, description, type, password, image } = req.body;
  if (!name) return res.status(400).json({ error: '방 이름을 입력해주세요.' });

  if (req.user.role !== 'admin') {
    if (req.user.coins < 10) return res.status(400).json({ error: '코인이 부족합니다. (필요: 10코인)' });
    addCoins(req.user.id, -10, '수다방 생성');
  }

  let roomPassword = '';
  if (type === 'password') {
    roomPassword = password || Math.random().toString(36).substr(2, 8);
  }

  const result = db.prepare('INSERT INTO chat_rooms (name, description, type, password, image, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, description || '', type || 'public', roomPassword ? bcrypt.hashSync(roomPassword, 10) : '', image || '', req.user.id
  );
  db.prepare('INSERT INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, req.user.id, 'owner');

  res.json({
    message: '수다방이 만들어졌습니다!',
    roomId: result.lastInsertRowid,
    password: type === 'password' ? roomPassword : undefined
  });
});

app.post('/api/rooms/:id/join', auth, (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!room) return res.status(404).json({ error: '수다방을 찾을 수 없습니다.' });

  const existing = db.prepare('SELECT id FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(room.id, req.user.id);
  if (existing) return res.status(400).json({ error: '이미 참여 중입니다.' });

  if (room.type === 'private') return res.status(403).json({ error: '비공개 수다방입니다. 초대가 필요합니다.' });

  if (room.type === 'password') {
    const { password } = req.body;
    if (!password || !bcrypt.compareSync(password, room.password)) {
      return res.status(403).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
  }

  db.prepare('INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)').run(room.id, req.user.id);
  res.json({ message: '수다방에 참여했습니다!' });
});

app.post('/api/rooms/:id/invite', auth, (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '수다방을 찾을 수 없습니다.' });

  const member = db.prepare("SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ? AND role IN ('owner', 'admin')").get(room.id, req.user.id);
  if (!member && req.user.role !== 'admin') return res.status(403).json({ error: '초대 권한이 없습니다.' });

  const { targetId } = req.body;
  const existing = db.prepare('SELECT id FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(room.id, targetId);
  if (existing) return res.status(400).json({ error: '이미 참여 중인 사용자입니다.' });

  db.prepare('INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)').run(room.id, targetId);
  createNotification(targetId, 'invite', '수다방 초대', `${req.user.nickname}님이 "${room.name}" 수다방에 초대했습니다.`, `/room/${room.id}`);
  res.json({ message: '초대했습니다.' });
});

app.post('/api/rooms/:id/leave', auth, (req, res) => {
  db.prepare('DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: '수다방에서 나갔습니다.' });
});

// ==================== DM API ====================

app.get('/api/dm', auth, (req, res) => {
  const rooms = db.prepare(`
    SELECT dr.*,
    CASE WHEN dr.user1_id = ? THEN u2.id ELSE u1.id END as partner_id,
    CASE WHEN dr.user1_id = ? THEN u2.nickname ELSE u1.nickname END as partner_name,
    CASE WHEN dr.user1_id = ? THEN u2.profile_image ELSE u1.profile_image END as partner_image,
    CASE WHEN dr.user1_id = ? THEN u2.is_online ELSE u1.is_online END as partner_online,
    (SELECT content FROM dm_messages WHERE room_id = dr.id ORDER BY created_at DESC LIMIT 1) as last_message,
    (SELECT created_at FROM dm_messages WHERE room_id = dr.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
    (SELECT COUNT(*) FROM dm_messages WHERE room_id = dr.id AND sender_id != ? AND is_read = 0) as unread_count
    FROM dm_rooms dr
    JOIN users u1 ON dr.user1_id = u1.id
    JOIN users u2 ON dr.user2_id = u2.id
    WHERE dr.user1_id = ? OR dr.user2_id = ?
    ORDER BY last_message_time DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ rooms });
});

app.post('/api/dm/start', auth, (req, res) => {
  const { targetId } = req.body;
  if (targetId === req.user.id) return res.status(400).json({ error: '자신에게 메시지를 보낼 수 없습니다.' });

  const blocked = db.prepare('SELECT id FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(req.user.id, targetId, targetId, req.user.id);
  if (blocked) return res.status(403).json({ error: '차단된 사용자입니다.' });

  const [uid1, uid2] = [Math.min(req.user.id, targetId), Math.max(req.user.id, targetId)];
  let room = db.prepare('SELECT * FROM dm_rooms WHERE user1_id = ? AND user2_id = ?').get(uid1, uid2);
  if (!room) {
    const result = db.prepare('INSERT INTO dm_rooms (user1_id, user2_id) VALUES (?, ?)').run(uid1, uid2);
    room = { id: result.lastInsertRowid, user1_id: uid1, user2_id: uid2 };
  }
  res.json({ room });
});

app.get('/api/dm/:roomId/messages', auth, (req, res) => {
  const room = db.prepare('SELECT * FROM dm_rooms WHERE id = ?').get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
  if (room.user1_id !== req.user.id && room.user2_id !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });

  db.prepare('UPDATE dm_messages SET is_read = 1 WHERE room_id = ? AND sender_id != ? AND is_read = 0').run(room.id, req.user.id);

  const messages = db.prepare(`
    SELECT dm.*, u.nickname, u.profile_image
    FROM dm_messages dm JOIN users u ON dm.sender_id = u.id
    WHERE dm.room_id = ? AND dm.is_deleted = 0
    ORDER BY dm.created_at ASC
    LIMIT 200
  `).all(req.params.roomId);
  res.json({ messages });
});

// ==================== NOTIFICATIONS API ====================

app.get('/api/notifications', auth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  const unreadCount = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).cnt;
  res.json({ notifications, unreadCount });
});

app.put('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: '모든 알림을 읽음 처리했습니다.' });
});

app.put('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: '알림을 읽음 처리했습니다.' });
});

// ==================== REPORTS API ====================

app.post('/api/reports', auth, (req, res) => {
  const { targetType, targetId, reason, detail } = req.body;
  if (!targetType || !targetId || !reason) return res.status(400).json({ error: '신고 정보를 입력해주세요.' });

  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, targetType, targetId, reason, detail || ''
  );
  res.json({ message: '신고가 접수되었습니다.' });
});

// ==================== SEARCH API ====================

app.get('/api/search', auth, (req, res) => {
  const { q, type } = req.query;
  if (!q) return res.json({ users: [], posts: [], rooms: [] });

  const results = {};
  if (!type || type === 'users') {
    results.users = db.prepare('SELECT id, nickname, profile_image, level, is_online FROM users WHERE nickname LIKE ? AND is_banned = 0 LIMIT 10').all(`%${q}%`);
  }
  if (!type || type === 'posts') {
    results.posts = db.prepare(`
      SELECT p.id, p.title, p.content, p.hearts, p.comment_count, p.views, p.created_at, u.nickname
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.is_deleted = 0 AND (p.title LIKE ? OR p.content LIKE ?)
      LIMIT 10
    `).all(`%${q}%`, `%${q}%`);
  }
  if (!type || type === 'rooms') {
    results.rooms = db.prepare(`
      SELECT id, name, description, type, (SELECT COUNT(*) FROM chat_room_members WHERE room_id = chat_rooms.id) as member_count
      FROM chat_rooms WHERE is_active = 1 AND name LIKE ? AND type != 'private'
      LIMIT 10
    `).all(`%${q}%`);
  }
  res.json(results);
});

// ==================== TEACHER API ====================

app.post('/api/teacher/create-student', teacherAuth, (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: '모든 필드를 입력해주세요.' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });

  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  if (!teacher) return res.status(400).json({ error: '선생님 정보를 찾을 수 없습니다.' });

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, 'student')
  `).run(username, hashedPassword, name);

  db.prepare('INSERT INTO students (user_id, teacher_id, name) VALUES (?, ?, ?)').run(result.lastInsertRowid, teacher.id, name);

  res.json({ message: '학생 계정이 생성되었습니다.', studentId: result.lastInsertRowid });
});

app.get('/api/teacher/students', teacherAuth, (req, res) => {
  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  const students = db.prepare(`
    SELECT s.*, u.username, u.nickname, u.is_online, u.last_login, u.level
    FROM students s JOIN users u ON s.user_id = u.id
    WHERE s.teacher_id = ?
    ORDER BY s.name ASC
  `).all(teacher.id);
  res.json({ students });
});

app.post('/api/teacher/groups', teacherAuth, (req, res) => {
  const { schoolName } = req.body;
  if (!schoolName) return res.status(400).json({ error: '학교명을 입력해주세요.' });

  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  const result = db.prepare('INSERT INTO school_groups (teacher_id, school_name) VALUES (?, ?)').run(teacher.id, schoolName);
  db.prepare('INSERT INTO school_group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, req.user.id, 'teacher');
  db.prepare('UPDATE teachers SET school_name = ? WHERE id = ?').run(schoolName, teacher.id);

  res.json({ message: '학교 그룹이 생성되었습니다.', groupId: result.lastInsertRowid });
});

app.get('/api/teacher/groups', teacherAuth, (req, res) => {
  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  const groups = db.prepare(`
    SELECT sg.*, (SELECT COUNT(*) FROM school_group_members WHERE group_id = sg.id) as member_count
    FROM school_groups sg WHERE sg.teacher_id = ?
  `).all(teacher.id);
  res.json({ groups });
});

app.post('/api/teacher/groups/:id/add-student', teacherAuth, (req, res) => {
  const { studentUserId } = req.body;
  const existing = db.prepare('SELECT id FROM school_group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, studentUserId);
  if (existing) return res.status(400).json({ error: '이미 그룹에 속한 학생입니다.' });
  db.prepare('INSERT INTO school_group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, studentUserId, 'student');
  res.json({ message: '학생이 그룹에 추가되었습니다.' });
});

app.post('/api/teacher/announcements', teacherAuth, (req, res) => {
  const { groupId, title, content, isPinned } = req.body;
  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  db.prepare('INSERT INTO school_announcements (group_id, teacher_id, title, content, is_pinned) VALUES (?, ?, ?, ?, ?)').run(
    groupId, teacher.id, title, content, isPinned ? 1 : 0
  );

  // 그룹 멤버들에게 알림
  const members = db.prepare('SELECT user_id FROM school_group_members WHERE group_id = ? AND user_id != ?').all(groupId, req.user.id);
  for (const m of members) {
    createNotification(m.user_id, 'school_announcement', '학교 공지사항', `새 공지: ${title}`, `/school/group/${groupId}`);
  }

  res.json({ message: '공지사항이 등록되었습니다.' });
});

app.get('/api/teacher/announcements/:groupId', auth, (req, res) => {
  const announcements = db.prepare(`
    SELECT sa.*, t.user_id as teacher_user_id, u.nickname as teacher_name
    FROM school_announcements sa
    JOIN teachers t ON sa.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE sa.group_id = ?
    ORDER BY sa.is_pinned DESC, sa.created_at DESC
  `).all(req.params.groupId);
  res.json({ announcements });
});

// 출결
app.post('/api/teacher/attendance', teacherAuth, (req, res) => {
  const { studentId, groupId, status, date } = req.body;
  const d = date || new Date().toISOString().split('T')[0];

  const existing = db.prepare('SELECT id FROM attendance_school WHERE student_id = ? AND group_id = ? AND date = ?').get(studentId, groupId, d);
  if (existing) {
    db.prepare('UPDATE attendance_school SET status = ?, recorded_by = ? WHERE id = ?').run(status, req.user.id, existing.id);
  } else {
    db.prepare('INSERT INTO attendance_school (student_id, group_id, date, status, recorded_by) VALUES (?, ?, ?, ?, ?)').run(studentId, groupId, d, status, req.user.id);
  }
  res.json({ message: '출결이 기록되었습니다.' });
});

app.get('/api/teacher/attendance/:groupId', teacherAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const records = db.prepare(`
    SELECT a.*, s.name as student_name, s.user_id as student_user_id
    FROM attendance_school a
    JOIN students s ON a.student_id = s.id
    WHERE a.group_id = ? AND a.date = ?
  `).all(req.params.groupId, date);
  res.json({ records });
});

// 앨범
app.post('/api/teacher/albums', teacherAuth, upload.array('photos', 20), (req, res) => {
  const { groupId, title, description } = req.body;
  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);

  const result = db.prepare('INSERT INTO school_albums (group_id, teacher_id, title, description) VALUES (?, ?, ?, ?)').run(
    groupId, teacher.id, title, description || ''
  );

  if (req.files) {
    for (const file of req.files) {
      db.prepare('INSERT INTO album_photos (album_id, image_url, uploaded_by) VALUES (?, ?, ?)').run(
        result.lastInsertRowid, `/uploads/${file.filename}`, req.user.id
      );
    }
  }

  res.json({ message: '앨범이 생성되었습니다.', albumId: result.lastInsertRowid });
});

app.get('/api/teacher/albums/:groupId', auth, (req, res) => {
  const albums = db.prepare(`
    SELECT sa.*, (SELECT COUNT(*) FROM album_photos WHERE album_id = sa.id) as photo_count
    FROM school_albums sa WHERE sa.group_id = ?
    ORDER BY sa.created_at DESC
  `).all(req.params.groupId);
  res.json({ albums });
});

app.get('/api/teacher/albums/:id/photos', auth, (req, res) => {
  const photos = db.prepare('SELECT * FROM album_photos WHERE album_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ photos });
});

// 학생 경고
app.post('/api/teacher/warnings', teacherAuth, (req, res) => {
  const { studentId, reason, evidence } = req.body;
  db.prepare('INSERT INTO student_warnings (student_id, reason, evidence, reported_to) VALUES (?, ?, ?, ?)').run(
    studentId, reason, evidence || '', req.user.id
  );
  db.prepare('UPDATE students SET warning_count = warning_count + 1 WHERE id = ?').run(studentId);
  res.json({ message: '경고가 기록되었습니다.' });
});

// 학생용 - 자기 그룹 정보
app.get('/api/student/my-groups', auth, (req, res) => {
  const groups = db.prepare(`
    SELECT sg.*, sgm.role
    FROM school_groups sg
    JOIN school_group_members sgm ON sg.id = sgm.group_id
    WHERE sgm.user_id = ?
  `).all(req.user.id);
  res.json({ groups });
});

// 학생용 - 출결 등록
app.post('/api/student/attendance', auth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: '학생만 사용할 수 있습니다.' });
  const { groupId } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(400).json({ error: '학생 정보를 찾을 수 없습니다.' });

  const existing = db.prepare('SELECT id FROM attendance_school WHERE student_id = ? AND group_id = ? AND date = ?').get(student.id, groupId, today);
  if (existing) return res.status(400).json({ error: '오늘은 이미 출결 등록했습니다.' });

  db.prepare('INSERT INTO attendance_school (student_id, group_id, date, status) VALUES (?, ?, ?, ?)').run(student.id, groupId, today, 'present');
  res.json({ message: '출결이 등록되었습니다.' });
});

// 선생님 채팅
app.get('/api/teacher/chat-rooms', teacherAuth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM teacher_chat_rooms ORDER BY created_at DESC').all();
  res.json({ rooms });
});

app.post('/api/teacher/chat-rooms', teacherAuth, (req, res) => {
  const { name, category } = req.body;
  const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  const result = db.prepare('INSERT INTO teacher_chat_rooms (name, category, created_by) VALUES (?, ?, ?)').run(name, category || 'general', teacher.id);
  res.json({ message: '채팅방이 생성되었습니다.', roomId: result.lastInsertRowid });
});

app.get('/api/teacher/chat-rooms/:id/messages', teacherAuth, (req, res) => {
  const messages = db.prepare(`
    SELECT tm.*, u.nickname, u.profile_image
    FROM teacher_messages tm
    JOIN teachers t ON tm.teacher_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE tm.room_id = ?
    ORDER BY tm.created_at ASC
    LIMIT 200
  `).all(req.params.id);
  res.json({ messages });
});

// ==================== ADMIN API ====================

app.get('/api/admin/dashboard', adminAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
    todayUsers: db.prepare("SELECT COUNT(*) as cnt FROM users WHERE date(created_at) = ?").get(today).cnt,
    onlineUsers: db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_online = 1').get().cnt,
    totalPosts: db.prepare('SELECT COUNT(*) as cnt FROM posts WHERE is_deleted = 0').get().cnt,
    todayPosts: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE date(created_at) = ? AND is_deleted = 0").get(today).cnt,
    totalComments: db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE is_deleted = 0').get().cnt,
    totalRooms: db.prepare('SELECT COUNT(*) as cnt FROM chat_rooms WHERE is_active = 1').get().cnt,
    pendingReports: db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE status = 'pending'").get().cnt,
    totalCoins: db.prepare('SELECT COALESCE(SUM(coins), 0) as cnt FROM users').get().cnt,
    todayCoinsUsed: db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as cnt FROM coin_transactions WHERE amount < 0 AND date(created_at) = ?").get(today).cnt,
  };
  res.json({ stats });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = 'SELECT id, username, nickname, level, coins, role, is_banned, is_online, created_at, last_login FROM users';
  const params = [];
  if (search) {
    query += ' WHERE username LIKE ? OR nickname LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const users = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM users ${search ? 'WHERE username LIKE ? OR nickname LIKE ?' : ''}`).get(...(search ? [`%${search}%`, `%${search}%`] : [])).cnt;

  res.json({ users, total });
});

app.get('/api/admin/users/:id', adminAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  const { password, ...userData } = user;

  const postCount = db.prepare('SELECT COUNT(*) as cnt FROM posts WHERE user_id = ?').get(user.id).cnt;
  const commentCount = db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE user_id = ?').get(user.id).cnt;
  const reportCount = db.prepare('SELECT COUNT(*) as cnt FROM reports WHERE target_type = "user" AND target_id = ?').get(user.id).cnt;
  const logs = db.prepare('SELECT * FROM admin_logs WHERE target_id = ? AND target_type = "user" ORDER BY created_at DESC LIMIT 20').all(user.id);

  userData.stats = { postCount, commentCount, reportCount };
  userData.adminLogs = logs;
  res.json({ user: userData });
});

app.put('/api/admin/users/:id', adminAuth, (req, res) => {
  const { action, value, reason } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  let detail = '';
  let beforeVal = '';
  let afterVal = '';

  switch (action) {
    case 'setLevel':
      beforeVal = String(targetUser.level);
      afterVal = String(value);
      db.prepare('UPDATE users SET level = ? WHERE id = ?').run(value, req.params.id);
      detail = `레벨 변경: ${beforeVal} → ${afterVal}`;
      break;
    case 'addCoins':
      beforeVal = String(targetUser.coins);
      addCoins(parseInt(req.params.id), value, reason || '관리자 지급');
      afterVal = String(targetUser.coins + value);
      detail = `코인 지급: +${value}`;
      break;
    case 'removeCoins':
      beforeVal = String(targetUser.coins);
      addCoins(parseInt(req.params.id), -value, reason || '관리자 회수');
      afterVal = String(targetUser.coins - value);
      detail = `코인 회수: -${value}`;
      break;
    case 'ban':
      beforeVal = 'active';
      afterVal = 'banned';
      db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(reason || '', req.params.id);
      detail = `계정 정지: ${reason}`;
      break;
    case 'unban':
      beforeVal = 'banned';
      afterVal = 'active';
      db.prepare('UPDATE users SET is_banned = 0, ban_reason = "" WHERE id = ?').run(req.params.id);
      detail = '계정 정지 해제';
      break;
    case 'restrictPost':
      db.prepare('UPDATE users SET post_restricted = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
      detail = value ? '게시글 작성 제한' : '게시글 작성 제한 해제';
      break;
    case 'restrictComment':
      db.prepare('UPDATE users SET comment_restricted = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
      detail = value ? '댓글 작성 제한' : '댓글 작성 제한 해제';
      break;
    case 'restrictChat':
      db.prepare('UPDATE users SET chat_restricted = ? WHERE id = ?').run(value ? 1 : 0, req.params.id);
      detail = value ? '채팅 제한' : '채팅 제한 해제';
      break;
    default:
      return res.status(400).json({ error: '알 수 없는 작업입니다.' });
  }

  db.prepare('INSERT INTO admin_logs (admin_id, action, target_type, target_id, detail, before_value, after_value) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    req.user.id, action, 'user', req.params.id, detail, beforeVal, afterVal
  );

  res.json({ message: detail });
});

// 관리자 - 게시판 관리
app.get('/api/admin/posts', adminAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.nickname FROM posts p JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT 50
  `).all();
  res.json({ posts });
});

app.post('/api/admin/notices', adminAuth, (req, res) => {
  const { title, content, isPinned } = req.body;
  const result = db.prepare('INSERT INTO posts (user_id, title, content, is_notice, is_pinned) VALUES (?, ?, ?, 1, ?)').run(
    req.user.id, title, content, isPinned ? 1 : 0
  );
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'createNotice', 'post', result.lastInsertRowid, `공지사항 작성: ${title}`
  );
  res.json({ message: '공지사항이 등록되었습니다.' });
});

// 관리자 - 수다방 관리
app.get('/api/admin/rooms', adminAuth, (req, res) => {
  const rooms = db.prepare(`
    SELECT cr.*, u.nickname as owner_name,
    (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id) as member_count
    FROM chat_rooms cr JOIN users u ON cr.owner_id = u.id
    ORDER BY cr.created_at DESC
  `).all();
  res.json({ rooms });
});

app.delete('/api/admin/rooms/:id', adminAuth, (req, res) => {
  const room = db.prepare('SELECT name FROM chat_rooms WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE chat_rooms SET is_active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO admin_logs (admin_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'deleteRoom', 'room', req.params.id, `수다방 삭제: ${room?.name}`
  );
  res.json({ message: '수다방이 삭제되었습니다.' });
});

// 관리자 - 신고 관리
app.get('/api/admin/reports', adminAuth, (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, u.nickname as reporter_name
    FROM reports r JOIN users u ON r.reporter_id = u.id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ reports });
});

app.put('/api/admin/reports/:id', adminAuth, (req, res) => {
  const { status, adminNote } = req.body;
  db.prepare('UPDATE reports SET status = ?, admin_note = ? WHERE id = ?').run(status, adminNote || '', req.params.id);

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  createNotification(report.reporter_id, 'report_result', '신고 처리 결과', `신고가 ${status === 'resolved' ? '처리' : '반려'}되었습니다.`);

  res.json({ message: '신고가 처리되었습니다.' });
});

// 관리자 행동 기록
app.get('/api/admin/logs', adminAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.nickname as admin_name
    FROM admin_logs al JOIN users u ON al.admin_id = u.id
    ORDER BY al.created_at DESC LIMIT 100
  `).all();
  res.json({ logs });
});

// ==================== POLLS / VOTES / QUIZ API ====================

app.post('/api/rooms/:roomId/polls', auth, levelCheck(24), (req, res) => {
  const { question, options, type } = req.body;
  if (!question || !options || options.length < 2) return res.status(400).json({ error: '질문과 2개 이상의 선택지가 필요합니다.' });

  const result = db.prepare('INSERT INTO polls (room_id, creator_id, question, type) VALUES (?, ?, ?, ?)').run(
    req.params.roomId, req.user.id, question, type || 'poll'
  );
  for (const opt of options) {
    db.prepare('INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)').run(result.lastInsertRowid, opt);
  }
  res.json({ message: '투표가 생성되었습니다.', pollId: result.lastInsertRowid });
});

app.get('/api/rooms/:roomId/polls', auth, (req, res) => {
  const polls = db.prepare(`
    SELECT p.*, u.nickname as creator_name
    FROM polls p JOIN users u ON p.creator_id = u.id
    WHERE p.room_id = ?
    ORDER BY p.created_at DESC
  `).all(req.params.roomId);
  for (const poll of polls) {
    poll.options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ?').all(poll.id);
    poll.userVote = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, req.user.id);
  }
  res.json({ polls });
});

app.post('/api/polls/:id/vote', auth, (req, res) => {
  const { optionId } = req.body;
  const existing = db.prepare('SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) return res.status(400).json({ error: '이미 투표했습니다.' });

  db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(req.params.id, optionId, req.user.id);
  db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(optionId);

  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ?').all(req.params.id);
  res.json({ message: '투표 완료!', options });
});

// ==================== SOCKET.IO ====================

const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('인증이 필요합니다.'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, nickname, profile_image, role, level, chat_restricted FROM users WHERE id = ?').get(decoded.id);
    if (!user) return next(new Error('사용자를 찾을 수 없습니다.'));
    socket.user = user;
    next();
  } catch (e) {
    next(new Error('유효하지 않은 토큰입니다.'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  db.prepare('UPDATE users SET is_online = 1 WHERE id = ?').run(userId);
  socket.join(`user_${userId}`);

  // 실시간 채팅 참여
  socket.on('joinRoom', (roomId) => {
    socket.join(`room_${roomId}`);
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room_${roomId}`);
  });

  // 도배 방지
  const messageTimestamps = [];
  const SPAM_LIMIT = 5;
  const SPAM_WINDOW = 5000;

  socket.on('chatMessage', (data) => {
    if (socket.user.chat_restricted) {
      return socket.emit('error', { message: '채팅이 제한되어 있습니다.' });
    }

    const now = Date.now();
    messageTimestamps.push(now);
    while (messageTimestamps.length > 0 && now - messageTimestamps[0] > SPAM_WINDOW) {
      messageTimestamps.shift();
    }
    if (messageTimestamps.length > SPAM_LIMIT) {
      return socket.emit('error', { message: '메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해주세요.' });
    }

    let content = data.content;

    // 욕설 감지 및 경고 (학생용)
    if (socket.user.role === 'student' && containsBadWords(content)) {
      const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(userId);
      if (student) {
        const warningCount = student.warning_count + 1;
        db.prepare('UPDATE students SET warning_count = ? WHERE id = ?').run(warningCount, student.id);

        if (warningCount >= 2) {
          db.prepare('INSERT INTO student_warnings (student_id, reason, evidence, reported_to) VALUES (?, ?, ?, ?)').run(
            student.id, '부적절한 언어 사용 (2회차)', content, student.teacher_id
          );
          const teacher = db.prepare('SELECT user_id FROM teachers WHERE id = ?').get(student.teacher_id);
          if (teacher) {
            createNotification(teacher.user_id, 'student_warning', '학생 경고',
              `${student.name} 학생이 부적절한 언어를 2회 이상 사용했습니다.`);
          }
          socket.emit('warning', { message: '부적절한 언어 사용이 감지되어 선생님께 보고되었습니다.', count: warningCount });
        } else {
          socket.emit('warning', { message: '부적절한 언어 사용이 감지되었습니다. 주의해주세요!', count: warningCount });
        }
        return;
      }
    }

    content = filterBadWords(content);

    const result = db.prepare('INSERT INTO messages (room_id, user_id, content, type, reply_to) VALUES (?, ?, ?, ?, ?)').run(
      data.roomId, userId, content, data.type || 'text', data.replyTo || null
    );

    const message = {
      id: result.lastInsertRowid,
      room_id: data.roomId,
      user_id: userId,
      nickname: socket.user.nickname,
      profile_image: socket.user.profile_image,
      level: socket.user.level,
      content,
      type: data.type || 'text',
      reply_to: data.replyTo || null,
      created_at: new Date().toISOString()
    };

    io.to(`room_${data.roomId}`).emit('chatMessage', message);
  });

  socket.on('deleteMessage', (data) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
    if (msg && (msg.user_id === userId || socket.user.role === 'admin')) {
      db.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ?').run(data.messageId);
      io.to(`room_${msg.room_id}`).emit('messageDeleted', { messageId: data.messageId });
    }
  });

  // 1:1 채팅
  socket.on('joinDM', (roomId) => {
    socket.join(`dm_${roomId}`);
  });

  socket.on('dmMessage', (data) => {
    if (socket.user.chat_restricted) {
      return socket.emit('error', { message: '채팅이 제한되어 있습니다.' });
    }

    let content = filterBadWords(data.content);

    const result = db.prepare('INSERT INTO dm_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)').run(
      data.roomId, userId, content, data.type || 'text'
    );

    const message = {
      id: result.lastInsertRowid,
      room_id: data.roomId,
      sender_id: userId,
      nickname: socket.user.nickname,
      profile_image: socket.user.profile_image,
      content,
      type: data.type || 'text',
      is_read: 0,
      created_at: new Date().toISOString()
    };

    io.to(`dm_${data.roomId}`).emit('dmMessage', message);

    // 상대방에게 알림
    const room = db.prepare('SELECT * FROM dm_rooms WHERE id = ?').get(data.roomId);
    if (room) {
      const partnerId = room.user1_id === userId ? room.user2_id : room.user1_id;
      createNotification(partnerId, 'dm', '새 메시지', `${socket.user.nickname}: ${content.substring(0, 50)}`, `/dm/${data.roomId}`);
    }
  });

  socket.on('dmRead', (data) => {
    db.prepare('UPDATE dm_messages SET is_read = 1 WHERE room_id = ? AND sender_id != ? AND is_read = 0').run(data.roomId, userId);
    io.to(`dm_${data.roomId}`).emit('dmRead', { roomId: data.roomId, userId });
  });

  // 선생님 채팅
  socket.on('joinTeacherRoom', (roomId) => {
    if (socket.user.role === 'teacher' || socket.user.role === 'admin') {
      socket.join(`teacher_room_${roomId}`);
    }
  });

  socket.on('teacherMessage', (data) => {
    if (socket.user.role !== 'teacher' && socket.user.role !== 'admin') return;

    const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(userId);
    if (!teacher) return;

    const result = db.prepare('INSERT INTO teacher_messages (room_id, teacher_id, content, type) VALUES (?, ?, ?, ?)').run(
      data.roomId, teacher.id, data.content, data.type || 'text'
    );

    const message = {
      id: result.lastInsertRowid,
      room_id: data.roomId,
      teacher_id: teacher.id,
      nickname: socket.user.nickname,
      profile_image: socket.user.profile_image,
      content: data.content,
      type: data.type || 'text',
      created_at: new Date().toISOString()
    };

    io.to(`teacher_room_${data.roomId}`).emit('teacherMessage', message);
  });

  // 타이핑 표시
  socket.on('typing', (data) => {
    socket.to(`room_${data.roomId}`).emit('typing', { userId, nickname: socket.user.nickname });
  });

  socket.on('dmTyping', (data) => {
    socket.to(`dm_${data.roomId}`).emit('dmTyping', { userId, nickname: socket.user.nickname });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    db.prepare('UPDATE users SET is_online = 0 WHERE id = ?').run(userId);
  });
});

// 채팅 메시지 로드
app.get('/api/rooms/:id/messages', auth, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, u.nickname, u.profile_image, u.level
    FROM messages m JOIN users u ON m.user_id = u.id
    WHERE m.room_id = ? AND m.is_deleted = 0
    ORDER BY m.created_at ASC
    LIMIT 200
  `).all(req.params.id);
  res.json({ messages });
});

// 파일 업로드
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일을 선택해주세요.' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// SPA 라우팅
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  db = await initDatabase();
  server.listen(PORT, () => {
    console.log(`수다방 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

startServer().catch(err => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
