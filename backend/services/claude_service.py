import os
import re
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
- 「です・ます」調を基本とし、話し言葉に近い自然な敬語を使う

## 誠実性のルール（絶対厳守）
- 応募者から与えられていない具体的な経験・実績・数字・resultを新しく作り出さない。情報が不足する場合は「一般的にはこう構成する」という骨子を示すに留め、断定的な個人エピソードとして語らない
- 企業に関する事実は、与えられた企業情報の範囲内でのみ言及する。企業の事業内容・実績・社風を、根拠なく断定的に書かない（不明な場合は言及を避けるか「企業研究で確認してください」と促す）
- これは面接の準備・練習を支援するためのものであり、本人が実際に話せない内容（存在しない資格・経験）を「あります」と言わせる回答は作らない
- 盛りすぎ・話を大きくしすぎた回答は避ける。誇張が疑われる場合は`caution`等の注意点欄で指摘する

## 話す速度の目安（回答の長さ設計に使う）
日本語の面接での自然な話速はおおよそ300字/分。
- 30秒で話せる長さ：120〜150字
- 60秒で話せる長さ：250〜300字
（実測値ではなく目安。個人の話す速度により前後する）"""

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
        "description": (
            "面接質問への回答案を、30秒版・60秒版・深掘り対策・使った情報・注意点を含めて出力する。"
            "面接の準備・練習を支援するためのものであり、応募者本人が実際に話せる範囲の内容に留めること。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "answer_30s": {
                    "type": "string",
                    "description": "30秒で話せる短い回答（120〜150字。150字を超えたら文を削って必ず収める）。結論から入り、話し言葉に近い自然な敬語で。暗記調にしない"
                },
                "answer_60s": {
                    "type": "string",
                    "description": "60秒で話せる詳しい回答（250〜300字。300字を超えたら文を削って必ず収める）。30秒版の内容を土台に具体例を1つ追加する。話し言葉で"
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
                "follow_up_questions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "この回答に対して面接官が深掘りしてきそうな質問（2〜3点）。回答内容と矛盾しない前提で"
                },
                "used_info": {
                    "type": "object",
                    "properties": {
                        "personal": {"type": "string", "description": "回答に使った個人情報の要約（なければ「特になし」）"},
                        "company": {"type": "string", "description": "回答に使った企業情報の要約（なければ「特になし」）"},
                        "registered_answer": {"type": "string", "description": "参照した登録回答のカテゴリ名（なければ「特になし」）"}
                    },
                    "required": ["personal", "company", "registered_answer"],
                    "description": "この回答を作る際に実際に使った情報の出典。応募者が事実確認できるようにするための透明性表示"
                },
                "caution": {
                    "type": "string",
                    "description": "この回答で盛りすぎ・言い過ぎ・確認不足になりやすい点があれば具体的に指摘する（なければ空文字）"
                }
            },
            "required": ["answer_30s", "answer_60s", "short_answer", "key_points", "follow_up_questions", "used_info", "caution"]
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
# 登録回答モード検出
# ─────────────────────────────────────────────

CATEGORY_PATTERNS = [
    {
        "category": "自己PR",
        "keywords": [("自己PR", 2), ("自己ピーアール", 2), ("自己紹介", 2), ("自分をアピール", 1), ("一言で表す", 1), ("あなたについて", 1), ("どんな人", 1)],
        "profile_key": "自己PR",
    },
    {
        "category": "強み",
        "keywords": [("強み", 2), ("長所", 2), ("アピールポイント", 2), ("得意なこと", 1), ("得意", 1), ("自信", 1), ("優れている", 1), ("できること", 1)],
        "profile_key": "強み",
    },
    {
        "category": "長所・短所",
        "keywords": [("弱み", 2), ("短所", 2), ("長所と短所", 2), ("苦手", 1), ("克服", 1), ("課題", 1), ("改善したい", 1), ("直したい", 1)],
        "profile_key": "長所・短所",
    },
    {
        "category": "ガクチカ",
        "keywords": [("学生時代", 2), ("力を入れた", 2), ("ガクチカ", 2), ("頑張ったこと", 1), ("打ち込んだ", 1), ("経験", 1), ("取り組んだ", 1), ("活動", 1), ("サークル", 1), ("部活", 1), ("研究", 1)],
        "profile_key": "ガクチカ",
    },
    {
        "category": "志望動機",
        "keywords": [("志望", 2), ("なぜ弊社", 2), ("なぜ当社", 2), ("この会社を選んだ", 2), ("なぜこの業界", 2), ("応募した理由", 2), ("選んだ理由", 2), ("入社したい", 1), ("弊社に", 1), ("当社に", 1), ("入りたい", 1)],
        "profile_key": "志望理由",
    },
    {
        "category": "キャリアプラン",
        "keywords": [("キャリア", 2), ("5年後", 2), ("10年後", 2), ("ビジョン", 2), ("将来", 1), ("目標", 1), ("どうなりたい", 1), ("成長", 1), ("目指す", 1)],
        "profile_key": "キャリアビジョン",
    },
    {
        "category": "アルバイト経験",
        "keywords": [("アルバイト", 2), ("バイト", 2), ("社会人経験", 2), ("インターン", 2), ("仕事の経験", 1), ("働いた", 1)],
        "profile_key": "アルバイト・社会人経験",
    },
    {
        "category": "スキル・資格",
        "keywords": [("資格", 2), ("スキル", 2), ("TOEIC", 2), ("プログラミング", 2), ("語学", 1), ("得意分野", 1), ("英語", 1), ("専門", 1)],
        "profile_key": "資格・スキル",
    },
]

# 判定しきい値（キーワードの重みの合計スコアに対する基準）
# 強キーワード = 2点・弱キーワード = 1点。カテゴリ間で共通の基準にし、
# 旧実装にあった「志望動機だけ1語で確定」のような特例は廃止した。
REGISTERED_THRESHOLD = 4  # 例: 強キーワード2つ相当。登録回答をそのまま活用してよい確信度
HYBRID_THRESHOLD = 2      # 例: 強キーワード1つ、または弱キーワード2つ相当。参考程度に使う
MIN_REGISTERED_ANSWER_LEN = 10  # これより短い登録回答は「実質未入力」とみなし使わない


def _parse_profile_fields(user_background: str) -> dict:
    """user_background のテキストをキー:値の辞書に変換する"""
    result = {}
    for line in user_background.split("\n"):
        if ": " in line:
            key, _, value = line.partition(": ")
            result[key.strip()] = value.strip()
    return result


def _bigram_overlap(a: str, b: str) -> float:
    """
    2文字bigramのJaccard類似度を返す（0.0〜1.0）。
    埋め込みベクトルによる意味的類似度ではなく、あくまで文字レベルの簡易な近さの指標。
    キーワードスコアが同点のときのタイブレークにのみ使う。
    """
    def bigrams(s: str) -> set:
        s = re.sub(r"\s", "", s)
        return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) >= 2 else set()

    ba, bb = bigrams(a), bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / len(ba | bb)


def detect_answer_mode(
    question: str, user_background: str | None
) -> tuple[str, str, str, str]:
    """
    質問がプロフィールの登録情報と合致するか検出する。
    キーワード一致（強=2点/弱=1点）でスコアリングし、同点の場合は質問文と
    登録回答本文の文字bigram類似度をタイブレークに使う（簡易な意味的近さの代替）。
    Returns: (mode, category, registered_answer, reason)
    mode: 'ai' | 'registered' | 'hybrid'
    """
    if not user_background:
        return "ai", "", "", ""

    profile = _parse_profile_fields(user_background)

    best_score = 0
    best_category = ""
    best_answer = ""
    best_reason = ""
    best_overlap = 0.0

    for config in CATEGORY_PATTERNS:
        score = 0
        matched: list[str] = []
        for kw, weight in config["keywords"]:
            if kw in question:
                score += weight
                matched.append(kw)

        if score == 0:
            continue

        profile_key = config["profile_key"]
        pval = ""
        for k, v in profile.items():
            if profile_key in k or k in profile_key:
                if v and len(v) >= MIN_REGISTERED_ANSWER_LEN:
                    pval = v
                    break

        if not pval:
            continue

        overlap = _bigram_overlap(question, pval)
        if score > best_score or (score == best_score and overlap > best_overlap):
            best_score = score
            best_category = config["category"]
            best_answer = pval
            best_overlap = overlap
            best_reason = f"「{'」「'.join(matched)}」が質問に含まれています（一致度スコア{score}）"

    if best_score >= REGISTERED_THRESHOLD:
        return "registered", best_category, best_answer, best_reason
    if best_score >= HYBRID_THRESHOLD:
        return "hybrid", best_category, best_answer, best_reason
    return "ai", "", "", ""


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
    """
    面接準備・練習用の詳細な回答案（30秒版・60秒版・深掘り対策・使った情報・注意点）を生成する。
    リアルタイムの生放送用途（hint-stream/overlay-hint-stream）とは別の、
    事前準備画面向けの構造化出力。ストリーミング版と同じくモード検出（AI生成/登録回答/ハイブリッド）を使う。
    """
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_text = f"\n応募者の背景: {user_background}" if user_background else ""
    personalize = _build_personalize_section(job_title, interview_type_pref)

    mode, category, registered_answer, reason = detect_answer_mode(question, user_background)

    if mode == "registered":
        mode_instruction = (
            f"【{category}として事前登録された回答】\n{registered_answer}\n\n"
            "この登録回答をベースに、エピソード・数字を変えずに今回の質問へ最小限だけ調整してください。"
            "used_info.registered_answer には参照したカテゴリ名を入れてください。"
        )
    elif mode == "hybrid":
        mode_instruction = (
            f"【参考: {category}として事前登録された回答】\n{registered_answer}\n\n"
            "登録回答の核（エピソード・強み・結論）を活かしつつ、今回の質問の焦点に合わせて調整してください。"
            "新しいエピソードは作らないでください。used_info.registered_answer には参照したカテゴリ名を入れてください。"
        )
    else:
        mode_instruction = (
            "登録回答はありません。応募者情報の範囲内で新しく回答を組み立ててください。"
            "情報が不足する場合は一般的な回答の骨子に留め、実体験として断定しないでください。"
            "used_info.registered_answer には「特になし」と入れてください。"
        )

    message = await client.messages.create(
        model=MODEL_FAST,
        max_tokens=900,
        system=[{
            "type": "text",
            "text": BASE_COACH_SYSTEM,
            "cache_control": {"type": "ephemeral"}
        }],
        tools=[_hint_tool()],
        tool_choice={"type": "tool", "name": "output_hint"},
        messages=[{
            "role": "user",
            "content": f"面接種別: {context}{personalize}{bg_text}\n\n質問: {question}\n\n{mode_instruction}\n\n30秒版・60秒版の回答案と、使った情報・注意点を出力してください。"
        }],
    )
    result = _extract_tool_result(message)
    result["mode"] = mode
    result["match_category"] = category
    result["match_reason"] = reason
    return result


async def generate_hints_stream(
    question: str,
    interview_type: str,
    user_background: str | None,
    job_title: str | None = None,
    interview_type_pref: str | None = None,
    forced_mode: str | None = None,
    used_categories: list[str] | None = None,
):
    """
    ストリーミング用（リアルタイム表示のためテキスト出力を維持）。
    used_categories: この面接セッション内で既に使われた登録回答カテゴリのリスト。
    同じエピソードが複数の質問で使い回されて面接官に「同じ話ばかり」と思われることを防ぐため、
    再利用時は自然な一言を添えるようAIに指示する。
    """
    context = INTERVIEW_TYPE_CONTEXT.get(interview_type, "面接")
    bg_section = f"\n\n【応募者の情報】\n{user_background}" if user_background else ""
    personalize = _build_personalize_section(job_title, interview_type_pref)
    personalize_section = f"\n\n【応募職種・面接タイプ】\n{personalize.strip()}" if personalize.strip() else ""

    # モード検出 (forced_mode が指定されていればそちらを優先)
    auto_mode, category, registered_answer, reason = detect_answer_mode(question, user_background)
    if forced_mode in ("ai", "registered", "hybrid"):
        mode = forced_mode
        # forced で registered/hybrid を選んだが登録データがない場合は ai にフォールバック
        if mode in ("registered", "hybrid") and not registered_answer:
            mode = "ai"
            reason = "登録回答なし（AI生成にフォールバック）"
    else:
        mode = auto_mode

    # 同一エピソードの使い回し対策: このカテゴリを面接内で既に使っていたら注意書きを追加
    reuse_note = ""
    if category and used_categories and category in used_categories:
        reuse_note = (
            f"\n\n【注意】このセッション内で「{category}」のエピソードは既に別の質問で使用済みです。"
            "同じ話をそのまま繰り返すと面接官に「同じ話ばかり」という印象を与えるため、"
            "今回は与えられた情報の中から強調する部分（結論・数字・学びのどれを前面に出すか）だけを変えるか、"
            "「先ほどお話しした〇〇の経験にも関連しますが」と自然に一言添えてください。"
            "**新しい登場人物・対立・出来事など、与えられていない事実を新しく付け加えて話を変えることは禁止**です。"
            "使える事実の範囲内で伝え方だけを変えてください。"
        )

    # METAヘッダーを先頭に送信（フロントが解析してバッジ表示に使う）
    yield f"##META:{mode}|{category}|{reason}##\n"

    if mode == "registered":
        prompt = f"""面接種別: {context}{personalize_section}{bg_section}{reuse_note}

