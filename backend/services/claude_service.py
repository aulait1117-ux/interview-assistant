import os
from pathlib import Path
import anthropic
from dotenv import load_dotenv

_here = Path(__file__).resolve().parent.parent
load_dotenv(_here / ".env")
load_dotenv(_here.parent / ".env")

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

MODEL_FAST = "claude-haiku-4-5-20251001"  # 速度優先（ヒント生成・ストリーミング）
MODEL_QUALITY = "claude-sonnet-4-6"       # 品質優先（評価・企業研究・フィードバック）

INTERVIEW_TYPE_CONTEXT = {
    "就活": "日本の新卒就職活動（就活）の面接",
    "インターン": "インターンシップの選考面接",
    "英語面接": "英語での面接（外資系・グローバル企業）",
    "大学院入試": "大学院入学試験の面接",
    "面接アシスト": "就職・転職・インターンなどあらゆる面接",
}

# ─────────────────────────────────────────────
# システムプロンプト（プロンプトキャッシュ対象 / 1024トークン以上で有効）
# ─────────────────────────────────────────────
BASE_COACH_SYSTEM = """あなたは日本の面接専門コーチです。就職活動、転職、インターンシップ、大学院入試など、あらゆる面接場面で応募者を支援する経験豊富なプロフェッショナルです。

## 専門知識

### 日本の就活文化
- 新卒一括採用の仕組みと企業が求めるポテンシャル採用の考え方
- 自己分析（強み・弱み・価値観の言語化）の手法
- ガクチカ（学生時代に力を入れたこと）の構成と表現方法
- 志望動機の説得力ある組み立て方（なぜこの業界→なぜこの企業→なぜこの職種）
- 逆質問の戦略的な活用方法

### 面接形式別の対策
- 個人面接・集団面接・グループディスカッション
- ケース面接（フェルミ推定・課題解決型）
- 英語面接（外資系・グローバル企業向け、STAR法の英語表現）
- 技術面接・専門職面接
- 大学院・研究職の面接（研究内容の平易な説明・学術的背景のアピール）

### 業界別の特徴
- 総合商社・金融・コンサル・IT・メーカー・インフラ・医療・教育・公務員
- 各業界が重視する素養とアピールすべきポイント

## 回答品質の基準

### 構成（STAR法を基本とする）
- Situation（状況）：簡潔に背景を説明する
- Task（課題）：自分が取り組んだ課題・目標を明確にする
- Action（行動）：具体的にどう動いたかを主語を「私」にして述べる
- Result（結果）：数値や事実で成果を示し、学びにつなげる

### 表現の原則
1. 具体性：抽象的な表現より具体的なエピソード・数字・期間・規模を優先する
2. 簡潔さ：面接官が理解しやすい150〜200字を目安とし、冗長にしない
3. 自然さ：暗記した台本でなく、自然な話し言葉に近い敬語で表現する
4. 個別最適化：応募者の業界・企業文化・職種に合わせてカスタマイズする
5. 一貫性：他の質問への回答と矛盾しないよう整合性を保つ

### 評価観点（100点満点）
- 論理的構成（25点）：結論ファースト・話の流れが明確か
- 具体性・エビデンス（25点）：数字・固有名詞・エピソードで裏付けられているか
- 企業・職種への適合性（25点）：企業研究が反映されているか・ポジションに合っているか
- 表現・言語力（25点）：敬語・語彙・話しやすさが適切か

## 絶対に守るルール
- 応募者を傷つける批判はしない。改善点は必ず「どう直すか」まで提示する
- スコアは甘くつけない。実際の面接選考基準に準拠し、70点台が平均的な水準
- 英語面接では英語で回答を生成する
- 「です・ます」調を基本とし、話し言葉に近い自然な敬語を使う"""

BASE_EVALUATOR_SYSTEM = BASE_COACH_SYSTEM + """

## 評価時の追加指針
- 厳しさと建設性のバランスを保つ。採用担当者目線で本質的なフィードバックを提供する
- 改善後の模範回答は応募者の個性・エピソードを活かしつつ洗練させる
- 「良かった点」を必ず1つ以上含め、改善意欲を損なわない
- 実際の面接では一度しか言えないことを念頭に、本番で使える回答を目指す"""


