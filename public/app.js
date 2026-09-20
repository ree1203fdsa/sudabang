// ==================== 수다방 App ====================
const App = {
  token: localStorage.getItem('token'),
  user: null,
  socket: null,
  currentPage: 'home',
  currentChatRoom: null,
  currentDMRoom: null,
  unreadNotifs: 0,

  async init() {
    if (this.token) {
      try {
        const res = await this.api('/api/auth/me');
        this.user = res.user;
        this.applyTheme(this.user.theme);
        this.connectSocket();
        this.render();
        this.loadNotifCount();
        this.registerFCMToken();
      } catch (e) {
        this.token = null;
        localStorage.removeItem('token');
        this.renderAuth();
      }
    } else {
      this.renderAuth();
    }
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'light');
  },

  // ==================== API ====================
  async api(url, options = {}) {
    const headers = { ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      if (options.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
      }
    }
    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
    return data;
  },

  // ==================== SOCKET ====================
  connectSocket() {
    if (this.socket) this.socket.disconnect();
    this.socket = io({ auth: { token: this.token } });

    this.socket.on('notification', (data) => {
      this.unreadNotifs++;
      this.updateNotifBadge();
      this.showToast(data.title, 'info');
    });

    this.socket.on('chatMessage', (msg) => {
      if (this.currentPage === 'chat' && this.currentChatRoom) {
        this.appendChatMessage(msg);
      }
    });

    this.socket.on('messageDeleted', (data) => {
      const el = document.getElementById(`msg-${data.messageId}`);
      if (el) el.remove();
    });

    this.socket.on('dmMessage', (msg) => {
      if (this.currentPage === 'dm-chat' && this.currentDMRoom == msg.room_id) {
        this.appendDMMessage(msg);
      }
    });

    this.socket.on('dmRead', () => {
      document.querySelectorAll('.dm-read-status').forEach(el => el.textContent = '읽음');
    });

    this.socket.on('typing', (data) => {
      const el = document.getElementById('typing-indicator');
      if (el) { el.textContent = `${data.nickname}님이 입력 중...`; setTimeout(() => el.textContent = '', 2000); }
    });

    this.socket.on('dmTyping', (data) => {
      const el = document.getElementById('typing-indicator');
      if (el) { el.textContent = `${data.nickname}님이 입력 중...`; setTimeout(() => el.textContent = '', 2000); }
    });

    this.socket.on('warning', (data) => {
      this.showWarning(data.message);
    });

    this.socket.on('error', (data) => {
      this.showToast(data.message, 'error');
    });
  },

  // ==================== TOAST ====================
  showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${this.escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
  },

  showWarning(message) {
    const popup = document.createElement('div');
    popup.className = 'warning-popup';
    popup.innerHTML = `<h3 style="font-size:18px;margin-bottom:8px;color:var(--danger)">⚠️ 경고</h3><p>${this.escapeHtml(message)}</p>`;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 3000);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}일 전`;
    return d.toLocaleDateString('ko-KR');
  },

  formatTimeShort(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  },

  // ==================== AUTH RENDER ====================
  renderAuth(mode = 'login') {
    const app = document.getElementById('app');
    if (mode === 'login') {
      app.innerHTML = `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-mascot"><img src="logo.webp" alt="수다방" style="width:120px;height:120px;object-fit:contain"></div>
              <div class="auth-logo">
                <span class="auth-logo-text">수다방</span>
              </div>
              <div class="auth-sub">함께 소통하는 커뮤니티</div>
            </div>
            <div id="auth-alert"></div>
            <div class="auth-input-group">
              <i class="fas fa-user auth-input-icon"></i>
              <input type="text" id="login-username" class="auth-input" placeholder="아이디를 입력하세요">
            </div>
            <div class="auth-input-group">
              <i class="fas fa-lock auth-input-icon"></i>
              <input type="password" id="login-password" class="auth-input" placeholder="비밀번호를 입력하세요">
            </div>
            <button class="auth-btn auth-btn-primary" onclick="App.login()">로그인</button>
            <button class="auth-btn auth-btn-outline" onclick="App.renderAuth('register')">회원가입</button>
            <div class="auth-safe">
              <i class="fas fa-shield-alt" style="font-size:20px;color:var(--primary)"></i>
              <span>안전한 암호화로 비밀번호가 보호됩니다</span>
            </div>
          </div>
        </div>
      `;
      document.getElementById('login-password').addEventListener('keypress', (e) => { if (e.key === 'Enter') App.login(); });
    } else if (mode === 'register') {
      app.innerHTML = `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-header">
              <div class="auth-mascot"><img src="logo.webp" alt="수다방" style="width:100px;height:100px;object-fit:contain"></div>
              <div class="auth-logo">
                <span class="auth-logo-text">회원가입</span>
              </div>
            </div>
            <div class="reg-steps">
              <div class="reg-step active"><div class="reg-step-num">1</div><div class="reg-step-label">정보 입력</div></div>
              <div class="reg-step-line"></div>
              <div class="reg-step"><div class="reg-step-num">2</div><div class="reg-step-label">약관 동의</div></div>
              <div class="reg-step-line"></div>
              <div class="reg-step"><div class="reg-step-num">3</div><div class="reg-step-label">가입 완료</div></div>
            </div>
            <div id="auth-alert"></div>
            <div class="form-group" style="text-align:center">
              <div class="profile-upload" onclick="document.getElementById('reg-profile').click()">
                <i class="fas fa-camera" id="upload-icon" style="font-size:24px;color:var(--text-muted)"></i>
                <img id="preview-img" style="display:none">
              </div>
              <input type="file" id="reg-profile" accept="image/*" style="display:none" onchange="App.previewImage(this)">
              <div style="font-size:12px;color:var(--text-muted);margin-top:6px">프로필 사진</div>
            </div>
            <div class="form-group">
              <label class="form-label">계정 유형</label>
              <select id="reg-role" class="form-select" onchange="App.toggleTeacherCode()">
                <option value="user">일반 사용자</option>
                <option value="teacher">선생님</option>
              </select>
            </div>
            <div class="form-group" id="teacher-code-group" style="display:none">
              <label class="form-label">선생님 인증 코드</label>
              <input type="text" id="reg-teacher-code" class="form-input" placeholder="인증 코드를 입력하세요">
            </div>
            <div class="auth-input-group">
              <i class="fas fa-user auth-input-icon"></i>
              <input type="text" id="reg-username" class="auth-input" placeholder="아이디 (3~20자)">
            </div>
            <div class="auth-input-group">
              <i class="fas fa-lock auth-input-icon"></i>
              <input type="password" id="reg-password" class="auth-input" placeholder="비밀번호 (6자 이상)">
            </div>
            <div class="auth-input-group">
              <i class="fas fa-smile auth-input-icon"></i>
              <input type="text" id="reg-nickname" class="auth-input" placeholder="닉네임 (2~12자)">
            </div>
            <button class="auth-btn auth-btn-primary" onclick="App.register()">가입하기</button>
            <button class="auth-btn auth-btn-outline" onclick="App.renderAuth('login')">로그인으로 돌아가기</button>
          </div>
        </div>
      `;
    }
  },

  toggleTeacherCode() {
    const group = document.getElementById('teacher-code-group');
    if (group) group.style.display = document.getElementById('reg-role').value === 'teacher' ? 'block' : 'none';
  },

  previewImage(input) {
    if (input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('preview-img');
        img.src = e.target.result;
        img.style.display = 'block';
        const icon = document.getElementById('upload-icon');
        if (icon) icon.style.display = 'none';
      };
      reader.readAsDataURL(input.files[0]);
    }
  },

  async login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
      const data = await this.api('/api/auth/login', {
        method: 'POST', body: { username, password }
      });
      this.token = data.token;
      localStorage.setItem('token', data.token);
      this.user = data.user;
      this.applyTheme(this.user.theme);
      this.connectSocket();
      this.render();
      this.loadNotifCount();
      this.registerFCMToken();
    } catch (e) {
      const alert = document.getElementById('auth-alert');
      if (alert) alert.innerHTML = `<div class="auth-alert"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(e.message)}</div>`;
    }
  },

  async register() {
    const formData = new FormData();
    formData.append('username', document.getElementById('reg-username').value);
    formData.append('password', document.getElementById('reg-password').value);
    formData.append('nickname', document.getElementById('reg-nickname').value);
    formData.append('role', document.getElementById('reg-role').value);
    const teacherCode = document.getElementById('reg-teacher-code');
    if (teacherCode) formData.append('teacherCode', teacherCode.value);
    const fileInput = document.getElementById('reg-profile');
    if (fileInput && fileInput.files[0]) formData.append('profileImage', fileInput.files[0]);

    try {
      const res = await fetch('/api/auth/register', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.showToast('회원가입이 완료되었습니다! 🎉', 'success');
      this.renderAuth('login');
    } catch (e) {
      const alert = document.getElementById('auth-alert');
      if (alert) alert.innerHTML = `<div class="auth-alert"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(e.message)}</div>`;
    }
  },

  logout() {
    this.token = null;
    localStorage.removeItem('token');
    if (this.socket) this.socket.disconnect();
    this.user = null;
    this.renderAuth();
  },

  // ==================== MAIN RENDER ====================
  render() {
    const app = document.getElementById('app');
    const isAdmin = this.user.role === 'admin';
    const isTeacher = this.user.role === 'teacher';
    const isStudent = this.user.role === 'student';

    let middlePage = 'board';
    let middleIcon = 'fa-pen';
    let middleLabel = '글쓰기';
    if (isTeacher) { middlePage = 'school'; middleIcon = 'fa-school'; middleLabel = '학교'; }
    if (isStudent) { middlePage = 'student-dashboard'; middleIcon = 'fa-school'; middleLabel = '학교'; }

    app.innerHTML = `
      <div class="app-layout">
        <div class="top-header">
          <div class="top-header-logo">
            <img src="logo.webp" alt="수다방" style="width:32px;height:32px;object-fit:contain;border-radius:6px"> 수다방
          </div>
          <div class="top-header-right">
            <div class="search-box">
              <i class="fas fa-search"></i>
              <input type="text" placeholder="검색..." id="global-search" onkeypress="if(event.key==='Enter')App.globalSearch()">
            </div>
            <div class="top-header-coins"><i class="fas fa-coins"></i> <span id="header-coins">${this.user.coins}</span></div>
            <button class="top-header-btn" onclick="App.navigate('notifications')">
              <i class="fas fa-bell"></i>
              <span class="notif-badge" id="notif-badge" style="display:none">0</span>
            </button>
          </div>
        </div>
        <div class="page-content" id="page-content"></div>
        <nav class="bottom-nav">
          <div class="bottom-nav-item active" data-page="home">
            <i class="fas fa-home"></i><span>홈</span>
          </div>
          <div class="bottom-nav-item" data-page="rooms">
            <i class="fas fa-comments"></i><span>수다방</span>
          </div>
          <div class="bottom-nav-item" data-page="${middlePage}">
            <div class="bottom-nav-center"><i class="fas ${middleIcon}"></i></div>
            <span>${middleLabel}</span>
          </div>
          <div class="bottom-nav-item" data-page="dm">
            <i class="fas fa-envelope"></i><span>메시지</span>
          </div>
          <div class="bottom-nav-item" data-page="settings">
            <i class="fas fa-ellipsis-h"></i><span>더보기</span>
          </div>
        </nav>
      </div>
    `;

    document.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.addEventListener('click', () => this.navigate(item.dataset.page));
    });

    this.navigate('home');
  },

  navigate(page) {
    this.currentPage = page;

    // Reset content styles
    const content = document.getElementById('page-content');
    if (content) {
      content.style.padding = '16px';
      content.style.maxWidth = '600px';
    }

    // Update active nav
    document.querySelectorAll('.bottom-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    const pages = {
      home: () => this.renderHome(),
      chat: () => this.renderChat(),
      dm: () => this.renderDM(),
      rooms: () => this.renderRooms(),
      board: () => this.renderBoard(),
      friends: () => this.renderFriends(),
      shop: () => this.renderShop(),
      attendance: () => this.renderAttendance(),
      ranking: () => this.renderRanking(),
      notifications: () => this.renderNotifications(),
      settings: () => this.renderSettings(),
      admin: () => this.renderAdmin(),
      profile: () => this.renderProfile(this.user.id),
      coins: () => this.renderCoins(),
      inventory: () => this.renderInventory(),
      school: () => this.renderSchool(),
      students: () => this.renderStudents(),
      'school-attendance': () => this.renderSchoolAttendance(),
      'school-announcements': () => this.renderSchoolAnnouncements(),
      'school-albums': () => this.renderSchoolAlbums(),
      'teacher-chat': () => this.renderTeacherChat(),
      'student-dashboard': () => this.renderStudentDashboard(),
    };

    if (pages[page]) pages[page]();
  },

  async registerFCMToken() {
    try {
      let fcmToken = '';
      if (window.AndroidBridge && window.AndroidBridge.getFCMToken) {
        fcmToken = window.AndroidBridge.getFCMToken();
      }
      if (fcmToken) {
        await this.api('/api/fcm/register', {
          method: 'POST', body: { token: fcmToken }
        });
      }
    } catch (e) {}
  },

  async loadNotifCount() {
    try {
      const data = await this.api('/api/notifications');
      this.unreadNotifs = data.unreadCount;
      this.updateNotifBadge();
    } catch (e) {}
  },

  updateNotifBadge() {
    const el = document.getElementById('notif-badge');
    if (el) {
      el.style.display = this.unreadNotifs > 0 ? 'flex' : 'none';
      el.textContent = this.unreadNotifs;
    }
  },

  // ==================== HOME ====================
  async renderHome() {
    const content = document.getElementById('page-content');
    const expForNext = (this.user.level * 5) - this.user.exp;
    const progress = ((this.user.exp % 5) / 5 * 100);
    const isTeacher = this.user.role === 'teacher';
    const isStudent = this.user.role === 'student';

    let greeting = '반가워요!';
    const hour = new Date().getHours();
    if (hour < 12) greeting = '좋은 아침이에요!';
    else if (hour < 18) greeting = '좋은 오후에요!';
    else greeting = '좋은 저녁이에요!';

    let roleLabel = '일반';
    if (this.user.role === 'admin') roleLabel = '관리자';
    else if (this.user.role === 'teacher') roleLabel = '선생님';
    else if (this.user.role === 'student') roleLabel = '학생';

    content.innerHTML = `
      <!-- Welcome Banner -->
      <div class="welcome-banner">
        <h2>${greeting}</h2>
        <p>${this.escapeHtml(this.user.nickname)}님, 오늘도 즐거운 수다방 되세요 🐱</p>
        <div class="welcome-mascot"><img src="logo.webp" alt="" style="width:80px;height:80px;object-fit:contain"></div>
      </div>

      <!-- Profile Card -->
      <div class="profile-card" onclick="App.navigate('profile')" style="cursor:pointer">
        <img class="profile-card-avatar" src="${this.user.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
        <div class="profile-card-info">
          <div class="profile-card-name">${this.escapeHtml(this.user.nickname)} <span class="badge badge-${this.user.role}">${roleLabel}</span></div>
          <div class="profile-card-level">Lv.${this.user.level}</div>
          <div class="profile-card-bar"><div class="profile-card-bar-fill" style="width:${progress}%"></div></div>
          <div class="profile-card-exp"><span>EXP ${this.user.exp}</span><span>다음 레벨까지 ${expForNext > 0 ? expForNext : 0}</span></div>
        </div>
        <div class="coin-box">
          <div class="coin-amount">${this.user.coins}</div>
          <div class="coin-label">코인</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="attendance-card">
        <div class="attendance-box" id="home-attendance">
          <div class="attendance-icon">📅</div>
          <div style="font-size:14px;font-weight:700">출석 체크</div>
          <div class="attendance-text">매일 출석하고 보상 받기</div>
          <button class="attendance-btn" onclick="App.quickAttendance()" id="quick-attend-btn">출석하기</button>
        </div>
        <div class="attendance-box" onclick="App.navigate('shop')" style="cursor:pointer">
          <div class="attendance-icon">🛍️</div>
          <div style="font-size:14px;font-weight:700">상점</div>
          <div class="attendance-text">코인으로 아이템 구매</div>
          <button class="attendance-btn" style="background:var(--secondary)">둘러보기</button>
        </div>
      </div>

      <!-- Notices -->
      <div id="home-notices"></div>

      <!-- Popular Rooms -->
      <div id="home-rooms"></div>

      <!-- Recent Posts -->
      <div id="home-posts"></div>

      <!-- Quick Links -->
      <div class="stats-grid" style="margin-top:12px">
        <div class="stat-card" onclick="App.navigate('friends')" style="cursor:pointer">
          <div class="stat-icon" style="background:#6C63FF20;color:var(--primary)"><i class="fas fa-user-friends"></i></div>
          <div class="stat-label">친구</div>
        </div>
        <div class="stat-card" onclick="App.navigate('ranking')" style="cursor:pointer">
          <div class="stat-icon" style="background:#FFD70020;color:#FFD700"><i class="fas fa-trophy"></i></div>
          <div class="stat-label">랭킹</div>
        </div>
        <div class="stat-card" onclick="App.navigate('attendance')" style="cursor:pointer">
          <div class="stat-icon" style="background:#2ED57320;color:var(--success)"><i class="fas fa-calendar-check"></i></div>
          <div class="stat-label">출석</div>
        </div>
        ${this.user.role === 'admin' ? `
        <div class="stat-card" onclick="App.navigate('admin')" style="cursor:pointer">
          <div class="stat-icon" style="background:#FF475720;color:var(--danger)"><i class="fas fa-shield-alt"></i></div>
          <div class="stat-label">관리자</div>
        </div>` : `
        <div class="stat-card" onclick="App.navigate('inventory')" style="cursor:pointer">
          <div class="stat-icon" style="background:#FFA50220;color:var(--warning)"><i class="fas fa-box"></i></div>
          <div class="stat-label">보관함</div>
        </div>`}
      </div>
    `;

    // Load attendance status
    try {
      const attData = await this.api('/api/attendance');
      if (attData.checked) {
        const btn = document.getElementById('quick-attend-btn');
        if (btn) { btn.textContent = '완료 ✓'; btn.classList.add('done'); btn.disabled = true; }
      }
    } catch (e) {}

    // Load notices
    try {
      const data = await this.api('/api/posts?limit=5');
      const notices = data.posts.filter(p => p.is_notice);
      if (notices.length > 0) {
        document.getElementById('home-notices').innerHTML = `
          <div class="card">
            <div class="card-header"><div class="card-title"><i class="fas fa-bullhorn" style="color:var(--primary)"></i> 공지사항</div></div>
            ${notices.slice(0, 3).map(n => `
              <div class="notice-card" onclick="App.viewPost(${n.id})" style="margin-bottom:8px">
                <div class="notice-icon"><i class="fas fa-megaphone"></i></div>
                <div class="notice-content">
                  <div class="notice-title">${this.escapeHtml(n.title)}</div>
                  <div class="notice-date">${this.formatTime(n.created_at)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } catch (e) {}

    // Load rooms
    try {
      const roomData = await this.api('/api/rooms');
      if (roomData.rooms.length > 0) {
        document.getElementById('home-rooms').innerHTML = `
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fas fa-door-open" style="color:var(--primary)"></i> 인기 수다방</div>
              <div class="card-more" onclick="App.navigate('rooms')">더보기 <i class="fas fa-chevron-right"></i></div>
            </div>
            <div class="rooms-scroll">
              ${roomData.rooms.slice(0, 6).map(r => `
                <div class="room-card-v" onclick="App.joinRoom(${r.id}, '${r.type}')">
                  <div class="room-card-img">
                    ${r.type === 'private' ? '🔒' : r.type === 'password' ? '🔑' : '💬'}
                    <span class="room-type-tag ${r.type}">${r.type === 'public' ? '공개' : r.type === 'private' ? '비공개' : '비밀번호'}</span>
                  </div>
                  <div class="room-card-body">
                    <div class="room-card-name">${this.escapeHtml(r.name)}</div>
                    <div class="room-card-meta"><i class="fas fa-users"></i> ${r.member_count}명</div>
                    <button class="room-join-btn">입장하기</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    } catch (e) {}

    // Load recent posts
    try {
      const postData = await this.api('/api/posts?limit=3');
      const recentPosts = postData.posts.filter(p => !p.is_notice);
      if (recentPosts.length > 0) {
        document.getElementById('home-posts').innerHTML = `
          <div class="card">
            <div class="card-header">
              <div class="card-title"><i class="fas fa-fire" style="color:var(--secondary)"></i> 최근 게시글</div>
              <div class="card-more" onclick="App.navigate('board')">더보기 <i class="fas fa-chevron-right"></i></div>
            </div>
            ${recentPosts.slice(0, 3).map(p => `
              <div onclick="App.viewPost(${p.id})" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer">
                <div style="font-size:14px;font-weight:600">${this.escapeHtml(p.title)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
                  ${this.escapeHtml(p.nickname)} · ${this.formatTime(p.created_at)}
                  <span style="float:right"><i class="fas fa-heart"></i> ${p.hearts} <i class="fas fa-comment" style="margin-left:8px"></i> ${p.comment_count}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } catch (e) {}
  },

  async quickAttendance() {
    try {
      const data = await this.api('/api/attendance', { method: 'POST' });
      this.showToast(`출석 완료! 연속 ${data.streak}일 🔥`, 'success');
      const btn = document.getElementById('quick-attend-btn');
      if (btn) { btn.textContent = '완료 ✓'; btn.classList.add('done'); btn.disabled = true; }
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== CHAT ====================
  async renderChat() {
    const content = document.getElementById('page-content');
    content.style.padding = '0';
    content.style.maxWidth = '100%';

    try {
      const roomsData = await this.api('/api/rooms/my');
      const rooms = roomsData.rooms;
      if (rooms.length === 0) {
        content.innerHTML = '<div class="empty-state" style="padding:48px"><i class="fas fa-comments"></i><p>참여 중인 채팅방이 없습니다.<br>수다방에서 채팅방에 입장해보세요!</p></div>';
        content.style.padding = '16px';
        content.style.maxWidth = '600px';
        return;
      }
      this.currentChatRoom = rooms[0].id;
      await this.loadChatRoom(rooms[0].id);
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    }
  },

  async loadChatRoom(roomId) {
    this.currentChatRoom = roomId;
    const content = document.getElementById('page-content');

    if (this.socket) this.socket.emit('joinRoom', roomId);

    content.innerHTML = `
      <div class="chat-container">
        <div class="chat-messages" id="chat-messages"></div>
        <div class="typing-indicator" id="typing-indicator"></div>
        <div class="chat-input-area">
          <button class="btn-icon" onclick="App.uploadChatImage()"><i class="fas fa-image"></i></button>
          <input type="text" class="chat-input" id="chat-input" placeholder="메시지를 입력하세요..." onkeypress="if(event.key==='Enter')App.sendChatMessage()">
          <input type="file" id="chat-file" accept="image/*" style="display:none" onchange="App.sendChatImage(this)">
          <button class="chat-send-btn" onclick="App.sendChatMessage()"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    `;

    const chatInput = document.getElementById('chat-input');
    let typingTimeout;
    chatInput.addEventListener('input', () => {
      clearTimeout(typingTimeout);
      this.socket.emit('typing', { roomId });
      typingTimeout = setTimeout(() => {}, 2000);
    });

    try {
      const data = await this.api(`/api/rooms/${roomId}/messages`);
      const container = document.getElementById('chat-messages');
      data.messages.forEach(msg => this.appendChatMessage(msg, false));
      container.scrollTop = container.scrollHeight;
    } catch (e) {}
  },

  appendChatMessage(msg, scroll = true) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const isOwn = msg.user_id === this.user.id;
    const div = document.createElement('div');
    div.className = `chat-msg ${isOwn ? 'own' : ''}`;
    div.id = `msg-${msg.id}`;

    let contentHtml = this.escapeHtml(msg.content);
    if (msg.type === 'image') contentHtml = `<img src="${msg.content}" alt="image">`;

    div.innerHTML = `
      ${!isOwn ? `<img class="chat-msg-avatar" src="${msg.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">` : ''}
      <div class="chat-msg-body">
        ${!isOwn ? `<div class="chat-msg-name">${this.escapeHtml(msg.nickname)} <span style="font-size:11px;color:var(--primary)">Lv.${msg.level || ''}</span></div>` : ''}
        <div class="chat-bubble">${contentHtml}</div>
        <div class="chat-time">${this.formatTimeShort(msg.created_at)}</div>
      </div>
    `;
    container.appendChild(div);
    if (scroll) container.scrollTop = container.scrollHeight;
  },

  sendChatMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content || !this.currentChatRoom) return;
    this.socket.emit('chatMessage', { roomId: this.currentChatRoom, content });
    input.value = '';
  },

  uploadChatImage() { document.getElementById('chat-file').click(); },

  async sendChatImage(input) {
    if (!input.files[0]) return;
    const formData = new FormData();
    formData.append('file', input.files[0]);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` },
        body: formData
      });
      const data = await res.json();
      this.socket.emit('chatMessage', { roomId: this.currentChatRoom, content: data.url, type: 'image' });
    } catch (e) { this.showToast('이미지 업로드에 실패했습니다.', 'error'); }
    input.value = '';
  },

  // ==================== DM ====================
  async renderDM() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/dm');
      if (data.rooms.length === 0) {
        content.innerHTML = '<div class="empty-state"><i class="fas fa-envelope"></i><p>1:1 채팅이 없습니다.<br>친구 목록에서 채팅을 시작해보세요!</p></div>';
        return;
      }
      content.innerHTML = `
        <div class="page-title"><i class="fas fa-envelope page-title-icon" style="color:var(--primary)"></i> 메시지</div>
        <div class="card" style="padding:0 16px">
          ${data.rooms.map(r => `
            <div class="dm-list-item" onclick="App.openDM(${r.id})">
              <img class="dm-avatar" src="${r.partner_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
              <div class="dm-info">
                <div class="dm-name">${this.escapeHtml(r.partner_name)} <span class="online-dot ${r.partner_online ? 'online' : 'offline'}"></span></div>
                <div class="dm-last-msg">${r.last_message ? this.escapeHtml(r.last_message) : '대화를 시작해보세요'}</div>
              </div>
              <div class="dm-meta">
                <div class="dm-time">${r.last_message_time ? this.formatTime(r.last_message_time) : ''}</div>
                ${r.unread_count > 0 ? `<span class="dm-unread">${r.unread_count}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async openDM(roomId) {
    this.currentPage = 'dm-chat';
    this.currentDMRoom = roomId;
    const content = document.getElementById('page-content');
    content.style.padding = '0';
    content.style.maxWidth = '100%';

    if (this.socket) this.socket.emit('joinDM', roomId);

    content.innerHTML = `
      <div class="chat-container">
        <div style="padding:10px 16px;background:var(--bg-card);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <button class="page-back" onclick="App.navigate('dm')"><i class="fas fa-arrow-left"></i></button>
          <span style="font-weight:700;font-size:16px">1:1 채팅</span>
        </div>
        <div class="chat-messages" id="dm-messages"></div>
        <div class="typing-indicator" id="typing-indicator"></div>
        <div class="chat-input-area">
          <input type="text" class="chat-input" id="dm-input" placeholder="메시지를 입력하세요..." onkeypress="if(event.key==='Enter')App.sendDMMessage()">
          <button class="chat-send-btn" onclick="App.sendDMMessage()"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    `;

    try {
      const data = await this.api(`/api/dm/${roomId}/messages`);
      const container = document.getElementById('dm-messages');
      data.messages.forEach(msg => this.appendDMMessage(msg, false));
      container.scrollTop = container.scrollHeight;
    } catch (e) {}

    const dmInput = document.getElementById('dm-input');
    dmInput.addEventListener('input', () => { this.socket.emit('dmTyping', { roomId }); });
  },

  appendDMMessage(msg, scroll = true) {
    const container = document.getElementById('dm-messages');
    if (!container) return;
    const isOwn = msg.sender_id === this.user.id;
    const div = document.createElement('div');
    div.className = `chat-msg ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
      ${!isOwn ? `<img class="chat-msg-avatar" src="${msg.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">` : ''}
      <div class="chat-msg-body">
        ${!isOwn ? `<div class="chat-msg-name">${this.escapeHtml(msg.nickname)}</div>` : ''}
        <div class="chat-bubble">${this.escapeHtml(msg.content)}</div>
        <div class="chat-time">${this.formatTimeShort(msg.created_at)} ${isOwn ? `<span class="dm-read-status">${msg.is_read ? '읽음' : ''}</span>` : ''}</div>
      </div>
    `;
    container.appendChild(div);
    if (scroll) container.scrollTop = container.scrollHeight;
  },

  sendDMMessage() {
    const input = document.getElementById('dm-input');
    const content = input.value.trim();
    if (!content || !this.currentDMRoom) return;
    this.socket.emit('dmMessage', { roomId: this.currentDMRoom, content });
    input.value = '';
  },

  async startDM(targetId) {
    try {
      const data = await this.api('/api/dm/start', { method: 'POST', body: { targetId } });
      this.openDM(data.room.id);
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== ROOMS ====================
  async renderRooms() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/rooms');
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0"><i class="fas fa-door-open page-title-icon" style="color:var(--primary)"></i> 수다방</div>
          ${this.user.level >= 19 || this.user.role === 'admin' ? '<button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateRoom()"><i class="fas fa-plus"></i> 방 만들기</button>' : ''}
        </div>
        <div class="tabs">
          <div class="tab active" onclick="App.filterRooms('all', this)">전체</div>
          <div class="tab" onclick="App.filterRooms('public', this)">공개</div>
          <div class="tab" onclick="App.filterRooms('password', this)">비밀번호</div>
        </div>
        <div id="rooms-list">
          ${data.rooms.map(r => `
            <div class="room-card" data-type="${r.type}" onclick="App.joinRoom(${r.id}, '${r.type}')">
              <div class="room-icon">${r.type === 'private' ? '🔒' : r.type === 'password' ? '🔑' : '💬'}</div>
              <div class="room-info">
                <div class="room-name">${this.escapeHtml(r.name)}</div>
                <div class="room-desc">${this.escapeHtml(r.description || '')}</div>
                <div class="room-meta"><i class="fas fa-users"></i> ${r.member_count}명 · ${this.escapeHtml(r.owner_name)}</div>
              </div>
              <span class="room-type-badge badge-${r.type}">${r.type === 'public' ? '공개' : r.type === 'private' ? '비공개' : '비밀번호'}</span>
            </div>
          `).join('')}
          ${data.rooms.length === 0 ? '<div class="empty-state"><i class="fas fa-door-open"></i><p>수다방이 없습니다.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  filterRooms(type, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.room-card').forEach(c => {
      c.style.display = type === 'all' || c.dataset.type === type ? 'flex' : 'none';
    });
  },

  showCreateRoom() {
    this.showModal('수다방 만들기', `
      <div class="form-group"><label class="form-label">방 이름</label><input type="text" class="form-input" id="room-name" placeholder="방 이름"></div>
      <div class="form-group"><label class="form-label">설명</label><input type="text" class="form-input" id="room-desc" placeholder="방 설명"></div>
      <div class="form-group">
        <label class="form-label">유형</label>
        <select class="form-select" id="room-type" onchange="document.getElementById('room-pw-group').style.display=this.value==='password'?'block':'none'">
          <option value="public">공개</option>
          <option value="private">비공개</option>
          <option value="password">비밀번호</option>
        </select>
      </div>
      <div class="form-group" id="room-pw-group" style="display:none">
        <label class="form-label">비밀번호</label>
        <input type="text" class="form-input" id="room-password" placeholder="비밀번호">
      </div>
      <p style="font-size:13px;color:var(--warning);margin-bottom:16px"><i class="fas fa-coins"></i> 10코인이 차감됩니다 (보유: ${this.user.coins}코인)</p>
    `, async () => {
      try {
        const data = await this.api('/api/rooms', { method: 'POST', body: {
          name: document.getElementById('room-name').value,
          description: document.getElementById('room-desc').value,
          type: document.getElementById('room-type').value,
          password: document.getElementById('room-password').value
        }});
        this.closeModal();
        this.showToast(data.message + (data.password ? ` 비밀번호: ${data.password}` : ''), 'success');
        this.user.coins -= 10;
        this.renderRooms();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async joinRoom(roomId, type) {
    if (type === 'password') {
      this.showModal('비밀번호 입력', `
        <div class="form-group"><label class="form-label">비밀번호</label><input type="password" class="form-input" id="join-password" placeholder="비밀번호를 입력하세요"></div>
      `, async () => {
        try {
          await this.api(`/api/rooms/${roomId}/join`, { method: 'POST', body: { password: document.getElementById('join-password').value } });
          this.closeModal();
          this.currentChatRoom = roomId;
          this.currentPage = 'chat';
          this.loadChatRoom(roomId);
        } catch (e) { this.showToast(e.message, 'error'); }
      });
    } else if (type === 'private') {
      this.showToast('비공개 수다방입니다. 초대가 필요합니다.', 'warning');
    } else {
      try {
        await this.api(`/api/rooms/${roomId}/join`, { method: 'POST' });
        this.currentChatRoom = roomId;
        this.currentPage = 'chat';
        this.loadChatRoom(roomId);
      } catch (e) {
        if (e.message.includes('이미 참여')) {
          this.currentChatRoom = roomId;
          this.currentPage = 'chat';
          this.loadChatRoom(roomId);
        } else {
          this.showToast(e.message, 'error');
        }
      }
    }
  },

  // ==================== BOARD ====================
  async renderBoard(page = 1) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/posts?page=${page}`);
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0"><i class="fas fa-pen page-title-icon" style="color:var(--primary)"></i> 자유게시판</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.navigate('ranking')"><i class="fas fa-trophy"></i></button>
            <button class="btn btn-primary btn-small btn-pill" onclick="App.showWritePost()"><i class="fas fa-pen"></i> 글쓰기</button>
          </div>
        </div>
        <div id="posts-list">
          ${data.posts.map(p => this.renderPostCard(p)).join('')}
          ${data.posts.length === 0 ? '<div class="empty-state"><i class="fas fa-pen"></i><p>게시글이 없습니다.<br>첫 번째 글을 작성해보세요!</p></div>' : ''}
        </div>
        ${this.renderPagination(data.page, data.totalPages, 'App.renderBoard')}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  renderPostCard(p) {
    return `
      <div class="post-card ${p.is_notice ? 'notice' : ''}" onclick="App.viewPost(${p.id})">
        <div class="post-header">
          <img class="post-avatar" src="${p.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" onclick="event.stopPropagation();App.renderProfile(${p.user_id})">
          <div>
            <div class="post-author">${this.escapeHtml(p.nickname)} <span class="post-level">Lv.${p.level}</span></div>
            <div class="post-meta">${this.formatTime(p.created_at)}</div>
          </div>
          ${p.is_notice ? '<span class="badge badge-admin">공지</span>' : ''}
        </div>
        <div class="post-title">${this.escapeHtml(p.title)}</div>
        <div class="post-content" style="max-height:60px;overflow:hidden">${this.escapeHtml(p.content)}</div>
        <div class="post-stats">
          <span><i class="fas fa-heart"></i> ${p.hearts}</span>
          <span><i class="fas fa-comment"></i> ${p.comment_count}</span>
          <span><i class="fas fa-eye"></i> ${p.views}</span>
        </div>
      </div>
    `;
  },

  showWritePost() {
    this.showModal('글쓰기', `
      <div class="form-group"><label class="form-label">제목</label><input type="text" class="form-input" id="post-title" placeholder="제목을 입력하세요"></div>
      <div class="form-group"><label class="form-label">내용</label><textarea class="form-input" id="post-content" rows="8" placeholder="내용을 입력하세요" style="resize:vertical"></textarea></div>
    `, async () => {
      try {
        await this.api('/api/posts', { method: 'POST', body: {
          title: document.getElementById('post-title').value,
          content: document.getElementById('post-content').value
        }});
        this.closeModal();
        this.showToast('게시글이 작성되었습니다!', 'success');
        this.user.exp++;
        this.renderBoard();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async viewPost(postId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/posts/${postId}`);
      const p = data.post;
      const comments = data.comments;

      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('board')"><i class="fas fa-arrow-left"></i></button>
          <span style="font-size:16px;font-weight:700">게시글</span>
        </div>
        <div class="card">
          <div class="post-header">
            <img class="post-avatar" src="${p.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" style="cursor:pointer" onclick="App.renderProfile(${p.user_id})">
            <div style="flex:1">
              <div class="post-author">${this.escapeHtml(p.nickname)} <span class="post-level">Lv.${p.level}</span></div>
              <div class="post-meta">${this.formatTime(p.created_at)} · 조회 ${p.views}</div>
            </div>
            ${p.user_id === this.user.id || this.user.role === 'admin' ? `
              <div style="display:flex;gap:4px">
                <button class="btn-icon" onclick="App.editPost(${p.id}, '${this.escapeHtml(p.title)}', \`${p.content.replace(/`/g, '\\`')}\`)"><i class="fas fa-edit"></i></button>
                <button class="btn-icon" style="color:var(--danger)" onclick="App.deletePost(${p.id})"><i class="fas fa-trash"></i></button>
              </div>
            ` : `
              <button class="btn-icon" onclick="App.reportItem('post', ${p.id})"><i class="fas fa-flag"></i></button>
            `}
          </div>
          <h2 class="post-title" style="font-size:20px;margin-bottom:16px">${this.escapeHtml(p.title)}</h2>
          <div class="post-content" style="white-space:pre-wrap;max-height:none;line-height:1.7">${this.escapeHtml(p.content)}</div>
          <div class="post-stats" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
            <span class="heart-btn ${p.isHearted ? 'active' : ''}" onclick="App.toggleHeart(${p.id})">
              <i class="fas fa-heart"></i> <span id="heart-count">${p.hearts}</span>
            </span>
            <span><i class="fas fa-comment"></i> ${comments.length}</span>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">댓글 (${comments.length})</div></div>
          <div id="comments-list">
            ${comments.map(c => `
              <div class="comment-item" id="comment-${c.id}">
                <img class="comment-avatar" src="${c.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" onclick="App.renderProfile(${c.user_id})" style="cursor:pointer">
                <div class="comment-body">
                  <div class="comment-name">${this.escapeHtml(c.nickname)} <span class="post-level">Lv.${c.level}</span></div>
                  <div class="comment-text">${this.escapeHtml(c.content)}</div>
                  <div class="comment-meta">
                    <span>${this.formatTime(c.created_at)}</span>
                    <span class="comment-like ${c.isLiked ? 'active' : ''}" onclick="App.toggleCommentLike(${c.id})"><i class="fas fa-thumbs-up"></i> <span id="clike-${c.id}">${c.likes}</span></span>
                    ${c.user_id === this.user.id || this.user.role === 'admin' ? `<span onclick="App.deleteComment(${c.id})" style="cursor:pointer;color:var(--danger)"><i class="fas fa-trash"></i></span>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="comment-input-area">
            <input type="text" class="comment-input" id="comment-input" placeholder="댓글을 입력하세요..." onkeypress="if(event.key==='Enter')App.submitComment(${postId})">
            <button class="chat-send-btn" onclick="App.submitComment(${postId})"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async toggleHeart(postId) {
    try {
      const data = await this.api(`/api/posts/${postId}/heart`, { method: 'POST' });
      document.getElementById('heart-count').textContent = data.hearts;
      const btn = document.querySelector('.heart-btn');
      btn.classList.toggle('active', data.hearted);
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async submitComment(postId) {
    const input = document.getElementById('comment-input');
    const content = input.value.trim();
    if (!content) return;
    try {
      await this.api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content } });
      input.value = '';
      this.user.exp++;
      this.viewPost(postId);
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async toggleCommentLike(commentId) {
    try {
      const data = await this.api(`/api/comments/${commentId}/like`, { method: 'POST' });
      const el = document.getElementById(`clike-${commentId}`);
      if (el) el.textContent = data.likes;
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async deletePost(postId) {
    if (!confirm('게시글을 삭제하시겠습니까?')) return;
    try {
      await this.api(`/api/posts/${postId}`, { method: 'DELETE' });
      this.showToast('게시글이 삭제되었습니다.', 'success');
      this.renderBoard();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async deleteComment(commentId) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    try {
      await this.api(`/api/comments/${commentId}`, { method: 'DELETE' });
      document.getElementById(`comment-${commentId}`)?.remove();
      this.showToast('댓글이 삭제되었습니다.', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  editPost(id, title, content) {
    this.showModal('게시글 수정', `
      <div class="form-group"><label class="form-label">제목</label><input type="text" class="form-input" id="edit-title" value="${title}"></div>
      <div class="form-group"><label class="form-label">내용</label><textarea class="form-input" id="edit-content" rows="8" style="resize:vertical">${content}</textarea></div>
    `, async () => {
      try {
        await this.api(`/api/posts/${id}`, { method: 'PUT', body: {
          title: document.getElementById('edit-title').value,
          content: document.getElementById('edit-content').value
        }});
        this.closeModal();
        this.showToast('게시글이 수정되었습니다.', 'success');
        this.viewPost(id);
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  // ==================== FRIENDS ====================
  async renderFriends() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/friends');
      const accepted = data.friends.filter(f => f.status === 'accepted');
      const pending = data.friends.filter(f => f.status === 'pending');

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0"><i class="fas fa-user-friends page-title-icon" style="color:var(--primary)"></i> 친구 (${accepted.length})</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showAddFriend()"><i class="fas fa-user-plus"></i> 추가</button>
        </div>
        ${pending.length > 0 ? `
          <div class="card">
            <div class="card-header"><div class="card-title">대기 중인 요청 (${pending.length})</div></div>
            ${pending.map(f => `
              <div class="friend-card">
                <img class="friend-avatar" src="${f.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
                <div class="friend-info">
                  <div class="friend-name">${this.escapeHtml(f.nickname)} <span class="post-level">Lv.${f.level}</span></div>
                  <div class="friend-status">${f.direction === 'received' ? '요청 받음' : '요청 보냄'}</div>
                </div>
                <div class="friend-actions">
                  ${f.direction === 'received' ? `
                    <button class="btn btn-success btn-small" onclick="App.acceptFriend(${f.friendship_id})">수락</button>
                    <button class="btn btn-danger btn-small" onclick="App.rejectFriend(${f.friendship_id})">거절</button>
                  ` : '<span style="font-size:13px;color:var(--text-muted)">대기 중</span>'}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="card" style="padding:0 16px">
          ${accepted.map(f => `
            <div class="friend-card">
              <img class="friend-avatar" src="${f.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" onclick="App.renderProfile(${f.id})" style="cursor:pointer">
              <div class="friend-info">
                <div class="friend-name">${this.escapeHtml(f.nickname)} <span class="post-level">Lv.${f.level}</span></div>
                <div class="friend-status"><span class="online-dot ${f.is_online ? 'online' : 'offline'}"></span> ${f.is_online ? '온라인' : '오프라인'}</div>
              </div>
              <div class="friend-actions">
                <button class="btn-icon" onclick="App.startDM(${f.id})" title="채팅"><i class="fas fa-comment"></i></button>
                <button class="btn-icon" onclick="App.deleteFriend(${f.friendship_id})" title="삭제"><i class="fas fa-user-minus"></i></button>
              </div>
            </div>
          `).join('')}
          ${accepted.length === 0 ? '<div class="empty-state"><i class="fas fa-user-friends"></i><p>아직 친구가 없습니다.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showAddFriend() {
    this.showModal('친구 추가', `
      <div class="form-group"><label class="form-label">닉네임 검색</label><input type="text" class="form-input" id="friend-search" placeholder="닉네임을 입력하세요" onkeyup="App.searchFriend()"></div>
      <div id="friend-results"></div>
    `);
  },

  async searchFriend() {
    const q = document.getElementById('friend-search').value;
    if (q.length < 1) return;
    try {
      const data = await this.api(`/api/users/search/${encodeURIComponent(q)}`);
      document.getElementById('friend-results').innerHTML = data.users.map(u => `
        <div class="friend-card">
          <img class="friend-avatar" src="${u.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
          <div class="friend-info">
            <div class="friend-name">${this.escapeHtml(u.nickname)} <span class="post-level">Lv.${u.level}</span></div>
          </div>
          <button class="btn btn-primary btn-small" onclick="App.sendFriendRequest(${u.id})">친구 추가</button>
        </div>
      `).join('') || '<p style="text-align:center;color:var(--text-muted);padding:16px">검색 결과가 없습니다.</p>';
    } catch (e) {}
  },

  async sendFriendRequest(targetId) {
    try {
      await this.api('/api/friends/request', { method: 'POST', body: { targetId } });
      this.showToast('친구 요청을 보냈습니다!', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async acceptFriend(id) {
    try {
      await this.api(`/api/friends/accept/${id}`, { method: 'PUT' });
      this.showToast('친구 요청을 수락했습니다!', 'success');
      this.renderFriends();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async rejectFriend(id) {
    try {
      await this.api(`/api/friends/reject/${id}`, { method: 'PUT' });
      this.renderFriends();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async deleteFriend(id) {
    if (!confirm('친구를 삭제하시겠습니까?')) return;
    try {
      await this.api(`/api/friends/${id}`, { method: 'DELETE' });
      this.renderFriends();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== SHOP ====================
  async renderShop() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/shop');
      const categories = { frame: '프로필 프레임', background: '채팅 배경', nickname: '닉네임 꾸미기', badge: '뱃지' };

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0"><i class="fas fa-store page-title-icon" style="color:var(--primary)"></i> 상점</div>
          <div style="display:flex;gap:12px;align-items:center">
            <span class="top-header-coins"><i class="fas fa-coins"></i> ${this.user.coins}</span>
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.navigate('inventory')"><i class="fas fa-box"></i></button>
          </div>
        </div>
        ${Object.entries(categories).map(([cat, label]) => {
          const items = data.items.filter(i => i.category === cat);
          if (items.length === 0) return '';
          return `
            <h3 style="margin:20px 0 12px;font-size:15px;font-weight:700">${label}</h3>
            <div class="shop-grid">
              ${items.map(item => `
                <div class="shop-item">
                  <div class="shop-item-icon">${item.image}</div>
                  <div class="shop-item-name">${this.escapeHtml(item.name)}</div>
                  <div class="shop-item-desc">${this.escapeHtml(item.description)}</div>
                  <div class="shop-item-price"><i class="fas fa-coins"></i> ${item.price}</div>
                  ${data.inventory.includes(item.id)
                    ? '<button class="btn btn-secondary btn-small" disabled>보유 중</button>'
                    : `<button class="btn btn-primary btn-small" onclick="App.buyItem(${item.id})">구매하기</button>`
                  }
                </div>
              `).join('')}
            </div>
          `;
        }).join('')}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async buyItem(itemId) {
    if (!confirm('이 아이템을 구매하시겠습니까?')) return;
    try {
      const data = await this.api(`/api/shop/buy/${itemId}`, { method: 'POST' });
      this.user.coins = data.coins;
      this.showToast(data.message, 'success');
      this.renderShop();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async renderInventory() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/inventory');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('shop')"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">보관함</div>
        </div>
        <div class="shop-grid">
          ${data.items.map(item => `
            <div class="shop-item" style="${item.is_equipped ? 'border:2px solid var(--primary)' : ''}">
              <div class="shop-item-icon">${item.image}</div>
              <div class="shop-item-name">${this.escapeHtml(item.name)}</div>
              <div class="shop-item-desc">${this.escapeHtml(item.description)}</div>
              ${item.is_equipped
                ? '<span style="color:var(--primary);font-weight:600;font-size:13px">장착 중</span>'
                : `<button class="btn btn-primary btn-small" onclick="App.equipItem(${item.id})">장착</button>`
              }
            </div>
          `).join('')}
          ${data.items.length === 0 ? '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-box-open"></i><p>보관함이 비어있습니다.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async equipItem(id) {
    try {
      await this.api(`/api/inventory/equip/${id}`, { method: 'POST' });
      this.showToast('아이템을 장착했습니다!', 'success');
      this.renderInventory();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== ATTENDANCE ====================
  async renderAttendance() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/attendance');
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstDay = new Date(year, month, 1).getDay();

      let calendarHtml = '<div class="calendar-grid">';
      ['일','월','화','수','목','금','토'].forEach(d => calendarHtml += `<div class="calendar-day-name">${d}</div>`);
      for (let i = 0; i < firstDay; i++) calendarHtml += '<div class="calendar-day"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const checked = data.calendar.includes(dateStr);
        const isToday = d === now.getDate();
        calendarHtml += `<div class="calendar-day ${checked ? 'checked' : ''} ${isToday ? 'today' : ''}">${d}</div>`;
      }
      calendarHtml += '</div>';

      content.innerHTML = `
        <div class="page-title"><i class="fas fa-calendar-check page-title-icon" style="color:var(--primary)"></i> 출석 체크</div>
        <div class="stats-grid" style="margin-bottom:20px">
          <div class="stat-card">
            <div class="stat-icon" style="background:#6C63FF20;color:var(--primary)"><i class="fas fa-calendar-check"></i></div>
            <div class="stat-value">${data.totalDays}</div>
            <div class="stat-label">총 출석</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:#FF6B9D20;color:var(--secondary)"><i class="fas fa-fire"></i></div>
            <div class="stat-value">${data.streak}</div>
            <div class="stat-label">연속 출석</div>
          </div>
        </div>
        <div class="card">
          <div style="text-align:center;margin-bottom:20px">
            ${data.checked
              ? '<div style="font-size:48px;margin-bottom:8px">✅</div><p style="color:var(--success);font-weight:700;font-size:16px">오늘 출석 완료!</p>'
              : `<button class="btn btn-primary btn-full" onclick="App.checkAttendance()" style="font-size:16px;padding:16px"><i class="fas fa-check"></i> 출석하기</button>`
            }
          </div>
          <h3 style="margin-bottom:12px;font-size:15px">${year}년 ${month + 1}월</h3>
          ${calendarHtml}
          <p style="margin-top:16px;font-size:13px;color:var(--text-muted)"><i class="fas fa-info-circle"></i> 10일 연속 출석 시 100코인 보상!</p>
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async checkAttendance() {
    try {
      const data = await this.api('/api/attendance', { method: 'POST' });
      this.showToast(`출석 완료! 연속 ${data.streak}일 🔥`, 'success');
      this.renderAttendance();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== RANKING ====================
  async renderRanking() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-title"><i class="fas fa-trophy page-title-icon" style="color:#FFD700"></i> 랭킹</div>
      <div class="tabs">
        <div class="tab active" onclick="App.loadRanking('hearts', this)">하트</div>
        <div class="tab" onclick="App.loadRanking('comments', this)">댓글</div>
        <div class="tab" onclick="App.loadRanking('views', this)">조회수</div>
        <div class="tab" onclick="App.loadRanking('users', this)">사용자</div>
      </div>
      <div class="card" id="ranking-list" style="padding:0 16px"></div>
    `;
    this.loadRanking('hearts', document.querySelector('.tab.active'));
  },

  async loadRanking(type, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const container = document.getElementById('ranking-list');

    try {
      if (type === 'users') {
        const data = await this.api('/api/ranking/users');
        container.innerHTML = data.users.map((u, i) => `
          <div class="rank-item" onclick="App.renderProfile(${u.id})">
            <div class="rank-number ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</div>
            <img class="post-avatar" src="${u.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" style="width:36px;height:36px">
            <div class="rank-info">
              <div class="rank-title">${this.escapeHtml(u.nickname)}</div>
              <div class="rank-stats"><span>Lv.${u.level}</span> <span>EXP ${u.exp}</span></div>
            </div>
          </div>
        `).join('');
      } else {
        const data = await this.api(`/api/ranking/posts?type=${type}`);
        container.innerHTML = data.posts.map((p, i) => `
          <div class="rank-item" onclick="App.viewPost(${p.id})">
            <div class="rank-number ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</div>
            <div class="rank-info">
              <div class="rank-title">${this.escapeHtml(p.title)}</div>
              <div class="rank-author">${this.escapeHtml(p.nickname)}</div>
            </div>
            <div class="rank-stats">
              <span><i class="fas fa-heart"></i> ${p.hearts}</span>
              <span><i class="fas fa-comment"></i> ${p.comment_count}</span>
            </div>
          </div>
        `).join('');
      }
    } catch (e) { container.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  // ==================== NOTIFICATIONS ====================
  async renderNotifications() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/notifications');
      await this.api('/api/notifications/read', { method: 'PUT' });
      this.unreadNotifs = 0;
      this.updateNotifBadge();

      const iconMap = {
        friend_request: { icon: 'fa-user-plus', color: '#6C63FF' },
        friend_accepted: { icon: 'fa-user-check', color: '#2ED573' },
        dm: { icon: 'fa-envelope', color: '#1E90FF' },
        heart: { icon: 'fa-heart', color: '#FF6B9D' },
        comment: { icon: 'fa-comment', color: '#FFA502' },
        level_up: { icon: 'fa-star', color: '#FFD700' },
        coin: { icon: 'fa-coins', color: '#FFA502' },
        report_result: { icon: 'fa-flag', color: '#FF4757' },
        school_announcement: { icon: 'fa-bullhorn', color: '#E040FB' },
        student_warning: { icon: 'fa-exclamation-triangle', color: '#FF4757' },
      };

      content.innerHTML = `
        <div class="page-title"><i class="fas fa-bell page-title-icon" style="color:var(--primary)"></i> 알림</div>
        <div class="card" style="padding:0">
          ${data.notifications.map(n => {
            const ic = iconMap[n.type] || { icon: 'fa-bell', color: '#6C63FF' };
            return `
              <div class="notif-item ${n.is_read ? '' : 'unread'}">
                <div class="notif-icon" style="background:${ic.color}20;color:${ic.color}"><i class="fas ${ic.icon}"></i></div>
                <div class="notif-content">
                  <div class="notif-title">${this.escapeHtml(n.title)}</div>
                  <div class="notif-message">${this.escapeHtml(n.message)}</div>
                  <div class="notif-time">${this.formatTime(n.created_at)}</div>
                </div>
              </div>
            `;
          }).join('')}
          ${data.notifications.length === 0 ? '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>알림이 없습니다.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  // ==================== PROFILE ====================
  async renderProfile(userId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/users/${userId}`);
      const u = data.user;
      const isMe = u.id === this.user.id;
      const expForNext = (u.level * 5) - u.exp;
      const progress = ((u.exp % 5) / 5 * 100);

      content.innerHTML = `
        <div class="profile-header">
          <img class="profile-avatar-lg" src="${u.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
          <div class="profile-nickname">${this.escapeHtml(u.nickname)}</div>
          <div class="profile-level-badge">Lv.${u.level} · ${u.role === 'admin' ? '관리자' : u.role === 'teacher' ? '선생님' : u.role === 'student' ? '학생' : '일반'}</div>
          ${u.bio ? `<div class="profile-bio">${this.escapeHtml(u.bio)}</div>` : ''}
          <div style="margin-top:12px;max-width:200px;margin-left:auto;margin-right:auto">
            <div style="font-size:12px;opacity:0.8">다음 레벨까지 ${expForNext > 0 ? expForNext : 0}</div>
            <div class="level-bar" style="background:rgba(255,255,255,0.2)"><div class="level-bar-fill" style="width:${progress}%;background:white"></div></div>
          </div>
          <div class="profile-stats-grid">
            <div class="profile-stat"><div class="profile-stat-value">${u.stats.postCount}</div><div class="profile-stat-label">게시글</div></div>
            <div class="profile-stat"><div class="profile-stat-value">${u.stats.commentCount}</div><div class="profile-stat-label">댓글</div></div>
            <div class="profile-stat"><div class="profile-stat-value">${u.stats.heartCount}</div><div class="profile-stat-label">하트</div></div>
            <div class="profile-stat"><div class="profile-stat-value">${u.stats.friendCount}</div><div class="profile-stat-label">친구</div></div>
            <div class="profile-stat"><div class="profile-stat-value">${u.stats.attendanceCount}</div><div class="profile-stat-label">출석</div></div>
            ${isMe ? `<div class="profile-stat"><div class="profile-stat-value">${this.user.coins}</div><div class="profile-stat-label">코인</div></div>` : ''}
          </div>
        </div>
        ${!isMe ? `
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <button class="btn btn-primary btn-small btn-pill" onclick="App.sendFriendRequest(${u.id})"><i class="fas fa-user-plus"></i> 친구 추가</button>
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.startDM(${u.id})"><i class="fas fa-comment"></i> 채팅</button>
            <button class="btn btn-outline btn-small btn-pill" onclick="App.reportItem('user', ${u.id})"><i class="fas fa-flag"></i> 신고</button>
            <button class="btn btn-danger btn-small btn-pill" onclick="App.blockUser(${u.id})"><i class="fas fa-ban"></i> 차단</button>
          </div>
        ` : `
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.navigate('coins')"><i class="fas fa-coins"></i> 코인 내역</button>
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.navigate('inventory')"><i class="fas fa-box"></i> 보관함</button>
            <button class="btn btn-secondary btn-small btn-pill" onclick="App.navigate('settings')"><i class="fas fa-cog"></i> 설정</button>
          </div>
        `}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async blockUser(targetId) {
    if (!confirm('이 사용자를 차단하시겠습니까?')) return;
    try {
      await this.api('/api/blocks', { method: 'POST', body: { targetId } });
      this.showToast('사용자를 차단했습니다.', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== COINS ====================
  async renderCoins() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/coins');
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('profile')"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">코인 내역</div>
        </div>
        <div class="card" style="text-align:center;margin-bottom:16px">
          <div style="font-size:14px;color:var(--text-muted)">보유 코인</div>
          <div style="font-size:36px;font-weight:800;color:var(--coin)"><i class="fas fa-coins"></i> ${data.coins}</div>
        </div>
        <div class="card" style="padding:0 16px">
          ${data.transactions.map(t => `
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
              <div>
                <div style="font-weight:700;color:${t.amount > 0 ? 'var(--success)' : 'var(--danger)'}">${t.amount > 0 ? '+' : ''}${t.amount} COIN</div>
                <div style="font-size:13px;color:var(--text-secondary)">${this.escapeHtml(t.reason)}</div>
              </div>
              <div style="font-size:12px;color:var(--text-muted);white-space:nowrap">${this.formatTime(t.created_at)}</div>
            </div>
          `).join('')}
          ${data.transactions.length === 0 ? '<div class="empty-state"><p>거래 내역이 없습니다.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  // ==================== SETTINGS ====================
  renderSettings() {
    const content = document.getElementById('page-content');
    const isTeacher = this.user.role === 'teacher';
    const isStudent = this.user.role === 'student';
    const isAdmin = this.user.role === 'admin';

    content.innerHTML = `
      <div class="page-title"><i class="fas fa-cog page-title-icon" style="color:var(--text-secondary)"></i> 더보기</div>

      <!-- Profile quick -->
      <div class="profile-card" onclick="App.navigate('profile')" style="cursor:pointer;margin-bottom:16px">
        <img class="profile-card-avatar" src="${this.user.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
        <div class="profile-card-info">
          <div class="profile-card-name">${this.escapeHtml(this.user.nickname)}</div>
          <div class="profile-card-level">Lv.${this.user.level} · ${this.user.coins} 코인</div>
        </div>
        <i class="fas fa-chevron-right" style="color:var(--text-muted)"></i>
      </div>

      <!-- Quick links grid -->
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card" onclick="App.navigate('board')" style="cursor:pointer">
          <div class="stat-icon" style="background:#6C63FF20;color:var(--primary)"><i class="fas fa-pen"></i></div>
          <div class="stat-label">게시판</div>
        </div>
        <div class="stat-card" onclick="App.navigate('friends')" style="cursor:pointer">
          <div class="stat-icon" style="background:#2ED57320;color:var(--success)"><i class="fas fa-user-friends"></i></div>
          <div class="stat-label">친구</div>
        </div>
        <div class="stat-card" onclick="App.navigate('chat')" style="cursor:pointer">
          <div class="stat-icon" style="background:#FF6B9D20;color:var(--secondary)"><i class="fas fa-comments"></i></div>
          <div class="stat-label">채팅</div>
        </div>
        <div class="stat-card" onclick="App.navigate('ranking')" style="cursor:pointer">
          <div class="stat-icon" style="background:#FFD70020;color:#FFD700"><i class="fas fa-trophy"></i></div>
          <div class="stat-label">랭킹</div>
        </div>
      </div>

      ${isTeacher ? `
      <div class="card" style="padding:0;margin-bottom:12px">
        <div class="settings-item" onclick="App.navigate('school')"><div class="settings-item-left"><i class="fas fa-school" style="color:#3B82F6"></i><span class="settings-item-label">학교 관리</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
        <div class="settings-item" onclick="App.navigate('students')"><div class="settings-item-left"><i class="fas fa-user-graduate" style="color:#3B82F6"></i><span class="settings-item-label">학생 관리</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
        <div class="settings-item" onclick="App.navigate('school-attendance')"><div class="settings-item-left"><i class="fas fa-clipboard-check" style="color:#3B82F6"></i><span class="settings-item-label">출결 관리</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
        <div class="settings-item" onclick="App.navigate('school-announcements')"><div class="settings-item-left"><i class="fas fa-bullhorn" style="color:#3B82F6"></i><span class="settings-item-label">공지사항</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
        <div class="settings-item" onclick="App.navigate('school-albums')"><div class="settings-item-left"><i class="fas fa-images" style="color:#3B82F6"></i><span class="settings-item-label">앨범</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
        <div class="settings-item" onclick="App.navigate('teacher-chat')"><div class="settings-item-left"><i class="fas fa-chalkboard-teacher" style="color:#3B82F6"></i><span class="settings-item-label">선생님 채팅</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
      </div>
      ` : ''}

      ${isAdmin ? `
      <div class="card" style="padding:0;margin-bottom:12px">
        <div class="settings-item" onclick="App.navigate('admin')"><div class="settings-item-left"><i class="fas fa-shield-alt" style="color:var(--danger)"></i><span class="settings-item-label" style="color:var(--danger)">관리자 대시보드</span></div><i class="fas fa-chevron-right" style="color:var(--text-muted)"></i></div>
      </div>
      ` : ''}

      <div class="card" style="padding:0">
        <div class="settings-item" onclick="App.showEditProfile()">
          <div class="settings-item-left"><i class="fas fa-user"></i><span class="settings-item-label">프로필 수정</span></div>
          <i class="fas fa-chevron-right" style="color:var(--text-muted)"></i>
        </div>
        <div class="settings-item" onclick="App.showChangePassword()">
          <div class="settings-item-left"><i class="fas fa-lock"></i><span class="settings-item-label">비밀번호 변경</span></div>
          <i class="fas fa-chevron-right" style="color:var(--text-muted)"></i>
        </div>
        <div class="settings-item">
          <div class="settings-item-left"><i class="fas fa-${this.user.theme === 'dark' ? 'moon' : 'sun'}"></i><span class="settings-item-label">${this.user.theme === 'dark' ? '다크 모드' : '라이트 모드'}</span></div>
          <div class="toggle ${this.user.theme === 'dark' ? 'active' : ''}" onclick="App.toggleTheme()"></div>
        </div>
        <div class="settings-item" onclick="App.showBlockList()">
          <div class="settings-item-left"><i class="fas fa-ban"></i><span class="settings-item-label">차단 목록</span></div>
          <i class="fas fa-chevron-right" style="color:var(--text-muted)"></i>
        </div>
        <div class="settings-item" onclick="App.logout()">
          <div class="settings-item-left"><i class="fas fa-sign-out-alt" style="color:var(--danger)"></i><span class="settings-item-label" style="color:var(--danger)">로그아웃</span></div>
        </div>
        <div class="settings-item" onclick="App.deleteAccount()">
          <div class="settings-item-left"><i class="fas fa-user-slash" style="color:var(--danger)"></i><span class="settings-item-label" style="color:var(--danger)">회원 탈퇴</span></div>
        </div>
      </div>
    `;
  },

  showEditProfile() {
    this.showModal('프로필 수정', `
      <div class="form-group" style="text-align:center">
        <div class="profile-upload" onclick="document.getElementById('edit-profile-img').click()">
          <img src="${this.user.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'" id="edit-preview">
        </div>
        <input type="file" id="edit-profile-img" accept="image/*" style="display:none" onchange="App.previewEditImage(this)">
      </div>
      <div class="form-group"><label class="form-label">닉네임</label><input type="text" class="form-input" id="edit-nickname" value="${this.escapeHtml(this.user.nickname)}"></div>
      <div class="form-group"><label class="form-label">자기소개</label><textarea class="form-input" id="edit-bio" rows="3">${this.escapeHtml(this.user.bio || '')}</textarea></div>
    `, async () => {
      try {
        const formData = new FormData();
        formData.append('nickname', document.getElementById('edit-nickname').value);
        formData.append('bio', document.getElementById('edit-bio').value);
        const fileInput = document.getElementById('edit-profile-img');
        if (fileInput.files[0]) formData.append('profileImage', fileInput.files[0]);
        const res = await fetch('/api/users/profile', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${this.token}` },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        Object.assign(this.user, data.user);
        this.closeModal();
        this.showToast('프로필이 수정되었습니다!', 'success');
        this.render();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  previewEditImage(input) {
    if (input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => { document.getElementById('edit-preview').src = e.target.result; };
      reader.readAsDataURL(input.files[0]);
    }
  },

  showChangePassword() {
    this.showModal('비밀번호 변경', `
      <div class="form-group"><label class="form-label">현재 비밀번호</label><input type="password" class="form-input" id="cur-pw"></div>
      <div class="form-group"><label class="form-label">새 비밀번호</label><input type="password" class="form-input" id="new-pw"></div>
    `, async () => {
      try {
        await this.api('/api/users/password', { method: 'PUT', body: {
          currentPassword: document.getElementById('cur-pw').value,
          newPassword: document.getElementById('new-pw').value
        }});
        this.closeModal();
        this.showToast('비밀번호가 변경되었습니다!', 'success');
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async toggleTheme() {
    const newTheme = this.user.theme === 'dark' ? 'light' : 'dark';
    this.user.theme = newTheme;
    this.applyTheme(newTheme);
    try { await this.api('/api/users/theme', { method: 'PUT', body: { theme: newTheme } }); } catch (e) {}
    this.renderSettings();
  },

  async showBlockList() {
    try {
      const data = await this.api('/api/blocks');
      this.showModal('차단 목록', data.blocks.length === 0
        ? '<div class="empty-state"><p>차단한 사용자가 없습니다.</p></div>'
        : data.blocks.map(b => `
          <div class="friend-card">
            <img class="friend-avatar" src="${b.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
            <div class="friend-info"><div class="friend-name">${this.escapeHtml(b.nickname)}</div></div>
            <button class="btn btn-secondary btn-small" onclick="App.unblock(${b.id})">해제</button>
          </div>
        `).join(''));
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async unblock(id) {
    try {
      await this.api(`/api/blocks/${id}`, { method: 'DELETE' });
      this.showToast('차단이 해제되었습니다.', 'success');
      this.showBlockList();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async deleteAccount() {
    const pw = prompt('회원 탈퇴를 위해 비밀번호를 입력해주세요.');
    if (!pw) return;
    try {
      await this.api('/api/users/account', { method: 'DELETE', body: { password: pw } });
      this.logout();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== REPORT ====================
  reportItem(type, id) {
    const reasons = ['욕설', '도배', '광고', '사기 의심', '괴롭힘', '부적절한 내용', '개인정보 노출', '기타'];
    this.showModal('신고', `
      <div class="form-group">
        <label class="form-label">신고 사유</label>
        <select class="form-select" id="report-reason">
          ${reasons.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">상세 내용</label><textarea class="form-input" id="report-detail" rows="3" placeholder="상세 내용을 입력해주세요"></textarea></div>
    `, async () => {
      try {
        await this.api('/api/reports', { method: 'POST', body: {
          targetType: type, targetId: id,
          reason: document.getElementById('report-reason').value,
          detail: document.getElementById('report-detail').value
        }});
        this.closeModal();
        this.showToast('신고가 접수되었습니다.', 'success');
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  // ==================== SEARCH ====================
  async globalSearch() {
    const q = document.getElementById('global-search').value.trim();
    if (!q) return;
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/search?q=${encodeURIComponent(q)}`);
      content.innerHTML = `
        <div class="page-title">검색: "${this.escapeHtml(q)}"</div>
        ${data.users && data.users.length > 0 ? `
          <h3 style="margin-bottom:8px;font-size:15px">사용자</h3>
          <div class="card" style="padding:0 16px">
          ${data.users.map(u => `
            <div class="friend-card" onclick="App.renderProfile(${u.id})" style="cursor:pointer">
              <img class="friend-avatar" src="${u.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">
              <div class="friend-info">
                <div class="friend-name">${this.escapeHtml(u.nickname)} <span class="post-level">Lv.${u.level}</span></div>
              </div>
            </div>
          `).join('')}
          </div>
        ` : ''}
        ${data.posts && data.posts.length > 0 ? `
          <h3 style="margin:16px 0 8px;font-size:15px">게시글</h3>
          ${data.posts.map(p => `
            <div class="post-card" onclick="App.viewPost(${p.id})">
              <div class="post-title">${this.escapeHtml(p.title)}</div>
              <div class="post-meta">${this.escapeHtml(p.nickname)} · ${this.formatTime(p.created_at)}</div>
            </div>
          `).join('')}
        ` : ''}
        ${data.rooms && data.rooms.length > 0 ? `
          <h3 style="margin:16px 0 8px;font-size:15px">수다방</h3>
          ${data.rooms.map(r => `
            <div class="room-card" onclick="App.joinRoom(${r.id}, '${r.type}')">
              <div class="room-icon">💬</div>
              <div class="room-info">
                <div class="room-name">${this.escapeHtml(r.name)}</div>
                <div class="room-meta"><i class="fas fa-users"></i> ${r.member_count}명</div>
              </div>
            </div>
          `).join('')}
        ` : ''}
        ${(!data.users?.length && !data.posts?.length && !data.rooms?.length) ? '<div class="empty-state"><i class="fas fa-search"></i><p>검색 결과가 없습니다.</p></div>' : ''}
      `;
    } catch (e) {}
  },

  // ==================== ADMIN ====================
  async renderAdmin() {
    if (this.user.role !== 'admin') return;
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <div class="page-title"><i class="fas fa-shield-alt page-title-icon" style="color:var(--danger)"></i> 관리자</div>
      <div class="tabs">
        <div class="tab active" onclick="App.loadAdminTab('dashboard', this)">대시보드</div>
        <div class="tab" onclick="App.loadAdminTab('users', this)">회원</div>
        <div class="tab" onclick="App.loadAdminTab('posts', this)">게시판</div>
        <div class="tab" onclick="App.loadAdminTab('rooms', this)">수다방</div>
        <div class="tab" onclick="App.loadAdminTab('reports', this)">신고</div>
        <div class="tab" onclick="App.loadAdminTab('notices', this)">공지</div>
        <div class="tab" onclick="App.loadAdminTab('logs', this)">기록</div>
      </div>
      <div id="admin-content"></div>
    `;
    this.loadAdminTab('dashboard', document.querySelector('.tab.active'));
  },

  async loadAdminTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const container = document.getElementById('admin-content');

    if (tab === 'dashboard') {
      try {
        const data = await this.api('/api/admin/dashboard');
        const s = data.stats;
        container.innerHTML = `
          <div class="stats-grid">
            ${[
              { icon: 'fa-users', color: '#6C63FF', label: '전체 회원', value: s.totalUsers },
              { icon: 'fa-user-plus', color: '#2ED573', label: '오늘 가입', value: s.todayUsers },
              { icon: 'fa-circle', color: '#1E90FF', label: '현재 접속', value: s.onlineUsers },
              { icon: 'fa-pen', color: '#FFA502', label: '전체 게시글', value: s.totalPosts },
              { icon: 'fa-pen-fancy', color: '#FF6B9D', label: '오늘 게시글', value: s.todayPosts },
              { icon: 'fa-comments', color: '#E040FB', label: '전체 댓글', value: s.totalComments },
              { icon: 'fa-door-open', color: '#00B894', label: '채팅방', value: s.totalRooms },
              { icon: 'fa-flag', color: '#FF4757', label: '신고 대기', value: s.pendingReports },
              { icon: 'fa-coins', color: '#FFA502', label: '전체 코인', value: s.totalCoins },
              { icon: 'fa-shopping-cart', color: '#6C5CE7', label: '오늘 코인', value: s.todayCoinsUsed },
            ].map(s => `
              <div class="stat-card">
                <div class="stat-icon" style="background:${s.color}20;color:${s.color}"><i class="fas ${s.icon}"></i></div>
                <div class="stat-value">${s.value}</div>
                <div class="stat-label">${s.label}</div>
              </div>
            `).join('')}
          </div>
        `;
      } catch (e) {}
    } else if (tab === 'users') {
      container.innerHTML = `
        <div style="margin-bottom:16px"><input type="text" class="form-input" id="admin-user-search" placeholder="회원 검색..." onkeypress="if(event.key==='Enter')App.searchAdminUsers()"></div>
        <div id="admin-users-list"></div>
      `;
      this.searchAdminUsers();
    } else if (tab === 'posts') {
      try {
        const data = await this.api('/api/admin/posts');
        container.innerHTML = `<div style="overflow-x:auto">
          <table class="admin-table">
            <thead><tr><th>ID</th><th>제목</th><th>작성자</th><th>상태</th><th>작업</th></tr></thead>
            <tbody>${data.posts.map(p => `<tr>
              <td>${p.id}</td>
              <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(p.title)}</td>
              <td>${this.escapeHtml(p.nickname)}</td>
              <td>${p.is_deleted ? '<span class="badge badge-banned">삭제</span>' : p.is_notice ? '<span class="badge badge-admin">공지</span>' : '<span class="badge badge-user">정상</span>'}</td>
              <td>${!p.is_deleted ? `<button class="btn btn-small btn-danger" onclick="App.adminDeletePost(${p.id})">삭제</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>`;
      } catch (e) {}
    } else if (tab === 'rooms') {
      try {
        const data = await this.api('/api/admin/rooms');
        container.innerHTML = `<div style="overflow-x:auto">
          <table class="admin-table">
            <thead><tr><th>이름</th><th>유형</th><th>방장</th><th>멤버</th><th>작업</th></tr></thead>
            <tbody>${data.rooms.map(r => `<tr>
              <td>${this.escapeHtml(r.name)}</td>
              <td><span class="room-type-badge badge-${r.type}">${r.type}</span></td>
              <td>${this.escapeHtml(r.owner_name)}</td>
              <td>${r.member_count}</td>
              <td>${r.is_active ? `<button class="btn btn-small btn-danger" onclick="App.adminDeleteRoom(${r.id})">삭제</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>`;
      } catch (e) {}
    } else if (tab === 'reports') {
      try {
        const data = await this.api('/api/admin/reports');
        container.innerHTML = data.reports.map(r => `
          <div class="card" style="border-left:4px solid ${r.status === 'pending' ? 'var(--warning)' : r.status === 'resolved' ? 'var(--success)' : 'var(--text-muted)'}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span class="badge badge-${r.status === 'pending' ? 'admin' : 'user'}">${r.status === 'pending' ? '대기' : r.status === 'resolved' ? '처리' : '반려'}</span> <strong style="margin-left:8px">${this.escapeHtml(r.reason)}</strong></div>
              <span style="font-size:12px;color:var(--text-muted)">${this.formatTime(r.created_at)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:8px">${this.escapeHtml(r.detail || '')}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">신고자: ${this.escapeHtml(r.reporter_name)} · 대상: ${r.target_type} #${r.target_id}</div>
            ${r.status === 'pending' ? `<div style="margin-top:12px;display:flex;gap:8px">
              <button class="btn btn-success btn-small" onclick="App.resolveReport(${r.id}, 'resolved')">처리</button>
              <button class="btn btn-secondary btn-small" onclick="App.resolveReport(${r.id}, 'rejected')">반려</button>
            </div>` : ''}
          </div>
        `).join('') || '<div class="empty-state"><p>신고가 없습니다.</p></div>';
      } catch (e) {}
    } else if (tab === 'notices') {
      container.innerHTML = `
        <div class="card">
          <div class="card-title" style="margin-bottom:16px">공지사항 작성</div>
          <div class="form-group"><label class="form-label">제목</label><input type="text" class="form-input" id="notice-title"></div>
          <div class="form-group"><label class="form-label">내용</label><textarea class="form-input" id="notice-content" rows="6"></textarea></div>
          <div class="form-group" style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="notice-pinned"><label for="notice-pinned">상단 고정</label>
          </div>
          <button class="btn btn-primary btn-full" onclick="App.createNotice()">등록</button>
        </div>
      `;
    } else if (tab === 'logs') {
      try {
        const data = await this.api('/api/admin/logs');
        container.innerHTML = `<div style="overflow-x:auto">
          <table class="admin-table">
            <thead><tr><th>시간</th><th>관리자</th><th>행동</th><th>상세</th></tr></thead>
            <tbody>${data.logs.map(l => `<tr>
              <td style="white-space:nowrap">${this.formatTime(l.created_at)}</td>
              <td>${this.escapeHtml(l.admin_name)}</td>
              <td>${this.escapeHtml(l.action)}</td>
              <td>${this.escapeHtml(l.detail)}</td>
            </tr>`).join('')}</tbody>
          </table></div>`;
      } catch (e) {}
    }
  },

  async searchAdminUsers() {
    const search = document.getElementById('admin-user-search')?.value || '';
    try {
      const data = await this.api(`/api/admin/users?search=${encodeURIComponent(search)}`);
      document.getElementById('admin-users-list').innerHTML = `<div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>닉네임</th><th>역할</th><th>레벨</th><th>코인</th><th>상태</th><th>작업</th></tr></thead>
          <tbody>${data.users.map(u => `<tr>
            <td>${this.escapeHtml(u.nickname)}</td>
            <td><span class="badge badge-${u.role}">${u.role}</span></td>
            <td>Lv.${u.level}</td>
            <td>${u.coins}</td>
            <td>${u.is_banned ? '<span class="badge badge-banned">정지</span>' : u.is_online ? '<span class="badge badge-user">온라인</span>' : '오프라인'}</td>
            <td><button class="btn btn-small btn-secondary" onclick="App.showAdminUserDetail(${u.id})">관리</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch (e) {}
  },

  async showAdminUserDetail(userId) {
    try {
      const data = await this.api(`/api/admin/users/${userId}`);
      const u = data.user;
      this.showModal(`${u.nickname} 관리`, `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px">
          <div><strong>아이디:</strong> ${u.username}</div>
          <div><strong>레벨:</strong> Lv.${u.level}</div>
          <div><strong>코인:</strong> ${u.coins}</div>
          <div><strong>상태:</strong> ${u.is_banned ? '정지' : '정상'}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn btn-small btn-secondary" onclick="App.adminAction(${u.id}, 'setLevel')">레벨 변경</button>
          <button class="btn btn-small btn-success" onclick="App.adminAction(${u.id}, 'addCoins')">코인 지급</button>
          <button class="btn btn-small btn-secondary" onclick="App.adminAction(${u.id}, 'removeCoins')">코인 회수</button>
          ${u.is_banned
            ? `<button class="btn btn-small btn-success" onclick="App.adminAction(${u.id}, 'unban')">정지 해제</button>`
            : `<button class="btn btn-small btn-danger" onclick="App.adminAction(${u.id}, 'ban')">계정 정지</button>`
          }
        </div>
      `);
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async adminAction(userId, action) {
    let value, reason;
    if (action === 'setLevel') {
      value = parseInt(prompt('새 레벨을 입력하세요:'));
      if (isNaN(value)) return;
    } else if (action === 'addCoins' || action === 'removeCoins') {
      value = parseInt(prompt('코인 수량을 입력하세요:'));
      if (isNaN(value)) return;
      reason = prompt('사유:') || '';
    } else if (action === 'ban') {
      reason = prompt('정지 사유를 입력하세요:');
      if (!reason) return;
    }
    try {
      const data = await this.api(`/api/admin/users/${userId}`, { method: 'PUT', body: { action, value, reason } });
      this.showToast(data.message, 'success');
      this.closeModal();
      this.searchAdminUsers();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async adminDeletePost(postId) {
    if (!confirm('게시글을 삭제하시겠습니까?')) return;
    try {
      await this.api(`/api/posts/${postId}`, { method: 'DELETE' });
      this.showToast('삭제되었습니다.', 'success');
      this.loadAdminTab('posts', document.querySelector('.tab.active'));
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async adminDeleteRoom(roomId) {
    if (!confirm('수다방을 삭제하시겠습니까?')) return;
    try {
      await this.api(`/api/admin/rooms/${roomId}`, { method: 'DELETE' });
      this.showToast('삭제되었습니다.', 'success');
      this.loadAdminTab('rooms', document.querySelector('.tab.active'));
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async resolveReport(reportId, status) {
    try {
      await this.api(`/api/admin/reports/${reportId}`, { method: 'PUT', body: { status } });
      this.showToast('처리되었습니다.', 'success');
      this.loadAdminTab('reports', document.querySelector('.tab.active'));
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async createNotice() {
    try {
      await this.api('/api/admin/notices', { method: 'POST', body: {
        title: document.getElementById('notice-title').value,
        content: document.getElementById('notice-content').value,
        isPinned: document.getElementById('notice-pinned').checked
      }});
      this.showToast('공지사항이 등록되었습니다!', 'success');
      document.getElementById('notice-title').value = '';
      document.getElementById('notice-content').value = '';
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ==================== TEACHER PAGES ====================
  async renderSchool() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/teacher/groups');
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0"><i class="fas fa-school page-title-icon" style="color:#3B82F6"></i> 학교 관리</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateSchoolGroup()"><i class="fas fa-plus"></i> 그룹</button>
        </div>
        ${data.groups.map(g => `
          <div class="card" style="cursor:pointer">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#3B82F6,#60A5FA);display:flex;align-items:center;justify-content:center;color:white;font-size:24px">🏫</div>
              <div style="flex:1">
                <div style="font-weight:700;font-size:16px">${this.escapeHtml(g.school_name)}</div>
                <div style="font-size:13px;color:var(--text-secondary)"><i class="fas fa-users"></i> ${g.member_count}명</div>
              </div>
            </div>
          </div>
        `).join('')}
        ${data.groups.length === 0 ? '<div class="empty-state"><i class="fas fa-school"></i><p>학교 그룹이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showCreateSchoolGroup() {
    this.showModal('학교 그룹 생성', `
      <div class="form-group"><label class="form-label">학교명</label><input type="text" class="form-input" id="school-name" placeholder="학교명을 입력하세요"></div>
    `, async () => {
      try {
        await this.api('/api/teacher/groups', { method: 'POST', body: { schoolName: document.getElementById('school-name').value } });
        this.closeModal();
        this.showToast('학교 그룹이 생성되었습니다!', 'success');
        this.renderSchool();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async renderStudents() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/teacher/students');
      const groups = (await this.api('/api/teacher/groups')).groups;

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0">학생 관리 (${data.students.length})</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateStudent()"><i class="fas fa-user-plus"></i></button>
        </div>
        <div style="overflow-x:auto">
          <table class="admin-table">
            <thead><tr><th>이름</th><th>아이디</th><th>경고</th><th>작업</th></tr></thead>
            <tbody>${data.students.map(s => `<tr>
              <td>${this.escapeHtml(s.name)}</td>
              <td>${this.escapeHtml(s.username)}</td>
              <td>${s.warning_count > 0 ? `<span style="color:var(--danger)">${s.warning_count}회</span>` : '0'}</td>
              <td>
                ${groups.length > 0 ? `<button class="btn btn-small btn-secondary" onclick="App.addStudentToGroup(${s.user_id}, ${groups[0].id})">그룹</button>` : ''}
                <button class="btn btn-small btn-secondary" onclick="App.startDM(${s.user_id})">채팅</button>
              </td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        ${data.students.length === 0 ? '<div class="empty-state"><p>학생이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showCreateStudent() {
    this.showModal('학생 계정 생성', `
      <div class="form-group"><label class="form-label">아이디</label><input type="text" class="form-input" id="student-username" placeholder="아이디"></div>
      <div class="form-group"><label class="form-label">비밀번호</label><input type="password" class="form-input" id="student-password" placeholder="비밀번호"></div>
      <div class="form-group"><label class="form-label">이름</label><input type="text" class="form-input" id="student-name" placeholder="이름"></div>
    `, async () => {
      try {
        await this.api('/api/teacher/create-student', { method: 'POST', body: {
          username: document.getElementById('student-username').value,
          password: document.getElementById('student-password').value,
          name: document.getElementById('student-name').value
        }});
        this.closeModal();
        this.showToast('학생 계정이 생성되었습니다!', 'success');
        this.renderStudents();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async addStudentToGroup(studentUserId, groupId) {
    try {
      await this.api(`/api/teacher/groups/${groupId}/add-student`, { method: 'POST', body: { studentUserId } });
      this.showToast('학생이 그룹에 추가되었습니다!', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async renderSchoolAttendance() {
    const content = document.getElementById('page-content');
    try {
      const groups = (await this.api('/api/teacher/groups')).groups;
      if (groups.length === 0) {
        content.innerHTML = '<div class="empty-state"><i class="fas fa-school"></i><p>학교 그룹을 먼저 생성해주세요.</p></div>';
        return;
      }
      const groupId = groups[0].id;
      const students = (await this.api('/api/teacher/students')).students;
      const today = new Date().toISOString().split('T')[0];
      const records = (await this.api(`/api/teacher/attendance/${groupId}?date=${today}`)).records;

      const recordMap = {};
      records.forEach(r => { recordMap[r.student_id] = r.status; });

      content.innerHTML = `
        <div class="page-title">출결 관리 - ${this.escapeHtml(groups[0].school_name)}</div>
        <div class="card" style="margin-bottom:16px">
          <input type="date" class="form-input" id="attendance-date" value="${today}" onchange="App.renderSchoolAttendance()" style="max-width:200px">
        </div>
        <div class="card" style="overflow-x:auto">
          <table class="attendance-table">
            <thead><tr><th>이름</th><th>출석</th><th>지각</th><th>조퇴</th><th>결석</th></tr></thead>
            <tbody>${students.map(s => {
              const status = recordMap[s.id] || 'absent';
              return `<tr>
                <td><strong>${this.escapeHtml(s.name)}</strong></td>
                <td><span class="attendance-status status-present" onclick="App.setAttendance(${s.id}, ${groupId}, 'present')" style="${status === 'present' ? 'font-weight:800;border:2px solid #4CAF50' : ''}">출석</span></td>
                <td><span class="attendance-status status-late" onclick="App.setAttendance(${s.id}, ${groupId}, 'late')" style="${status === 'late' ? 'font-weight:800;border:2px solid #FF9800' : ''}">지각</span></td>
                <td><span class="attendance-status status-early" onclick="App.setAttendance(${s.id}, ${groupId}, 'early_leave')" style="${status === 'early_leave' ? 'font-weight:800;border:2px solid #2196F3' : ''}">조퇴</span></td>
                <td><span class="attendance-status status-absent" onclick="App.setAttendance(${s.id}, ${groupId}, 'absent')" style="${status === 'absent' ? 'font-weight:800;border:2px solid #F44336' : ''}">결석</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
          ${students.length === 0 ? '<div class="empty-state"><p>학생을 먼저 추가해주세요.</p></div>' : ''}
        </div>
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async setAttendance(studentId, groupId, status) {
    try {
      const date = document.getElementById('attendance-date')?.value;
      await this.api('/api/teacher/attendance', { method: 'POST', body: { studentId, groupId, status, date } });
      this.showToast('출결이 기록되었습니다.', 'success');
      this.renderSchoolAttendance();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async renderSchoolAnnouncements() {
    const content = document.getElementById('page-content');
    try {
      const groups = (await this.api('/api/teacher/groups')).groups;
      if (groups.length === 0) { content.innerHTML = '<div class="empty-state"><p>학교 그룹을 먼저 생성해주세요.</p></div>'; return; }
      const groupId = groups[0].id;
      const data = await this.api(`/api/teacher/announcements/${groupId}`);

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0">공지사항</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateSchoolAnnouncement(${groupId})"><i class="fas fa-plus"></i></button>
        </div>
        ${data.announcements.map(a => `
          <div class="post-card ${a.is_pinned ? 'notice' : ''}">
            <div class="post-header">
              <div>
                <div class="post-author">${this.escapeHtml(a.teacher_name)} 선생님</div>
                <div class="post-meta">${this.formatTime(a.created_at)}</div>
              </div>
              ${a.is_pinned ? '<span class="badge badge-admin">고정</span>' : ''}
            </div>
            <div class="post-title">${this.escapeHtml(a.title)}</div>
            <div class="post-content">${this.escapeHtml(a.content)}</div>
          </div>
        `).join('')}
        ${data.announcements.length === 0 ? '<div class="empty-state"><p>공지사항이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showCreateSchoolAnnouncement(groupId) {
    this.showModal('공지사항 작성', `
      <div class="form-group"><label class="form-label">제목</label><input type="text" class="form-input" id="sa-title"></div>
      <div class="form-group"><label class="form-label">내용</label><textarea class="form-input" id="sa-content" rows="6"></textarea></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="sa-pinned"><label for="sa-pinned">상단 고정</label>
      </div>
    `, async () => {
      try {
        await this.api('/api/teacher/announcements', { method: 'POST', body: {
          groupId, title: document.getElementById('sa-title').value,
          content: document.getElementById('sa-content').value,
          isPinned: document.getElementById('sa-pinned').checked
        }});
        this.closeModal();
        this.showToast('공지사항이 등록되었습니다!', 'success');
        this.renderSchoolAnnouncements();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async renderSchoolAlbums() {
    const content = document.getElementById('page-content');
    try {
      const groups = (await this.api('/api/teacher/groups')).groups;
      if (groups.length === 0) { content.innerHTML = '<div class="empty-state"><p>학교 그룹을 먼저 생성해주세요.</p></div>'; return; }
      const groupId = groups[0].id;
      const data = await this.api(`/api/teacher/albums/${groupId}`);

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0">앨범</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateAlbum(${groupId})"><i class="fas fa-plus"></i></button>
        </div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px"><i class="fas fa-shield-alt"></i> 캡처 및 화면 녹화가 차단됩니다.</p>
        <div class="shop-grid">
          ${data.albums.map(a => `
            <div class="shop-item" onclick="App.viewAlbum(${a.id})" style="cursor:pointer">
              <div class="shop-item-icon">📸</div>
              <div class="shop-item-name">${this.escapeHtml(a.title)}</div>
              <div class="shop-item-desc">${a.photo_count}장</div>
            </div>
          `).join('')}
        </div>
        ${data.albums.length === 0 ? '<div class="empty-state"><i class="fas fa-images"></i><p>앨범이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showCreateAlbum(groupId) {
    this.showModal('앨범 추가', `
      <div class="form-group"><label class="form-label">앨범 이름</label><input type="text" class="form-input" id="album-title"></div>
      <div class="form-group"><label class="form-label">설명</label><input type="text" class="form-input" id="album-desc"></div>
      <div class="form-group"><label class="form-label">사진</label><input type="file" id="album-photos" multiple accept="image/*" class="form-input"></div>
    `, async () => {
      try {
        const formData = new FormData();
        formData.append('groupId', groupId);
        formData.append('title', document.getElementById('album-title').value);
        formData.append('description', document.getElementById('album-desc').value);
        const files = document.getElementById('album-photos').files;
        for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
        const res = await fetch('/api/teacher/albums', {
          method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` }, body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.closeModal();
        this.showToast('앨범이 생성되었습니다!', 'success');
        this.renderSchoolAlbums();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async viewAlbum(albumId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/teacher/albums/${albumId}/photos`);
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.renderSchoolAlbums()"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">앨범</div>
        </div>
        <div class="album-protected">
          <div class="album-grid">
            ${data.photos.map(p => `<div class="album-photo"><img src="${p.image_url}" alt="" draggable="false" oncontextmenu="return false"></div>`).join('')}
          </div>
        </div>
        ${data.photos.length === 0 ? '<div class="empty-state"><p>사진이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async renderTeacherChat() {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api('/api/teacher/chat-rooms');
      const categories = { general: '일반', notice: '주요공지사항', event: '행사', eval: '평가' };

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="page-title" style="margin-bottom:0">선생님 채팅</div>
          <button class="btn btn-primary btn-small btn-pill" onclick="App.showCreateTeacherRoom()"><i class="fas fa-plus"></i></button>
        </div>
        ${data.rooms.map(r => `
          <div class="room-card" onclick="App.openTeacherChat(${r.id})">
            <div class="room-icon" style="background:linear-gradient(135deg,#3B82F6,#60A5FA)">🏫</div>
            <div class="room-info">
              <div class="room-name">${this.escapeHtml(r.name)}</div>
              <div class="room-meta">${categories[r.category] || r.category}</div>
            </div>
          </div>
        `).join('')}
        ${data.rooms.length === 0 ? '<div class="empty-state"><p>선생님 채팅방이 없습니다.</p></div>' : ''}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  showCreateTeacherRoom() {
    this.showModal('선생님 채팅방', `
      <div class="form-group"><label class="form-label">이름</label><input type="text" class="form-input" id="tr-name"></div>
      <div class="form-group">
        <label class="form-label">카테고리</label>
        <select class="form-select" id="tr-category">
          <option value="general">일반</option>
          <option value="notice">주요공지사항</option>
          <option value="event">행사</option>
          <option value="eval">평가</option>
        </select>
      </div>
    `, async () => {
      try {
        await this.api('/api/teacher/chat-rooms', { method: 'POST', body: {
          name: document.getElementById('tr-name').value,
          category: document.getElementById('tr-category').value
        }});
        this.closeModal();
        this.showToast('채팅방이 생성되었습니다!', 'success');
        this.renderTeacherChat();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async openTeacherChat(roomId) {
    const content = document.getElementById('page-content');
    content.style.padding = '0';
    content.style.maxWidth = '100%';

    if (this.socket) this.socket.emit('joinTeacherRoom', roomId);

    content.innerHTML = `
      <div class="chat-container">
        <div style="padding:10px 16px;background:var(--bg-card);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <button class="page-back" onclick="App.navigate('teacher-chat')"><i class="fas fa-arrow-left"></i></button>
          <span style="font-weight:700;font-size:16px">선생님 채팅</span>
        </div>
        <div class="chat-messages" id="teacher-messages"></div>
        <div class="chat-input-area">
          <input type="text" class="chat-input" id="teacher-input" placeholder="메시지를 입력하세요..." onkeypress="if(event.key==='Enter')App.sendTeacherMessage(${roomId})">
          <button class="chat-send-btn" onclick="App.sendTeacherMessage(${roomId})"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    `;

    try {
      const data = await this.api(`/api/teacher/chat-rooms/${roomId}/messages`);
      const container = document.getElementById('teacher-messages');
      data.messages.forEach(msg => {
        const isOwn = msg.nickname === this.user.nickname;
        const div = document.createElement('div');
        div.className = `chat-msg ${isOwn ? 'own' : ''}`;
        div.innerHTML = `
          ${!isOwn ? `<img class="chat-msg-avatar" src="${msg.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">` : ''}
          <div class="chat-msg-body">
            ${!isOwn ? `<div class="chat-msg-name">${this.escapeHtml(msg.nickname)}</div>` : ''}
            <div class="chat-bubble">${this.escapeHtml(msg.content)}</div>
            <div class="chat-time">${this.formatTimeShort(msg.created_at)}</div>
          </div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    } catch (e) {}

    this.socket.on('teacherMessage', (msg) => {
      const container = document.getElementById('teacher-messages');
      if (!container) return;
      const isOwn = msg.nickname === this.user.nickname;
      const div = document.createElement('div');
      div.className = `chat-msg ${isOwn ? 'own' : ''}`;
      div.innerHTML = `
        ${!isOwn ? `<img class="chat-msg-avatar" src="${msg.profile_image}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%236C63FF%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22>👤</text></svg>'">` : ''}
        <div class="chat-msg-body">
          ${!isOwn ? `<div class="chat-msg-name">${this.escapeHtml(msg.nickname)}</div>` : ''}
          <div class="chat-bubble">${this.escapeHtml(msg.content)}</div>
          <div class="chat-time">${this.formatTimeShort(msg.created_at)}</div>
        </div>
      `;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    });
  },

  sendTeacherMessage(roomId) {
    const input = document.getElementById('teacher-input');
    const content = input.value.trim();
    if (!content) return;
    this.socket.emit('teacherMessage', { roomId, content });
    input.value = '';
  },

  // ==================== STUDENT DASHBOARD ====================
  async renderStudentDashboard() {
    const content = document.getElementById('page-content');
    try {
      const groups = (await this.api('/api/student/my-groups')).groups;

      content.innerHTML = `
        <div class="page-title"><i class="fas fa-school page-title-icon" style="color:#3B82F6"></i> 학교</div>
        ${groups.length === 0 ? '<div class="empty-state"><i class="fas fa-school"></i><p>소속된 학교 그룹이 없습니다.</p></div>' : ''}
        ${groups.map(g => `
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
              <div style="font-size:32px">🏫</div>
              <div>
                <div style="font-weight:700;font-size:18px">${this.escapeHtml(g.school_name)}</div>
                <div style="font-size:13px;color:var(--text-secondary)">학생</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary btn-small btn-pill" onclick="App.studentCheckAttendance(${g.id})"><i class="fas fa-check"></i> 출결</button>
              <button class="btn btn-secondary btn-small btn-pill" onclick="App.viewStudentAnnouncements(${g.id})"><i class="fas fa-bullhorn"></i> 공지</button>
              <button class="btn btn-secondary btn-small btn-pill" onclick="App.viewStudentAlbums(${g.id})"><i class="fas fa-images"></i> 앨범</button>
            </div>
          </div>
        `).join('')}
      `;
    } catch (e) { content.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
  },

  async studentCheckAttendance(groupId) {
    try {
      await this.api('/api/student/attendance', { method: 'POST', body: { groupId } });
      this.showToast('출결이 등록되었습니다!', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async viewStudentAnnouncements(groupId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/teacher/announcements/${groupId}`);
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('student-dashboard')"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">공지사항</div>
        </div>
        ${data.announcements.map(a => `
          <div class="post-card ${a.is_pinned ? 'notice' : ''}">
            <div class="post-title">${this.escapeHtml(a.title)}</div>
            <div class="post-content">${this.escapeHtml(a.content)}</div>
            <div class="post-meta">${this.escapeHtml(a.teacher_name)} 선생님 · ${this.formatTime(a.created_at)}</div>
          </div>
        `).join('')}
        ${data.announcements.length === 0 ? '<div class="empty-state"><p>공지사항이 없습니다.</p></div>' : ''}
      `;
    } catch (e) {}
  },

  async viewStudentAlbums(groupId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/teacher/albums/${groupId}`);
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('student-dashboard')"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">앨범</div>
        </div>
        <p style="font-size:13px;color:var(--danger);margin-bottom:16px"><i class="fas fa-shield-alt"></i> 캡처 및 화면 녹화가 차단됩니다.</p>
        <div class="shop-grid">
          ${data.albums.map(a => `
            <div class="shop-item" onclick="App.viewAlbumProtected(${a.id})" style="cursor:pointer">
              <div class="shop-item-icon">📸</div>
              <div class="shop-item-name">${this.escapeHtml(a.title)}</div>
              <div class="shop-item-desc">${a.photo_count}장</div>
            </div>
          `).join('')}
        </div>
        ${data.albums.length === 0 ? '<div class="empty-state"><p>앨범이 없습니다.</p></div>' : ''}
      `;
    } catch (e) {}
  },

  async viewAlbumProtected(albumId) {
    const content = document.getElementById('page-content');
    try {
      const data = await this.api(`/api/teacher/albums/${albumId}/photos`);
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <button class="page-back" onclick="App.navigate('student-dashboard')"><i class="fas fa-arrow-left"></i></button>
          <div class="page-title" style="margin-bottom:0">앨범</div>
        </div>
        <div class="album-protected" oncontextmenu="return false">
          <div class="album-grid">
            ${data.photos.map(p => `<div class="album-photo"><img src="${p.image_url}" alt="" draggable="false" oncontextmenu="return false" style="pointer-events:none"></div>`).join('')}
          </div>
        </div>
        ${data.photos.length === 0 ? '<div class="empty-state"><p>사진이 없습니다.</p></div>' : ''}
      `;

      const style = document.createElement('style');
      style.id = 'album-protect-style';
      style.textContent = `.album-protected { -webkit-touch-callout:none; } @media print { .album-protected { display:none !important; } }`;
      if (!document.getElementById('album-protect-style')) document.head.appendChild(style);

      if (this._albumHandler) document.removeEventListener('keyup', this._albumHandler);
      const handler = (e) => { if (e.key === 'PrintScreen') { e.preventDefault(); alert('캡처가 차단되었습니다.'); } };
      document.addEventListener('keyup', handler);
      this._albumHandler = handler;
    } catch (e) {}
  },

  // ==================== MODAL ====================
  showModal(title, bodyHtml, onConfirm) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="App.closeModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${onConfirm ? `
          <div class="modal-footer">
            <button class="btn btn-secondary btn-small" onclick="App.closeModal()">취소</button>
            <button class="btn btn-primary btn-small" id="modal-confirm">확인</button>
          </div>
        ` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) App.closeModal(); });
    if (onConfirm) document.getElementById('modal-confirm').addEventListener('click', onConfirm);
  },

  closeModal() {
    document.querySelector('.modal-overlay')?.remove();
  },

  renderPagination(current, total, callback) {
    if (total <= 1) return '';
    let html = '<div class="pagination">';
    for (let i = 1; i <= total; i++) {
      html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="${callback}(${i})">${i}</button>`;
    }
    html += '</div>';
    return html;
  },
};

// 앱 시작
App.init();
