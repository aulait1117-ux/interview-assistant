import asyncio
import io
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from fastapi import APIRouter, Body
import soundfile as sf

router = APIRouter(prefix="/api/audio", tags=["audio"])

_whisper_model = None
_model_lock = threading.Lock()

def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        with _model_lock:
            if _whisper_model is None:
                from faster_whisper import WhisperModel
                print("[audio_capture] Whisperモデルをロード中...")
                _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
                print("[audio_capture] Whisperモデルロード完了")
    return _whisper_model

_recording = False
_record_thread: threading.Thread | None = None
_stop_event = threading.Event()
_start_lock = threading.Lock()           # 二重起動防止
_transcript_queue: asyncio.Queue | None = None
_loop: asyncio.AbstractEventLoop | None = None
_whisper_executor = ThreadPoolExecutor(max_workers=1)

_last_rms: float = 0.0
_chunks_processed: int = 0
_last_chunk_time: float = 0.0           # watchdog 用: 最後にchunkを処理した時刻
_start_time: float = 0.0                # watchdog 用: 最後に_do_startを呼んだ時刻
_whisper_calls: int = 0
_whisper_busy: bool = False
_user_background: str = ""
_job_title: str = ""
_interview_type_pref: str = ""


def _extract_question_only(text: str) -> str:
    """転写テキストから最初の質問文だけを取り出す（質問＋回答を丸ごと取った場合の対策）"""
    import re
    sentences = re.split(r'(?<=[。！？?!\n])\s*', text.strip())
    # 質問らしい語尾を持つ短い文を優先
    q_end = re.compile(r'(てください|ますか|でしょうか|ありますか|何ですか|いただけますか|ください)$')
    for s in sentences:
        s = s.strip()
        if s and q_end.search(s) and len(s) <= 45:
            return s
    # 質問パターンが見つからなければ最初の短い文（40字以内）
    for s in sentences:
        s = s.strip()
        if 4 <= len(s) <= 45:
            return s
    return text[:45] if len(text) > 45 else text


def _transcribe_sync(audio_data: np.ndarray, samplerate: int) -> str:
    global _whisper_calls
    _whisper_calls += 1
    print(f"[audio_capture] Whisper呼び出し #{_whisper_calls}")
    try:
        model = _get_whisper_model()
        peak = np.max(np.abs(audio_data))
        if peak > 0:
            audio_data = audio_data / peak * 0.9
        buf = io.BytesIO()
        sf.write(buf, audio_data, samplerate, format='WAV', subtype='PCM_16')
        buf.seek(0)
        segments, _ = model.transcribe(
            buf, language="ja", beam_size=1,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
        )
        parts = [seg.text.strip() for seg in segments if seg.no_speech_prob < 0.6]
        text = " ".join(parts).strip()
        if not text:
            return ""
        # 質問文だけを抽出（動画等で質問＋回答が一緒に流れた場合の対策）
        question = _extract_question_only(text)
        print(f"[audio_capture] 文字起こし(生): {text[:60]}")
        if question != text:
            print(f"[audio_capture] 質問抽出: {question}")
        return question
    except Exception as e:
        print(f"[audio_capture] Whisperエラー: {e}")
        return ""


