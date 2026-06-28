import os
import json
import asyncio
import anthropic
from dotenv import load_dotenv

load_dotenv()

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5"

INTERVIEW_TYPE_CONTEXT = {
    "就活": "日本の新卒就職活動（就活）の面接",
    "インターン": "インターンシップの選考面接",
    "英語面接": "英語での面接（外資系・グローバル企業）",
    "大学院入試": "大学院入学試験の面接",
    "面接アシスト": "就職・転職・インターンなどあらゆる面接",
}


async def generate_hints(
    question: str,
    interview_type: str,
    user_background: str | None,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_text = f"\n背景: {user_background}" if user_background else ""

    prompt = f"""{context}コーチ。質問への模範回答をJSONで返せ。{bg_text}
質問: {question}
{{"answer":"模範回答（150字、敬語、英語面接は英語）"}}
JSONのみ返すこと。"""

    message = await client.messages.create(
        model=MODEL,
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


async def generate_hints_stream(
    question: str,
    interview_type: str,
    user_background: str | None,
):
    """Async generator that yields text chunks from the streaming API."""
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_text = f"\n背景: {user_background}" if user_background else ""

    prompt = f"""{context}コーチ。質問への模範回答を返せ。{bg_text}
質問: {question}
模範回答（150字程度、敬語、英語面接は英語）を直接テキストで返すこと。"""

    async with client.messages.stream(
        model=MODEL,
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def evaluate_answer(
    question: str,
    user_answer: str,
    interview_type: str,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")

    prompt = f"""あなたは{context}の採用コーチです。応募者の回答を評価し、改善案を提示してください。

面接種別: {interview_type}
質問: {question}
応募者の回答: {user_answer}

以下のJSON形式で評価してください：
{{
  "score": 75,
  "feedback": "全体的な評価コメント（2〜3文）",
  "improved_answer": "改善した模範回答（応募者の回答を元に改善したもの）",
  "points": [
    "良かった点",
    "改善ポイント1",
    "改善ポイント2"
  ]
}}

スコアは0〜100点。改善した模範回答は応募者の個性を活かしつつ改善したもの。"""

    message = await client.messages.create(
        model=MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])


async def research_company_from_urls(company_name: str, urls: list[str]) -> dict:
    from .search_service import fetch_page_text

    pages_content = []
    for url in urls[:3]:
        text = await fetch_page_text(url, max_chars=3000)
        if text:
            pages_content.append(f"--- URL: {url} ---\n{text}")

    combined = "\n\n".join(pages_content) if pages_content else "ページの取得に失敗しました。"

    prompt = f"""以下のウェブページの内容をもとに、就活生が面接前に知っておくべき企業情報をまとめてください。

企業名: {company_name}

【ページ内容】
{combined[:5000]}

以下のJSON形式で回答してください：
{{
  "overview": "企業の概要（事業内容・規模など2〜3文）",
  "business": "主な事業・サービス（箇条書き3〜5点）",
  "culture": "企業文化・社風・理念・特徴",
  "strengths": "企業の強み・競合優位性・独自性",
  "recent_topics": "最近の取り組み・注目点（ページから読み取れる範囲で）",
  "interview_tips": "このページの内容から読み取れる、面接で使えるポイント・志望動機に活かせる情報"
}}

ページに記載のない情報は無理に作成せず「記載なし」と記載してください。"""

    message = await client.messages.create(
        model=MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        result = {
            "overview": "ページの解析に失敗しました。URLが正しいか確認してください。",
            "business": "", "culture": "", "strengths": "",
            "recent_topics": "", "interview_tips": "",
        }
    else:
        result = json.loads(text[start:end])
    result["sources"] = [{"title": url, "url": url} for url in urls]
    return result


async def mock_interview_start(
    interview_type: str,
    user_background: str | None,
    company_info: str | None,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg = f"\n応募者の背景:\n{user_background}" if user_background else ""
    co = f"\n企業情報:\n{company_info}" if company_info else ""

    prompt = f"""あなたは{context}の面接官です。今から模擬面接を開始します。
{bg}{co}

最初の質問を1つしてください。定番の自己紹介から始めてください。

以下のJSON形式で返してください：
{{
  "message": "面接官としての開始の挨拶 + 最初の質問（自然な面接官口調で）",
  "question": "質問文だけ（評価用）",
  "question_number": 1,
  "total_questions": 6
}}"""

    msg = await client.messages.create(model=MODEL, max_tokens=600,
                                       messages=[{"role": "user", "content": prompt}])
    text = msg.content[0].text
    s, e = text.find("{"), text.rfind("}") + 1
    return json.loads(text[s:e])


async def mock_interview_evaluate_and_next(
    history: list[dict],
    user_answer: str,
    interview_type: str,
    user_background: str | None,
    question_number: int,
    total_questions: int,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg = f"\n応募者の背景:\n{user_background}" if user_background else ""

    history_text = "\n".join([
        f"面接官: {h['question']}\n応募者: {h['answer']}"
        for h in history
    ])
    current_q = history[-1]["question"] if history else ""

    is_last = question_number >= total_questions

    if is_last:
        next_instruction = "これが最後の質問への回答です。面接を締めくくる言葉を添えてください。next_questionはnullにしてください。"
    else:
        next_instruction = f"次の質問（第{question_number + 1}問）を1つしてください。前の回答を踏まえた自然な流れで。"

    prompt = f"""あなたは{context}の面接官です。応募者の回答を評価し、次の質問をしてください。
{bg}

【これまでの面接】
{history_text}

【今回の質問】
{current_q}

【応募者の回答】
{user_answer}

{next_instruction}

以下のJSON形式で返してください：
{{
  "score": 75,
  "feedback": "この回答への簡潔なコメント（1〜2文、面接官として自然に）",
  "good_points": "良かった点（1文）",
  "improve_point": "改善点（1文、あれば）",
  "message": "面接官としての返答 + 次の質問（自然な口調。最後の場合は締めくくりの言葉）",
  "next_question": "次の質問文だけ（最後の場合はnull）",
  "is_finished": {str(is_last).lower()}
}}"""

    msg = await client.messages.create(model=MODEL, max_tokens=800,
                                       messages=[{"role": "user", "content": prompt}])
    text = msg.content[0].text
    s, e = text.find("{"), text.rfind("}") + 1
    return json.loads(text[s:e])


async def mock_interview_report(history: list[dict], interview_type: str) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    qa_text = "\n".join([
        f"Q{i+1}: {h['question']}\nA{i+1}: {h['answer']}\n評価: {h.get('score', '?')}点"
        for i, h in enumerate(history)
    ])

    prompt = f"""あなたは{context}のキャリアコーチです。模擬面接全体の総評を出してください。

【面接記録】
{qa_text}

以下のJSON形式で総評を作成してください：
{{
  "overall_score": 72,
  "grade": "B",
  "summary": "総評（3〜4文）",
  "strengths": ["強み1", "強み2", "強み3"],
  "improvements": ["改善点1（具体的に）", "改善点2", "改善点3"],
  "action_items": ["次の面接までにやること1", "やること2", "やること3"]
}}

gradeはS/A/B/C/Dで。"""

    msg = await client.messages.create(model=MODEL, max_tokens=1000,
                                       messages=[{"role": "user", "content": prompt}])
    text = msg.content[0].text
    s, e = text.find("{"), text.rfind("}") + 1
    return json.loads(text[s:e])


async def generate_session_feedback(qa_pairs: list[dict], interview_type: str) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")

    qa_text = "\n".join([
        f"Q{i+1}: {qa['question']}\nA{i+1}: {qa.get('user_answer', '（回答なし）')}"
        for i, qa in enumerate(qa_pairs)
    ])

    prompt = f"""あなたは{context}のキャリアコーチです。面接セッション全体を振り返り、総合フィードバックを提供してください。

面接種別: {interview_type}

【面接の質問と回答】
{qa_text}

以下のJSON形式で総合フィードバックを作成してください：
{{
  "overall_score": 72,
  "summary": "セッション全体の総評（3〜4文）",
  "strengths": [
    "セッションを通じて見られた強み1",
    "セッションを通じて見られた強み2",
    "セッションを通じて見られた強み3"
  ],
  "improvements": [
    "改善が必要な点1（具体的に）",
    "改善が必要な点2（具体的に）",
    "改善が必要な点3（具体的に）"
  ],
  "action_items": [
    "次の面接までにやること1",
    "次の面接までにやること2",
    "次の面接までにやること3"
  ]
}}

スコアは0〜100点。具体的で実行可能なフィードバックを。"""

    message = await client.messages.create(
        model=MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text
    start = text.find("{")
    end = text.rfind("}") + 1
    return json.loads(text[start:end])
