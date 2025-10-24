// server.js
require('dotenv').config(); // 로컬 개발 시 .env 파일 로드

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { put } = require('@vercel/blob'); // 👈 [1] Vercel Blob 모듈 추가
const multer = require('multer'); // 👈 [2] Multer 모듈 추가

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------
// 0. Multer 설정: 파일을 메모리에 임시 저장
// ------------------------------------
const upload = multer({ storage: multer.memoryStorage() }); // 👈 [3] Multer 설정 추가

// EJS를 템플릿 엔진으로 설정
app.set('view engine', 'ejs');
// EJS 템플릿 파일 경로 설정
app.set('views', path.join(__dirname, 'views')); // 👈 [4] views 경로 설정 추가

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
// 2. 라우트 정의
// ------------------------------------

// 🚀 A. 인증/로그인 페이지
app.get('/', (req, res) => {
    res.render('login'); // views/login.ejs 렌더링으로 변경
});

// 🔒 B. 로그인 처리
app.post('/login', (req, res) => {
    const { password } = req.body;
    const CORRECT_PASSWORD = process.env.ACCESS_PASSWORD; 
    
    if (password === CORRECT_PASSWORD && CORRECT_PASSWORD) {
        // 실제 앱에서는 쿠키/세션을 설정해야 하지만, 일단 리디렉션
        return res.redirect('/files');
    }
    
    res.send('<h1>접근 비밀번호를 확인해주세요.</h1><a href="/">다시 시도</a>');
});

// 📂 C. 파일 목록 페이지 (DB 조회 및 EJS 렌더링)
app.get('/files', async (req, res) => {
    try {
        const sortBy = req.query.sort || 'uploaded_at';
        const sortOrder = req.query.order || 'DESC';

        const validSorts = ['file_name', 'uploaded_at', 'size_bytes', 'extension'];
        const orderBy = validSorts.includes(sortBy) ? sortBy : 'uploaded_at';
        const order = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
        
        const query = `SELECT * FROM files ORDER BY ${orderBy} ${order}`;
        const { rows: files } = await pool.query(query);
        
        res.render('file_list', { files: files, currentSort: orderBy, currentOrder: order });
        
    } catch (error) {
        console.error('DB 파일 목록 조회 오류:', error);
        res.status(500).send('파일 목록을 불러오는 중 오류가 발생했습니다. Render 로그를 확인하세요.');
    }
});

// 📤 D. 파일 업로드 처리 👈 [5] 핵심 업로드 라우트 추가
app.post('/upload', upload.single('file'), async (req, res) => {
    
    if (!req.file) {
        return res.status(400).send('업로드할 파일이 없습니다.');
    }

    const file = req.file;
    
    try {
        // 1. Vercel Blob에 파일 업로드
        const blob = await put(file.originalname, file.buffer, {
            access: 'public',
            contentType: file.mimetype,
        });

        // 2. 파일 메타데이터 추출 및 DB 저장
        const fileName = file.originalname;
        const extension = path.extname(fileName).slice(1) || '';
        const sizeBytes = file.size;
        const blobUrl = blob.url; 

        const queryText = `
            INSERT INTO files(file_name, extension, blob_url, size_bytes) 
            VALUES($1, $2, $3, $4) RETURNING *`;
        const queryValues = [fileName, extension, blobUrl, sizeBytes];
        
        await pool.query(queryText, queryValues);

        console.log(`✅ 파일 업로드 및 DB 저장 완료: ${fileName}`);
        res.redirect('/files');

    } catch (error) {
        console.error('❌ 파일 업로드 및 DB 저장 중 오류 발생:', error);
        res.status(500).send('파일 업로드 처리 중 서버 오류가 발생했습니다.');
    }
});


// ------------------------------------
// 3. 서버 시작
// ------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