def _record_worker():
    """録音とWhisper処理を並列実行。recorder.record()のフリーズを自己検出して再起動する"""
    global _last_rms, _chunks_processed, _last_chunk_time
    import queue as q_mod
    import soundcard as sc

    SAMPLERATE = 16000
    CHUNK_FRAMES = int(SAMPLERATE * 0.1)   # 100ms単位
    RECORD_TIMEOUT = 1.5                   # これ以上 record() が帰らなければフリーズとみなす
    SPEECH_THRESHOLD = 0.001
    SILENCE_CHUNKS = 4
    MAX_SPEECH_CHUNKS = 20
    consecutive_timeouts = 0

    def submit_transcription(audio: np.ndarray):
        global _whisper_busy
        if _whisper_busy:
            print("[audio_capture] Whisperビジー: スキップ")
            return
        def run():
            global _whisper_busy
            _whisper_busy = True
            try:
                text = _transcribe_sync(audio, SAMPLERATE)
                if text and len(text) > 1 and not _stop_event.is_set() and _loop and _transcript_queue is not None:
                    asyncio.run_coroutine_threadsafe(_transcript_queue.put(text), _loop)
            finally:
                _whisper_busy = False
        _whisper_executor.submit(run)

    while not _stop_event.is_set():
        try:
            default_speaker = sc.default_speaker()
            mic = sc.get_microphone(id=str(default_speaker.id), include_loopback=True)
            print(f"[audio_capture] ループバック録音デバイス: {default_speaker.name}")
        except Exception as e:
            print(f"[audio_capture] ループバック取得失敗: {e}")
            time.sleep(2)
            continue

        speech_buffer: list[np.ndarray] = []
        silence_count = 0
        is_speaking = False

        try:
            with mic.recorder(samplerate=SAMPLERATE, channels=1) as recorder:
                while not _stop_event.is_set():
                    # recorder.record() が WASAPIフリーズで永久ブロックするのを防ぐため
                    # 別スレッドで呼び出してタイムアウト付きで待つ
                    result_q: q_mod.Queue = q_mod.Queue()

                    def _do_record():
                        try:
                            result_q.put(('ok', recorder.record(numframes=CHUNK_FRAMES)))
                        except Exception as exc:
                            result_q.put(('err', exc))

                    t = threading.Thread(target=_do_record, daemon=True)
                    t.start()
                    try:
                        tag, val = result_q.get(timeout=RECORD_TIMEOUT)
                        consecutive_timeouts = 0
                    except q_mod.Empty:
                        consecutive_timeouts += 1
                        wait = min(consecutive_timeouts * 1.0, 5.0)
                        print(f"[audio_capture] recorder.record() タイムアウト #{consecutive_timeouts} → {wait}秒待って再作成")
                        time.sleep(wait)  # ゾンビスレッドがデバイスを解放するまで待つ
                        break  # with ブロックを抜けて外側ループで recorder を再生成

                    if tag == 'err':
                        print(f"[audio_capture] recorder.record() エラー: {val}")
                        break

                    if _stop_event.is_set():
                        break

                    chunk: np.ndarray = val
                    rms = float(np.sqrt(np.mean(chunk ** 2)))
                    _last_rms = rms
                    _chunks_processed += 1
                    _last_chunk_time = time.time()

                    if rms >= SPEECH_THRESHOLD:
                        speech_buffer.append(chunk)
                        silence_count = 0
                        is_speaking = True
                        if len(speech_buffer) >= MAX_SPEECH_CHUNKS:
                            submit_transcription(np.concatenate(speech_buffer))
                            speech_buffer = []
                            is_speaking = False
                    else:
                        if is_speaking:
                            speech_buffer.append(chunk)
                            silence_count += 1
                            if silence_count >= SILENCE_CHUNKS:
                                submit_transcription(np.concatenate(speech_buffer))
                                speech_buffer = []
                                silence_count = 0
                                is_speaking = False

        except Exception as e:
            print(f"[audio_capture] recorder 例外: {e}")

        if not _stop_event.is_set():
            print("[audio_capture] recorder を再作成します...")
            time.sleep(1)

    print("[audio_capture] 録音スレッド終了")


def _do_start(loop: asyncio.AbstractEventLoop):
    """録音スレッドを安全に起動する（同期関数・_start_lock保持下で呼ぶ）"""
    global _recording, _record_thread, _transcript_queue, _loop, _last_chunk_time, _start_time
    _stop_event.set()
    if _record_thread is not None and _record_thread.is_alive():
        _record_thread.join(timeout=3.0)
    _loop = loop
    _transcript_queue = asyncio.Queue()
    _last_chunk_time = 0.0      # 実チャンクが届くまでは0のまま（watchdog の誤検知防止）
    _start_time = time.time()   # 起動時刻を記録（初回フリーズ検出用）
    _stop_event.clear()
    _recording = True
    _record_thread = threading.Thread(target=_record_worker, daemon=True)
    _record_thread.start()
    print("[audio_capture] 録音スレッド起動")


