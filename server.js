// server.js
require('dotenv').config(); // 로컬 개발 시 .env 파일 로드

const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// EJS를 템플릿 엔진으로 설정합니다 (파일 목록 HTML 렌더링용)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

// 📂 C. 파일 목록 페이지
app.get('/files', async (req, res) => {
    // **주의:** 여기서 DB 연결 코드가 누락되면 이 메시지가 뜹니다!

    // try-catch 블록 안에 DB 조회 및 EJS 렌더링 코드가 있어야 합니다.
    try {
        // 정렬 기준을 쿼리 파라미터에서 가져옵니다 (기본값: 최신순)
        const sortBy = req.query.sort || 'uploaded_at';
        const sortOrder = req.query.order || 'DESC'; // 'ASC' or 'DESC'

        // SQL 인젝션 방지를 위해, 정렬 컬럼은 화이트리스트로 검증합니다.
        const validSorts = ['file_name', 'uploaded_at', 'size_bytes', 'extension'];
        const orderBy = validSorts.includes(sortBy) ? sortBy : 'uploaded_at';
        const order = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
        
        const query = `SELECT * FROM files ORDER BY ${orderBy} ${order}`;
        const { rows: files } = await pool.query(query); // Neon DB에서 파일 목록 조회
        
        // EJS 템플릿을 렌더링합니다.
        // views/file_list.ejs 파일의 모든 내용을 HTML로 변환합니다.
        res.render('file_list', { files: files, currentSort: orderBy, currentOrder: order });
        
    } catch (error) {
        console.error('DB 파일 목록 조회 오류:', error);
        // DB 연결 오류 등이 발생했을 경우
        res.status(500).send('파일 목록을 불러오는 중 오류가 발생했습니다. DB 연결을 확인하세요.');
    }
});


// ------------------------------------
// 3. 서버 시작
// ------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
