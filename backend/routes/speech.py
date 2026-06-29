import os
import tempfile
from fastapi import APIRouter, UploadFile, File
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api/speech", tags=["speech"])

_client: AsyncOpenAI | None = None

def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if len(audio_bytes) < 500:
        return {"text": ""}

    suffix = ".webm"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext:
            suffix = ext

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        client = _get_client()
        with open(tmp_path, "rb") as f:
            result = await client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="ja",
            )
        return {"text": result.text.strip()}
    except Exception as e:
        print(f"Whisper API error: {e}")
        return {"text": "", "error": str(e)}
    finally:
        os.unlink(tmp_path)