# ─────────────────────────────────────────────
# ツール定義（tool_use で型安全な構造化出力）
# ─────────────────────────────────────────────
def _hint_tool() -> dict:
    return {
        "name": "output_hint",
        "description": "面接質問への模範回答・ポイントを出力する",
        "input_schema": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": "模範回答（150〜200字程度。英語面接は英語で。敬語・話し言葉に近い自然な表現）"
                },
                "short_answer": {
                    "type": "string",
                    "description": "一言まとめ（30字以内。回答の核心を凝縮した一文）"
                },
                "key_points": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "回答の重要ポイント3点（各20〜40字）"
                },
                "caution": {
                    "type": "string",
                    "description": "この質問で陥りがちな落とし穴・注意点（任意）"
                }
            },
            "required": ["answer", "short_answer", "key_points"]
        }
    }


def _evaluation_tool() -> dict:
    return {
        "name": "output_evaluation",
        "description": "面接回答の評価結果を出力する",
        "input_schema": {
            "type": "object",
            "properties": {
                "score": {
                    "type": "integer",
                    "description": "0〜100点。実際の面接基準に準拠（70点台が平均水準）"
                },
                "feedback": {
                    "type": "string",
                    "description": "全体評価コメント（2〜3文。良い点と改善点のバランスよく）"
                },
                "improved_answer": {
                    "type": "string",
                    "description": "応募者の回答を元に改善した模範回答（個性を活かしつつ洗練）"
                },
                "points": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "評価ポイント（良かった点1つ、改善点2つ、計3つ）"
                }
            },
            "required": ["score", "feedback", "improved_answer", "points"]
        }
    }


def _company_research_tool() -> dict:
    return {
        "name": "output_company_research",
        "description": "就活生向け企業研究サマリーを出力する",
        "input_schema": {
            "type": "object",
            "properties": {
                "overview": {"type": "string", "description": "企業概要（事業内容・規模・設立など2〜3文）"},
                "business": {"type": "string", "description": "主な事業・サービス（箇条書き3〜5点）"},
                "culture": {"type": "string", "description": "企業文化・社風・経営理念・求める人物像"},
                "strengths": {"type": "string", "description": "企業の強み・競合優位性・独自性"},
                "recent_topics": {"type": "string", "description": "最近の取り組み・ニュース・注目点"},
                "interview_tips": {"type": "string", "description": "面接で使えるポイント・志望動機に活かせる情報・想定質問"}
            },
            "required": ["overview", "business", "culture", "strengths", "recent_topics", "interview_tips"]
        }
    }


def _session_feedback_tool() -> dict:
    return {
        "name": "output_session_feedback",
        "description": "面接セッション全体の総合フィードバックを出力する",
        "input_schema": {
            "type": "object",
            "properties": {
                "overall_score": {"type": "integer", "description": "セッション全体の総合スコア（0〜100点）"},
                "summary": {"type": "string", "description": "セッション全体の総評（3〜4文。傾向・強み・課題を総括）"},
                "strengths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "セッションを通じて見られた強み（3点）"
                },
                "improvements": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "改善が必要な点（3点。具体的で実行可能な内容）"
                },
                "action_items": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "次の面接までにやるべきアクション（3点）"
                }
            },
            "required": ["overall_score", "summary", "strengths", "improvements", "action_items"]
        }
    }


def _extract_tool_result(message) -> dict:
    """tool_use ブロックから input を取り出す"""
    for block in message.content:
        if block.type == "tool_use":
            return block.input
    raise ValueError(f"ツール結果が見つかりません: {message.content}")


# ─────────────────────────────────────────────
# トークン数カウント（コスト見積もり用）
# ─────────────────────────────────────────────
async def count_tokens(messages: list, system: list | None = None) -> int:
    response = await client.messages.count_tokens(
        model=MODEL_FAST,
        system=system or [],
        messages=messages,
    )
    return response.input_tokens


# ─────────────────────────────────────────────
# 機能実装
# ─────────────────────────────────────────────
def _build_personalize_section(job_title: str | None, interview_type_pref: str | None) -> str:
    """応募職種・面接タイプのコンテキスト文字列を生成する"""
    lines = []
    if job_title:
        lines.append(f"応募職種: {job_title}")
    if interview_type_pref:
        focus_map = {
            "1次面接": "基本的な自己紹介・モチベーション・ガクチカを重視。コミュニケーション能力が評価される。",
            "2次面接": "職種理解・スキルマッチ・具体的な業務経験を重視。現場社員が面接官になることが多い。",
            "最終面接": "企業理解の深さ・長期ビジョン・カルチャーフィットを重視。役員が面接官。",
            "グループディスカッション": "チームワーク・論理的思考・役割分担（進行役・書記等）を重視。",
        }
        focus = focus_map.get(interview_type_pref, "")
        lines.append(f"面接タイプ: {interview_type_pref}" + (f"（{focus}）" if focus else ""))
    return ("\n" + "\n".join(lines)) if lines else ""