【面接官の質問（音声認識）】
「{question}」

【{category}として事前登録された回答】
{registered_answer}

あなたの役割: 登録回答をベースに、今回の質問にそのまま自然につながる形へ最小限だけ調整する（生成モードではない）。

厳守事項:
- 登録回答にあるエピソード・数字・固有名詞は変えない。新しいエピソードや数字を付け足さない
- 変えてよいのは語尾・接続詞・言い回しなど、質問に自然に接続するための表現レベルのみ
- 登録回答の内容が今回の質問とずれている場合でも、内容を作り替えて無理に合わせない

出力ルール（厳守）:
- 1行目: 「▶ 推測: 〇〇〇」（質問を30字以内で）
- 2行目以降: 登録回答を今回の質問に合わせて最小限調整した回答（120〜150字、30秒で話せる長さ。**150字を超えたら文を削って必ず収める**）。結論から入る
- 空行を1行入れてから「##FOLLOWUP##」と書き、その後に深掘り想定質問を2点（「・」で始める。登録回答の内容と矛盾しない範囲で）
- マークダウン記法は使わない
- 前置き・説明は不要。「【面接回答】」のような見出し・ラベルも付けず、回答本文だけを書く"""

    elif mode == "hybrid":
        prompt = f"""面接種別: {context}{personalize_section}{bg_section}{reuse_note}

