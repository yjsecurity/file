// server.js
require('dotenv').config(); 

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { put, del } = require('@vercel/blob'); // 👈 del 함수 추가
const multer = require('multer');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer 설정: 파일을 메모리에 임시 저장 (단일 파일)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    fileFilter: function(req, file, cb) {
        // 기존 한글 깨짐 해결 로직 유지
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, true);
    }
});
// EJS를 템플릿 엔진으로 설정
app.set('view engine', 'ejs');
// EJS 템플릿 파일 경로 설정
app.set('views', path.join(__dirname, 'views'));

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
    });


// ------------------------------------
// 2. 라우트 정의
// ------------------------------------

// 🚀 A. 인증/로그인 페이지
app.get('/', (req, res) => {
    res.render('login');
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
        
        const query = `SELECT id, file_name, extension, blob_url, size_bytes, uploaded_at FROM files ORDER BY ${orderBy} ${order}`;
        const { rows: files } = await pool.query(query);
        
        res.render('file_list', { files: files, currentSort: orderBy, currentOrder: order });
        
    } catch (error) {
        console.error('DB 파일 목록 조회 오류:', error);
        res.status(500).send('파일 목록을 불러오는 중 오류가 발생했습니다. Render 로그를 확인하세요.');
    }
});

// 📤 D. 파일 업로드 처리 (server.js)
// upload.single('file')을 upload.array('files')로 변경
app.post('/upload', upload.array('files'), async (req, res) => { 
    
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('업로드할 파일이 없습니다.');
    }

    const filesToInsert = [];
    const files = req.files; // 업로드된 파일 배열

    try {
        for (const file of files) { // 파일 배열 반복 처리
            // 1. Vercel Blob에 파일 업로드 (파일명 깨짐 방지 포함)
            const encodedFileName = encodeURIComponent(file.originalname);
            
            const blob = await put(encodedFileName, file.buffer, {
                access: 'public',
                contentType: file.mimetype,
            });

            // 2. DB에 저장할 메타데이터 준비
            const fileName = file.originalname;
            const extension = path.extname(fileName).slice(1) || '';
            const sizeBytes = file.size;
            const blobUrl = blob.url;

            filesToInsert.push([fileName, extension, blobUrl, sizeBytes]);
        }
        
        // 3. 모든 파일 메타데이터를 DB에 일괄 저장
        // SQL 인젝션 방지를 위해 쿼리를 동적으로 생성
        const queryText = `
            INSERT INTO files(file_name, extension, blob_url, size_bytes) 
            VALUES ${filesToInsert.map((_, i) => `($${i*4 + 1}, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4})`).join(', ')}
            RETURNING *`;
        
        const queryValues = filesToInsert.flat();
        
        await pool.query(queryText, queryValues);

        console.log(`✅ ${files.length}개 파일 업로드 및 DB 저장 완료.`);
        res.redirect('/files');

    } catch (error) {
        console.error('❌ 파일 업로드 및 DB 저장 중 오류 발생:', error);
        res.status(500).send('다중 파일 업로드 처리 중 서버 오류가 발생했습니다.');
    }
});

// 🗑️ E. 파일 삭제 처리 (New Route)
app.post('/delete/:id', async (req, res) => {
    const fileId = req.params.id;
    
    try {
        // 1. DB에서 Blob URL 조회
        const { rows } = await pool.query('SELECT blob_url FROM files WHERE id = $1', [fileId]);
        
        if (rows.length === 0) {
            return res.status(404).send('삭제할 파일을 찾을 수 없습니다.');
        }
        
        const blobUrl = rows[0].blob_url;
        
        // 2. Vercel Blob에서 실제 파일 삭제
        await del(blobUrl);

        // 3. DB에서 메타데이터 삭제
        await pool.query('DELETE FROM files WHERE id = $1', [fileId]);

        console.log(`✅ 파일 삭제 완료 (ID: ${fileId})`);
        res.redirect('/files');

    } catch (error) {
        console.error('❌ 파일 삭제 중 오류 발생:', error);
        res.status(500).send('파일 삭제 처리 중 서버 오류가 발생했습니다.');
    }
});

// 🚪 F. 로그아웃 처리 (New Route)
app.get('/logout', (req, res) => {
    // 세션/쿠키를 사용하지 않으므로, 로그인 페이지로 리디렉션하여 재인증을 유도합니다.
    res.redirect('/');
});

// 📥 G. 다중 파일 다운로드 처리 (New Route - 보강됨)
app.get('/download-multiple', async (req, res) => {
    const fileIds = req.query.ids ? req.query.ids.split(',') : [];

    if (fileIds.length === 0) {
        return res.status(400).send('다운로드할 파일이 선택되지 않았습니다.');
    }

    // ZIP 아카이브 생성
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });
    
    // 에러 발생 시 스트림 중단 및 로그 기록
    archive.on('error', (err) => {
        console.error('Archiver Error:', err);
        res.status(500).send('ZIP 압축 중 오류가 발생했습니다.');
    });

    // 브라우저에 ZIP 파일임을 알리고 응답 스트림 연결
    res.attachment('files.zip');
    archive.pipe(res);

    try {
        // 1. DB에서 선택된 파일 정보 조회
        const { rows: files } = await pool.query(
            `SELECT file_name, blob_url FROM files WHERE id = ANY($1::int[])`, 
            [fileIds]
        );

        if (files.length === 0) {
            archive.finalize(); // 빈 ZIP 파일로 마무리
            return;
        }

        // 2. 각 파일을 Blob에서 읽어 ZIP에 추가
        for (const file of files) {
            const blobResponse = await fetch(file.blob_url);
            
            // fetch 응답이 스트림 가능한지 확인
            if (!blobResponse.ok || !blobResponse.body) {
                console.error(`Blob fetch failed for URL: ${file.blob_url}`);
                continue; 
            }
            
            // 파일 내용을 ZIP에 스트리밍으로 추가
            archive.append(blobResponse.body, { name: file.file_name });
        }

        // 3. 아카이브 마무리 및 응답 전송 (이 시점에서 응답이 완료됩니다)
        await archive.finalize();

    } catch (error) {
        console.error('❌ 다중 다운로드 (DB/Fetch) 중 오류 발생:', error);
        // 서버 측에서 에러가 발생하면 클라이언트 응답을 닫습니다.
        if (!res.headersSent) {
            res.status(500).send('서버 내부 오류로 다운로드를 완료할 수 없습니다.');
        } else {
            // 이미 헤더가 전송되었다면 스트림을 강제 종료
            res.end();
        }
    }
});

// ------------------------------------
// 3. 서버 시작
// ------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
