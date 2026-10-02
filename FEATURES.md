# 수다방 - 구현 기능 목록

> 기능 중복 구현 방지를 위한 형상관리 문서
> 마지막 업데이트: 2026-10-02 (v2.5.0)

---

## 1. 인증 및 사용자 관리

| 기능 | API | 설명 |
|------|-----|------|
| 회원가입 | `POST /api/auth/register` | 프로필 이미지 업로드 지원, bcryptjs 비밀번호 해싱 |
| 로그인 | `POST /api/auth/login` | JWT 토큰 발급 (7일 만료) |
| 내 정보 조회 | `GET /api/auth/me` | 토큰 기반 사용자 정보 반환 |
| 사용자 조회 | `GET /api/users/:id` | 다른 사용자 프로필 조회 |
| 프로필 수정 | `PUT /api/users/profile` | 프로필 이미지 변경 포함 |
| 비밀번호 변경 | `PUT /api/users/password` | |
| 테마 변경 | `PUT /api/users/theme` | 사용자별 테마 설정 |
| 계정 삭제 | `DELETE /api/users/account` | |
| 사용자 검색 | `GET /api/users/search/:query` | |

## 2. 친구 시스템

| 기능 | API | 설명 |
|------|-----|------|
| 친구 목록 | `GET /api/friends` | |
| 친구 요청 | `POST /api/friends/request` | |
| 친구 수락 | `PUT /api/friends/accept/:id` | |
| 친구 거절 | `PUT /api/friends/reject/:id` | |
| 친구 삭제 | `DELETE /api/friends/:id` | |

## 3. 차단 시스템

| 기능 | API | 설명 |
|------|-----|------|
| 차단 목록 | `GET /api/blocks` | |
| 사용자 차단 | `POST /api/blocks` | |
| 차단 해제 | `DELETE /api/blocks/:id` | |

## 4. 게시판 (커뮤니티)

| 기능 | API | 설명 |
|------|-----|------|
| 게시글 목록 | `GET /api/posts` | 페이지네이션, 카테고리 필터 |
| 게시글 상세 | `GET /api/posts/:id` | |
| 게시글 작성 | `POST /api/posts` | |
| 게시글 수정 | `PUT /api/posts/:id` | |
| 게시글 삭제 | `DELETE /api/posts/:id` | |
| 좋아요(하트) | `POST /api/posts/:id/heart` | 토글 방식 |
| 댓글 작성 | `POST /api/posts/:id/comments` | |
| 댓글 수정 | `PUT /api/comments/:id` | |
| 댓글 삭제 | `DELETE /api/comments/:id` | |
| 댓글 좋아요 | `POST /api/comments/:id/like` | |
| 게시글 투표 | `POST /api/posts/:id/poll` | |
| 통합 검색 | `GET /api/search` | 게시글/사용자 검색 |

## 5. 랭킹

| 기능 | API | 설명 |
|------|-----|------|
| 게시글 랭킹 | `GET /api/ranking/posts` | |
| 사용자 랭킹 | `GET /api/ranking/users` | |
| 주간 랭킹 | `GET /api/ranking/weekly` | |
| 미니게임 랭킹 | `GET /api/minigame/ranking` | |
| 명예의 전당 | `GET /api/hall-of-fame` | |

## 6. 출석 체크

| 기능 | API | 설명 |
|------|-----|------|
| 출석 현황 | `GET /api/attendance` | 월간 출석 조회 |
| 출석 체크 | `POST /api/attendance` | 연속 출석 보너스 코인 + 룰렛 보상 |
| 출석 룰렛 | 출석 체크 시 자동 실행 | 5~500코인 랜덤 보상, 7일+ 연속 출석 시 1.5배 보너스 |

## 7. 코인 & 상점

| 기능 | API | 설명 |
|------|-----|------|
| 코인 내역 | `GET /api/coins` | |
| 상점 아이템 목록 | `GET /api/shop` | |
| 아이템 구매 | `POST /api/shop/buy/:id` | 코인 차감 |
| 보관함 조회 | `GET /api/inventory` | |
| 아이템 장착 | `POST /api/inventory/equip/:id` | |
| 스티커 목록 | `GET /api/stickers` | |
| 스티커 구매 | `POST /api/stickers/buy/:id` | |