【面接官の質問（音声認識）】
「{question}」

【参考: {category}として事前登録された回答】
{registered_answer}

あなたの役割: 登録回答の核（エピソード・強み・結論）は活かしつつ、今回の質問の焦点に合わせて内容を調整する。生成モードのように新しいエピソードを作ってはいけない。登録回答にある事実の中から今回の質問に最も関係する部分を選んで前面に出す。

厳守事項:
- 登録回答にない新しい経験・数字は追加しない
- 登録回答の結論・エピソードの根幹は変えない（表現・切り口の調整に留める）

出力ルール（厳守）:
- 1行目: 「▶ 推測: 〇〇〇」（質問を30字以内で）
- 2行目以降: 登録回答の内容を活かしつつ今回の質問に最適化した回答（120〜150字、30秒で話せる長さ。**150字を超えたら文を削って必ず収める**）。結論から入る
- 空行を1行入れてから「##FOLLOWUP##」と書き、その後に深掘り想定質問を2点（「・」で始める）
- マークダウン記法は使わない
- 前置き・説明は不要。「【面接回答】」のような見出し・ラベルも付けず、回答本文だけを書く"""

    else:
        prompt = f"""面接種別: {context}{personalize_section}{bg_section}{reuse_note}

【音声認識テキスト（Whisper自動文字起こし・誤認識あり）】
「{question}」