def _start_watchdog():
    """録音スレッドが凍結したら自動再起動する watchdog（バックグラウンド常駐）"""
    FREEZE_TIMEOUT = 12.0    # この秒数 chunk が来なければ凍結とみなす
    INITIAL_GRACE = 15.0     # 起動直後はこの秒数まで待つ（Whisperモデルロード時間を考慮）
    while True:
        time.sleep(5)
        if not _recording or _loop is None:
            continue
        now = time.time()
        if _last_chunk_time == 0.0:
            # まだ1チャンクも届いていない → 起動からGRACE秒を超えたら異常とみなす
            if _start_time > 0 and (now - _start_time) > INITIAL_GRACE:
                print(f"[watchdog] 起動から{INITIAL_GRACE}秒 初回チャンクなし → 強制再起動")
                with _start_lock:
                    _do_start(_loop)
            continue
        elapsed = now - _last_chunk_time
        if elapsed > FREEZE_TIMEOUT:
            print(f"[watchdog] 録音スレッドが {elapsed:.0f}秒 凍結 → 強制再起動")
            with _start_lock:
                _do_start(_loop)

_watchdog_started = False

@router.post("/start")
async def start_capture():
    global _watchdog_started
    loop = asyncio.get_event_loop()

    # 既に正常録音中なら何もしない（_last_chunk_timeが0=起動直後の場合はGRACE内のみスキップ）
    if _recording and _record_thread is not None and _record_thread.is_alive():
        if _last_chunk_time > 0 and time.time() - _last_chunk_time < 12:
            return {"ok": True, "status": "already_recording"}
        if _last_chunk_time == 0.0 and _start_time > 0 and time.time() - _start_time < 15:
            return {"ok": True, "status": "already_recording"}

    acquired = _start_lock.acquire(blocking=False)
    if not acquired:
        return {"ok": True, "status": "start_in_progress"}

    try:
        await loop.run_in_executor(None, lambda: _do_start(loop))
    finally:
        _start_lock.release()

    # watchdog を一度だけ起動
    if not _watchdog_started:
        _watchdog_started = True
        threading.Thread(target=_start_watchdog, daemon=True).start()
        print("[audio_capture] watchdog 起動")

    return {"ok": True, "status": "started"}


@router.post("/inject")
async def inject_transcript(payload: dict = Body(...)):
    """テスト用: 文字起こし結果を直接キューへ注入"""
    text = payload.get("text", "テスト文字起こし")
    if _transcript_queue is None:
        return {"ok": False, "reason": "queue not initialized (call /start first)"}
    await _transcript_queue.put(text)
    return {"ok": True, "text": text}


@router.post("/stop")
async def stop_capture():
    global _recording
    _recording = False
    _stop_event.set()
    # _record_thread は None にしない → /start でjoinできるよう参照を保持
    return {"ok": True, "status": "stopped"}


@router.get("/latest")
async def get_latest():
    if _transcript_queue and not _transcript_queue.empty():
        texts = []
        while not _transcript_queue.empty():
            try:
                texts.append(_transcript_queue.get_nowait())
            except Exception:
                break
        return {"ok": True, "text": " ".join(texts), "recording": _recording}
    return {"ok": True, "text": None, "recording": _recording}


@router.post("/set-profile")
async def set_profile(payload: dict = Body(...)):
    global _user_background, _job_title, _interview_type_pref
    _user_background = payload.get("user_background", "")
    _job_title = payload.get("job_title", "")
    _interview_type_pref = payload.get("interview_type_pref", "")
    return {"ok": True}


@router.get("/get-profile")
async def get_profile():
    return {
        "user_background": _user_background,
        "job_title": _job_title,
        "interview_type_pref": _interview_type_pref,
    }


@router.get("/status")
async def get_status():
    queue_size = _transcript_queue.qsize() if _transcript_queue else 0
    chunk_age = round(time.time() - _last_chunk_time, 1) if _last_chunk_time > 0 else None
    return {
        "recording": _recording,
        "queue_size": queue_size,
        "last_rms": _last_rms,
        "chunks_processed": _chunks_processed,
        "whisper_calls": _whisper_calls,
        "last_chunk_age_sec": chunk_age,  # watchdog確認用: 最後のchunkから何秒経ったか
    }