## 8. 레벨 시스템

| 기능 | 설명 |
|------|------|
| 경험치/레벨업 | 활동 시 경험치 획득, 자동 레벨업 |
| 레벨 보상 | Lv5/10/15/20/25/30/40/50 달성 시 코인+칭호 보상 |
| 레벨 제한 | 채팅방 생성: Lv19+, 투표 생성: Lv24+ |
| 레벨 보상 조회 | `GET /api/level-rewards` |
| 레벨 보상 수령 | `POST /api/level-rewards/:level/claim` |

## 9. 칭호 시스템

| 기능 | API | 설명 |
|------|-----|------|
| 칭호 목록 | `GET /api/titles` | |
| 칭호 장착 | `POST /api/titles/equip` | |

## 10. 프로필 프레임

| 기능 | API | 설명 |
|------|-----|------|
| 프레임 목록 | `GET /api/profile-frames` | |
| 프레임 장착 | `POST /api/profile-frames/equip` | |

## 11. 채팅방

| 기능 | API | 설명 |
|------|-----|------|
| 채팅방 목록 | `GET /api/rooms` | |
| 내 채팅방 | `GET /api/rooms/my` | |
| 채팅방 생성 | `POST /api/rooms` | Lv19+ 필요 |
| 채팅방 참여 | `POST /api/rooms/:id/join` | 비밀번호방: 이미 참여 중이면 바로 입장 |
| 초대 | `POST /api/rooms/:id/invite` | |
| 채팅방 나가기 | `POST /api/rooms/:id/leave` | |
| 채팅방 설정 변경 | `PUT /api/rooms/:id/settings` | |
| 채팅방 정보 | `GET /api/rooms/:id/info` | |
| 메시지 조회 | `GET /api/rooms/:id/messages` | |
| 메시지 전송 | `POST /api/rooms/:id/messages` | |

### 채팅방 유형
- **공개방**: 누구나 참여 가능
- **비공개방**: 초대로만 참여
- **제한공개방**: 친구 초대 방식
- **비밀번호방**: 비밀번호 입력 후 참여

### 채팅방 투표
| 기능 | API | 설명 |
|------|-----|------|
| 투표 생성 | `POST /api/rooms/:roomId/polls` | Lv24+ 필요 |
| 투표 목록 | `GET /api/rooms/:roomId/polls` | |
| 투표 참여 | `POST /api/polls/:id/vote` | |

## 12. DM (다이렉트 메시지)

| 기능 | API | 설명 |
|------|-----|------|
| DM 목록 | `GET /api/dm` | |
| DM 시작 | `POST /api/dm/start` | |
| DM 메시지 조회 | `GET /api/dm/:roomId/messages` | |
| DM 메시지 전송 | `POST /api/dm/:roomId/messages` | |

## 13. 알림

| 기능 | API | 설명 |
|------|-----|------|
| 알림 목록 | `GET /api/notifications` | |
| 전체 읽음 | `PUT /api/notifications/read` | |
| 개별 읽음 | `PUT /api/notifications/:id/read` | |
| 테스트 푸시 | `POST /api/notifications/test-push` | |
| FCM 등록 | `POST /api/fcm/register` | |
| FCM 해제 | `POST /api/fcm/unregister` | |

## 14. 미니게임 (7종)

| 게임 | API | 설명 |
|------|-----|------|
| 룰렛 | `POST /api/minigame/roulette` | |
| 가위바위보 | `POST /api/minigame/rps` | |
| 동전 던지기 | `POST /api/minigame/coinflip` | |
| 숫자 맞추기 | `POST /api/minigame/numberguess` | |
| 주사위 | `POST /api/minigame/dice` | |
| 카드 뽑기 | `POST /api/minigame/cardpick` | |
| 폭탄 게임 | `POST /api/minigame/bomb` | |
| 게임 기록 | `GET /api/minigame/history` | |

## 15. 갤러리