音が似た言葉への誤変換例: 長所→聴者、短所→単純、強み→攻め、弱み→悪み 等

【よくある面接質問（推測候補）】
- 自己紹介をしてください
- 強み・長所を教えてください
- 弱み・短所を教えてください
- 学生時代に力を入れたこと（ガクチカ）を教えてください
- 自己PRをしてください
- なぜ弊社を志望しましたか
- 5年後・10年後のビジョンを教えてください
- 困難・失敗を乗り越えた経験を教えてください
- 仕事をする上で大切にしていることは何ですか

あなたの役割: 応募者情報の範囲内で、今回の質問に対する新しい回答を組み立てる（登録回答はない）。

厳守事項:
- 応募者情報にない具体的なエピソード・数字・資格を作り出さない
- 応募者情報が不足していて具体的に答えられない場合は、一般的な回答の骨子（①→②→③の流れ）を示すに留め、実体験として断定しない
- 企業情報は与えられた範囲でのみ使い、不明な事業内容を事実のように書かない

出力ルール（厳守）:
- 音が似た誤変換を積極的に補正して質問を推測する
- 推測できた場合: 1行目に「▶ 推測: 〇〇〇」（質問を30字以内で）と書き、改行して回答本文を書く
- 推測できない場合: 「聞き取れませんでした」の1行だけ出力して終了
- 回答本文: 応募者情報を活かした自然な話し言葉の敬語、結論から入り120〜150字程度（30秒で話せる長さ。**150字を超えたら文を削って必ず収める**）
- 空行を1行入れてから「##FOLLOWUP##」と書き、深掘り想定質問を2点（「・」で始める）
- マークダウン記法は使わない
- 前置き・説明・構成解説は不要。「【面接回答】」のような見出し・ラベルも付けず、回答本文だけを書く"""

    async with client.messages.stream(
        model=MODEL_FAST,
        max_tokens=600,
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
