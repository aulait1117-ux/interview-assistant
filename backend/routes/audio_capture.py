import asyncio
import io
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
_transcript_queue: asyncio.Queue | None = None
_loop: asyncio.AbstractEventLoop | None = None
_whisper_executor = ThreadPoolExecutor(max_workers=1)

_last_rms: float = 0.0
_chunks_processed: int = 0
_whisper_calls: int = 0


def _transcribe_sync(audio_data: np.ndarray, samplerate: int) -> str:
    global _whisper_calls
    _whisper_calls += 1
    print(f"[audio_capture] Whisper呼び出し #{_whisper_calls}")
    try:
        model = _get_whisper_model()
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
        if text:
            print(f"[audio_capture] 文字起こし: {text[:60]}")
        return text
    except Exception as e:
        print(f"[audio_capture] Whisperエラー: {e}")
        return ""


def _record_worker():
    """録音とWhisper処理を並列実行（録音を止めずに文字起こし）"""
    import soundcard as sc

    SAMPLERATE = 16000
    CHUNK_FRAMES = int(SAMPLERATE * 0.5)   # 500ms単位で録音
    SPEECH_THRESHOLD = 0.001
    SILENCE_CHUNKS = 4                      # 2秒間無音でWhisper実行
    MAX_SPEECH_CHUNKS = 20                  # 最大10秒でWhisper実行

    mic = None
    for attempt in range(3):
        try:
            default_speaker = sc.default_speaker()
            mic = sc.get_microphone(id=str(default_speaker.id), include_loopback=True)
            print(f"[audio_capture] 録音デバイス: {default_speaker.name}")
            break
        except Exception as e:
            print(f"[audio_capture] デバイス取得失敗 (試行{attempt+1}/3): {e}")
            import time; time.sleep(1)
    if mic is None:
        print("[audio_capture] デバイス取得を3回失敗、録音を中止します")
        return

    speech_buffer: list[np.ndarray] = []
    silence_count = 0
    is_speaking = False

    def submit_transcription(audio: np.ndarray):
        """Whisperを別スレッドで実行してキューに積む"""
        def run():
            text = _transcribe_sync(audio, SAMPLERATE)
            if text and len(text) > 1 and _recording and _loop and _transcript_queue is not None:
                asyncio.run_coroutine_threadsafe(_transcript_queue.put(text), _loop)
        _whisper_executor.submit(run)

    global _last_rms, _chunks_processed

    with mic.recorder(samplerate=SAMPLERATE, channels=1) as recorder:
        while _recording:
            chunk = recorder.record(numframes=CHUNK_FRAMES)
            if not _recording:
                break

            rms = float(np.sqrt(np.mean(chunk ** 2)))
            _last_rms = rms
            _chunks_processed += 1

            if rms >= SPEECH_THRESHOLD:
                speech_buffer.append(chunk)
                silence_count = 0
                is_speaking = True

                # 最大長に達したら強制的に文字起こし
                if len(speech_buffer) >= MAX_SPEECH_CHUNKS:
                    audio = np.concatenate(speech_buffer)
                    submit_transcription(audio)
                    speech_buffer = []
                    is_speaking = False
            else:
                if is_speaking:
                    speech_buffer.append(chunk)
                    silence_count += 1
                    if silence_count >= SILENCE_CHUNKS:
                        # 無音が続いたら文字起こし
                        audio = np.concatenate(speech_buffer)
                        submit_transcription(audio)
                        speech_buffer = []
                        silence_count = 0
                        is_speaking = False


@router.post("/start")
async def start_capture():
    global _recording, _record_thread, _transcript_queue, _loop

    if _recording:
        return {"ok": True, "status": "already_recording"}

    _loop = asyncio.get_event_loop()
    _transcript_queue = asyncio.Queue()
    _recording = True
    _record_thread = threading.Thread(target=_record_worker, daemon=True)
    _record_thread.start()
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
    global _recording, _record_thread
    _recording = False
    _record_thread = None
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


@router.get("/status")
async def get_status():
    queue_size = _transcript_queue.qsize() if _transcript_queue else 0
    return {
        "recording": _recording,
        "queue_size": queue_size,
        "last_rms": _last_rms,
        "chunks_processed": _chunks_processed,
        "whisper_calls": _whisper_calls,
    }
