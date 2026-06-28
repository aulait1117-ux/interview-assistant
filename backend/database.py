import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "interview.db")


async def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        yield db


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                plan TEXT NOT NULL DEFAULT 'free',
                plan_expires_at TIMESTAMP,
                trial_minutes_used INTEGER NOT NULL DEFAULT 0,
                used_day_plan INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                plan TEXT NOT NULL,
                amount INTEGER NOT NULL,
                provider TEXT NOT NULL,
                provider_payment_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                interview_type TEXT NOT NULL,
                user_background TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                overall_feedback TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS qa_pairs (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                question TEXT NOT NULL,
                user_answer TEXT,
                ai_hints TEXT,
                feedback TEXT,
                score INTEGER,
                hint_used TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS practice_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                interview_type TEXT NOT NULL,
                category TEXT NOT NULL,
                question TEXT NOT NULL,
                difficulty INTEGER DEFAULT 1
            )
        """)
        await db.commit()
        await _seed_questions(db)


async def _seed_questions(db):
    count = await db.execute("SELECT COUNT(*) FROM practice_questions WHERE interview_type = '面接アシスト'")
    row = await count.fetchone()
    if row[0] > 0:
        return

    questions = [
        # 自己紹介
        ("面接アシスト", "自己紹介", "自己紹介をしてください。", 1),
        ("面接アシスト", "自己紹介", "あなたの強みと弱みを教えてください。", 1),
        ("面接アシスト", "自己紹介", "学生時代に最も力を入れたことを教えてください。", 1),
        # 志望動機
        ("面接アシスト", "志望動機", "なぜ弊社を志望しましたか？", 2),
        ("面接アシスト", "志望動機", "なぜこの業界を選んだのですか？", 2),
        ("面接アシスト", "志望動機", "10年後のキャリアビジョンを教えてください。", 2),
        # 行動質問
        ("面接アシスト", "行動質問", "困難を乗り越えた経験を教えてください。", 2),
        ("面接アシスト", "行動質問", "チームで成果を出した経験を教えてください。", 2),
        ("面接アシスト", "行動質問", "リーダーシップを発揮した経験はありますか？", 3),
        ("面接アシスト", "行動質問", "短期間で新しいことを学んだ経験はありますか？", 2),
        # スキル・経験
        ("面接アシスト", "スキル", "これまでに取り組んだプロジェクトを教えてください。", 2),
        ("面接アシスト", "スキル", "あなたの専門スキルを教えてください。", 1),
        # 逆質問
        ("面接アシスト", "逆質問", "入社前に準備しておくべきことはありますか？", 1),
        ("面接アシスト", "逆質問", "この会社で活躍するために必要なことを教えてください。", 2),
    ]
    await db.executemany(
        "INSERT INTO practice_questions (interview_type, category, question, difficulty) VALUES (?, ?, ?, ?)",
        questions
    )
    await db.commit()