| 기능 | API | 설명 |
|------|-----|------|
| 갤러리 목록 | `GET /api/gallery` | |
| 갤러리 상세 | `GET /api/gallery/:id` | |
| 사진 업로드 | `POST /api/gallery` | 최대 10장 |
| 갤러리 삭제 | `DELETE /api/gallery/:id` | |
| 갤러리 좋아요 | `POST /api/gallery/:id/heart` | |

## 16. 투표 시스템

| 기능 | API | 설명 |
|------|-----|------|
| 투표 생성 | `POST /api/polls` | 독립 투표 |
| 활성 투표 | `GET /api/polls/active` | |

## 17. 미션 & 업적

| 기능 | API | 설명 |
|------|-----|------|
| 미션 목록 | `GET /api/missions` | 일일 미션 |
| 미션 보상 수령 | `POST /api/missions/:key/claim` | |
| 업적 목록 | `GET /api/achievements` | |

## 18. 이벤트 캘린더

| 기능 | API | 설명 |
|------|-----|------|
| 이벤트 목록 | `GET /api/events` | |
| 이벤트 생성 | `POST /api/events` | |
| 이벤트 삭제 | `DELETE /api/events/:id` | |

## 19. 배너

| 기능 | API | 설명 |
|------|-----|------|
| 배너 조회 | `GET /api/banners` | 활성 배너만 표시 |

## 20. 쿠폰 & 추천 코드

| 기능 | API | 설명 |
|------|-----|------|
| 쿠폰 사용 | `POST /api/coupons/redeem` | |

## 21. 신고 시스템

| 기능 | API | 설명 |
|------|-----|------|
| 신고하기 | `POST /api/reports` | |
| 내 신고 내역 | `GET /api/reports/my` | |

## 22. 학교/선생님 기능

| 기능 | API | 설명 |
|------|-----|------|
| 학생 계정 생성 | `POST /api/teacher/create-student` | 선생님 전용 |
| 학생 목록 | `GET /api/teacher/students` | |
| 그룹 생성 | `POST /api/teacher/groups` | |
| 그룹 목록 | `GET /api/teacher/groups` | |
| 그룹에 학생 추가 | `POST /api/teacher/groups/:id/add-student` | |
| 공지사항 작성 | `POST /api/teacher/announcements` | |
| 공지사항 조회 | `GET /api/teacher/announcements/:groupId` | |
| 출결 등록 | `POST /api/teacher/attendance` | |
| 출결 조회 | `GET /api/teacher/attendance/:groupId` | |
| 앨범 생성 | `POST /api/teacher/albums` | 최대 20장 |
| 앨범 조회 | `GET /api/teacher/albums/:groupId` | |
| 앨범 사진 | `GET /api/teacher/albums/:id/photos` | |
| 경고 부여 | `POST /api/teacher/warnings` | |
| 선생님 채팅방 목록 | `GET /api/teacher/chat-rooms` | |
| 선생님 채팅방 생성 | `POST /api/teacher/chat-rooms` | |
| 선생님 채팅 메시지 | `GET/POST /api/teacher/chat-rooms/:id/messages` | |
| 학교 일정 조회 | `GET /api/school-schedules/:groupId` | |
| 학교 일정 등록 | `POST /api/school-schedules` | |
| 학교 일정 삭제 | `DELETE /api/school-schedules/:id` | |

## 23. 학생 기능

| 기능 | API | 설명 |
|------|-----|------|
| 내 그룹 | `GET /api/student/my-groups` | |
| 출석 체크 | `POST /api/student/attendance` | |
| 출석 기록 | `GET /api/student/attendance-history` | |

## 24. 교실 기능

| 기능 | API | 설명 |
|------|-----|------|
| 자리 배치 | `POST /api/seat-assignment` | |
| 자리 조회 | `GET /api/seat-assignment` | |
| 학급 투표 목록 | `GET /api/class-votes` | |
| 학급 투표 생성 | `POST /api/class-votes` | |
| 학급 투표 참여 | `POST /api/class-votes/:id/vote` | |
| 학급 투표 삭제 | `DELETE /api/class-votes/:id` | |