async def generate_hints(
    question: str,
    interview_type: str,
    user_background: str | None,
    job_title: str | None = None,
    interview_type_pref: str | None = None,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_text = f"\n応募者の背景: {user_background}" if user_background else ""
    personalize = _build_personalize_section(job_title, interview_type_pref)

    message = await client.messages.create(
        model=MODEL_FAST,
        max_tokens=600,
        system=[{
            "type": "text",
            "text": BASE_COACH_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        tools=[_hint_tool()],
        tool_choice={"type": "tool", "name": "output_hint"},
        messages=[{
            "role": "user",
            "content": f"面接種別: {context}{personalize}{bg_text}\n\n質問: {question}\n\n模範回答とポイントを出力してください。"
        }],
    )
    return _extract_tool_result(message)


async def generate_hints_stream(
    question: str,
    interview_type: str,
    user_background: str | None,
    job_title: str | None = None,
    interview_type_pref: str | None = None,
):
    """ストリーミング用（リアルタイム表示のためテキスト出力を維持）"""
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_section = f"\n\n【応募者の情報】\n{user_background}" if user_background else ""
    personalize = _build_personalize_section(job_title, interview_type_pref)
    personalize_section = f"\n\n【応募職種・面接タイプ】\n{personalize.strip()}" if personalize.strip() else ""

    prompt = f"""面接種別: {context}{personalize_section}{bg_section}

【音声認識テキスト（Whisper自動文字起こし・誤認識あり）】
「{question}」

音が似た言葉への誤変換例: 長所→聴者、短所→単純、強み→攻め、弱み→悪み 等

【よくある面接質問（推測候補）】
- 自己紹介をしてください
- 強み・長所を教えてください
- 弱み・短所を教えてください
- 強みと弱みを教えてください
- 学生時代に力を入れたこと（ガクチカ）を教えてください
- 自己PRをしてください
- なぜ弊社を志望しましたか
- なぜこの業界・職種を選びましたか
- 5年後・10年後のビジョンを教えてください
- チームで取り組んだ経験を教えてください
- リーダーシップを発揮した経験はありますか
- 困難・失敗を乗り越えた経験を教えてください
- 仕事をする上で大切にしていることは何ですか
- 弊社に貢献できることは何ですか
- 何か質問はありますか

出力ルール（厳守）:
- 音が似た誤変換を積極的に補正して質問を推測する
- 推測できた場合: 1行目に「▶ 推測: 〇〇〇」（質問を30字以内で）と書き、改行して回答本文を書く
- 推測できない場合: 「聞き取れませんでした」の1行だけ出力して終了
- 回答本文: 応募者情報を活かした自然な話し言葉の敬語、結論から入り150字程度、面接でそのまま読み上げられる内容のみ
- マークダウン記法（#・**・_など）は使わない
- 「▶ 推測:」行以外の前置き・説明・構成解説は一切不要"""

    async with client.messages.stream(
        model=MODEL_FAST,
        max_tokens=350,
        system=[{
            "type": "text",
            "text": BASE_COACH_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        messages=[{
            "role": "user",
            "content": prompt
        }],
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def evaluate_answer(
    question: str,
    user_answer: str,
    interview_type: str,
) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")

    message = await client.messages.create(
        model=MODEL_QUALITY,
        max_tokens=1200,
        system=[{
            "type": "text",
            "text": BASE_EVALUATOR_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        tools=[_evaluation_tool()],
        tool_choice={"type": "tool", "name": "output_evaluation"},
        messages=[{
            "role": "user",
            "content": f"面接種別: {context}\n質問: {question}\n応募者の回答: {user_answer}\n\n採用担当者目線で評価してください。"
        }],
    )
    return _extract_tool_result(message)


async def research_company_from_urls(company_name: str, urls: list[str]) -> dict:
    from services.search_service import fetch_page_text, fetch_company_info_by_name

    pages_content = []
    valid_urls = [u for u in urls if u.strip().startswith("http")]

    for url in valid_urls[:3]:
        text = await fetch_page_text(url, max_chars=3000)
        if text:
            pages_content.append(f"--- URL: {url} ---\n{text}")

    name_info = ""
    if not pages_content and company_name.strip():
        name_info = await fetch_company_info_by_name(company_name.strip())

    if pages_content:
        combined = "\n\n".join(pages_content)
        source_note = "ウェブページの内容"
    elif name_info:
        combined = name_info
        source_note = "Wikipedia・DuckDuckGo等の公開情報"
    else:
        combined = f"{company_name}についての情報が取得できませんでした。"
        source_note = "情報なし"

    message = await client.messages.create(
        model=MODEL_QUALITY,
        max_tokens=1500,
        system=[{
            "type": "text",
            "text": BASE_COACH_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        tools=[_company_research_tool()],
        tool_choice={"type": "tool", "name": "output_company_research"},
        messages=[{
            "role": "user",
            "content": (
                f"企業名: {company_name}\n"
                f"情報ソース: {source_note}\n\n"
                f"【取得情報】\n{combined[:5000]}\n\n"
                "就活生が面接前に知っておくべき企業情報をまとめてください。"
                "取得情報に記載のない項目は「記載なし」としてください。"
            )
        }],
    )

    result = _extract_tool_result(message)
    result["sources"] = [{"title": url, "url": url} for url in valid_urls]
    return result


async def generate_session_feedback(qa_pairs: list[dict], interview_type: str) -> dict:
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    qa_text = "\n".join([
        f"Q{i+1}: {qa['question']}\nA{i+1}: {qa.get('user_answer', '（回答なし）')}"
        for i, qa in enumerate(qa_pairs)
    ])

    message = await client.messages.create(
        model=MODEL_QUALITY,
        max_tokens=1500,
        system=[{
            "type": "text",
            "text": BASE_EVALUATOR_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        tools=[_session_feedback_tool()],
        tool_choice={"type": "tool", "name": "output_session_feedback"},
        messages=[{
            "role": "user",
            "content": f"面接種別: {context}\n\n【面接の質問と回答】\n{qa_text}\n\nセッション全体の総合フィードバックを出力してください。"
        }],
    )
    return _extract_tool_result(message)


# ─────────────────────────────────────────────
# モック面接（削除済みルートの互換性のため残存）
# ─────────────────────────────────────────────
async def mock_interview_start(
    interview_type: str,
    user_background: str | None,
    company_info: str | None,
) -> dict:
    import json
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg = f"\n応募者の背景:\n{user_background}" if user_background else ""
    co = f"\n企業情報:\n{company_info}" if company_info else ""

    message = await client.messages.create(
        model=MODEL_FAST,
        max_tokens=600,
        system=[{"type": "text", "text": BASE_COACH_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                f"あなたは{context}の面接官です。今から模擬面接を開始します。{bg}{co}\n\n"
                "最初の質問（自己紹介から）を面接官として自然な口調でしてください。\n"
                '{"message":"開始の挨拶+質問","question":"質問文","question_number":1,"total_questions":6} の形式でJSONのみ返してください。'
            )
        }],
    )
    text = message.content[0].text
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
    import json
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg = f"\n応募者の背景:\n{user_background}" if user_background else ""
    history_text = "\n".join([f"面接官: {h['question']}\n応募者: {h['answer']}" for h in history])
    current_q = history[-1]["question"] if history else ""
    is_last = question_number >= total_questions

    message = await client.messages.create(
        model=MODEL_QUALITY,
        max_tokens=800,
        system=[{"type": "text", "text": BASE_EVALUATOR_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                f"あなたは{context}の面接官です。{bg}\n\n"
                f"【これまでの面接】\n{history_text}\n\n"
                f"【今回の質問】{current_q}\n【応募者の回答】{user_answer}\n\n"
                f"{'最後の質問なので締めくくりを。next_questionはnull。' if is_last else f'次（第{question_number+1}問）の質問をしてください。'}\n"
                f'{{"score":75,"feedback":"コメント","good_points":"良い点","improve_point":"改善点","message":"返答+次の質問","next_question":"次の質問またはnull","is_finished":{str(is_last).lower()}}} のJSONのみ返してください。'
            )
        }],
    )
    text = message.content[0].text
    s, e = text.find("{"), text.rfind("}") + 1
    return json.loads(text[s:e])


async def mock_interview_report(history: list[dict], interview_type: str) -> dict:
    import json
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    qa_text = "\n".join([
        f"Q{i+1}: {h['question']}\nA{i+1}: {h['answer']}\n評価: {h.get('score','?')}点"
        for i, h in enumerate(history)
    ])

    message = await client.messages.create(
        model=MODEL_QUALITY,
        max_tokens=1000,
        system=[{"type": "text", "text": BASE_EVALUATOR_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                f"面接種別: {context}\n\n【面接記録】\n{qa_text}\n\n"
                '模擬面接全体の総評を {"overall_score":72,"grade":"B","summary":"総評","strengths":[],"improvements":[],"action_items":[]} のJSONで返してください。gradeはS/A/B/C/D。'
            )
        }],
    )
    text = message.content[0].text
    s, e = text.find("{"), text.rfind("}") + 1
    return json.loads(text[s:e])
