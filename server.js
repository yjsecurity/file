// server.js
require('dotenv').config(); // 로컬 개발 시 .env 파일 로드

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// EJS를 템플릿 엔진으로 설정합니다 (파일 목록 HTML 렌더링용)
app.set('view engine', 'ejs');

// 정적 파일(CSS/JS)을 제공할 폴더를 설정합니다 (나중에 필요 시)
// app.use(express.static('public'));

// 폼 데이터 처리를 위한 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ------------------------------------
// 1. Neon DB 연결 설정
// ------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect()
    .then(client => {
        console.log('✅ Neon DB에 성공적으로 연결되었습니다.');
        client.release();
    })
    .catch(err => {
        console.error('❌ Neon DB 연결 오류:', err.message);
        // Render.com에서는 DB 연결 실패가 치명적이지 않을 수 있지만, 로컬에서는 확인 필요
    });


// ------------------------------------
// 2. 라우트 정의 (홈 페이지 및 인증)
// ------------------------------------

// 🚀 A. 인증/로그인 페이지
app.get('/', (req, res) => {
    // 임시로 로그인 페이지를 렌더링합니다.
    res.send('<h1>비밀번호를 입력하세요.</h1><form method="POST" action="/login"><input type="password" name="password" required><button type="submit">로그인</button></form>');
});

// 🔒 B. 로그인 처리 (임시)
app.post('/login', (req, res) => {
    const { password } = req.body;
    // 실제로는 안전하게 해시된 비밀번호와 비교해야 합니다.
    const CORRECT_PASSWORD = process.env.ACCESS_PASSWORD; 
    
    if (password === CORRECT_PASSWORD) {
        // 실제 앱에서는 세션/쿠키를 사용하여 로그인 상태를 유지해야 합니다.
        res.redirect('/files');
    } else {
        res.send('비밀번호가 틀렸습니다. <a href="/">다시 시도</a>');
    }
});

// 📂 C. 파일 목록 페이지 (로그인 후 접근)
app.get('/files', (req, res) => {
    // **TODO:** 여기서 Neon DB에서 파일 목록을 가져와 EJS로 렌더링해야 합니다.
    res.send('<h1>파일 관리자 대시보드 (접근 성공)</h1>');
});


// ------------------------------------
// 3. 서버 시작
// ------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