## 25. 기타 기능

| 기능 | API | 설명 |
|------|-----|------|
| 타자 연습 기록 | `POST /api/typing-record` | |
| 타자 랭킹 | `GET /api/typing-ranking` | |
| 파일 업로드 | `POST /api/upload` | 범용 파일 업로드 |
| 랜덤 메뉴 추천 | 클라이언트 전용 | |
| 그림판 | 클라이언트 전용 | |

## 26. 관리자 기능

| 기능 | API | 설명 |
|------|-----|------|
| 대시보드 | `GET /api/admin/dashboard` | 통계 요약 |
| 사용자 관리 | `GET/PUT /api/admin/users` | 목록, 상세, 수정(역할/제재/코인/레벨) |
| 게시글 관리 | `GET /api/admin/posts` | |
| 공지 작성 | `POST /api/admin/notices` | |
| 채팅방 관리 | `GET/PUT/DELETE /api/admin/rooms` | 수정, 삭제, 활성/비활성 |
| 채팅방 멤버 관리 | `GET/DELETE /api/admin/rooms/:id/members` | |
| 상점 관리 | CRUD `/api/admin/shop` | |
| 이벤트 관리 | CRUD `/api/admin/events` | |
| 예약 게시글 | CRUD `/api/admin/scheduled-posts` | 발행 기능 포함 |
| 자동 제재 | `GET/PUT /api/admin/sanctions` | |
| DM 모니터링 | `GET /api/admin/dm-monitor` | |
| 팝업 공지 | CRUD `/api/admin/popup-notices` | |
| 신고 관리 | `GET/PUT /api/admin/reports` | |
| 관리 로그 | `GET /api/admin/logs` | |
| 추천 코드 관리 | CRUD `/api/admin/referral-codes` | |
| 쿠폰 관리 | CRUD `/api/admin/coupons` | |
| 배너 관리 | CRUD `/api/admin/banners` | |
| 릴리즈 노트 | CRUD `/api/release-notes` | 관리자 전용 열람 |

## 27. 비속어/욕설 필터

- 33개 금칙어 목록 (`BAD_WORDS` 배열)
- `containsBadWords()`: 비속어 포함 여부 검사
- `filterBadWords()`: 비속어를 `***`로 치환
- 채팅 메시지, 게시글 등에 적용

## 28. 팝업 공지

| 기능 | API | 설명 |
|------|-----|------|
| 팝업 공지 조회 | `GET /api/popup-notice` | 활성 팝업만 |
| 팝업 공지 등록 | `POST /api/popup-notice` | 관리자 |
| 팝업 공지 삭제 | `DELETE /api/popup-notice/:id` | 관리자 |

---

## 기술 구현 사항

### 백엔드
- **런타임**: Node.js + Express
- **DB**: sql.js (SQLite WASM) + BetterSqlite3Compat 래퍼
- **클라우드 DB**: Firebase Realtime Database (PATCH 방식, 변경된 테이블만 저장)
- **인증**: JWT (7일 만료), bcryptjs 비밀번호 해싱
- **파일 업로드**: multer
- **배포**: Vercel Serverless (`@vercel/node`)
- **Dirty 테이블 추적**: `_dirtyTables` Set으로 변경된 테이블만 Firebase에 PATCH 저장

### 프론트엔드
- **SPA 아키텍처**: 단일 `index.html` + `app.js` 클라이언트 라우팅
- **브랜드 테마**: `data-brand="resam"` CSS 속성
- **모바일 앱**: Android WebView APK

### 삭제된 기능 (구현하지 말 것)
- ~~AI 채팅 (Gemini API)~~ — v2.5.0에서 제거됨

---

## 변경 이력

| 날짜 | 버전 | 변경 사항 |
|------|------|----------|
| 2026-10-02 | v2.5.0 | Firebase PATCH 저장, 비밀번호방 재입장 수정, 릴리즈 노트 관리자 전용, AI 채팅 제거 |
| 2026-10-02 | v2.5.1 | 출석 룰렛 기능 추가 (5~500코인 랜덤 보상, 7일+ 연속 시 1.5배) |
