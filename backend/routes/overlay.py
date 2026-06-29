import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/overlay", tags=["overlay"])

# オーバーレイ（Electron）へのキュー
_queues: list[asyncio.Queue] = []
# 本体アプリ（Chrome）へのキュー
_main_queues: list[asyncio.Queue] = []


class HintPayload(BaseModel):
    question: str = ""
    answer: str = ""
    isStreaming: bool = False
    streamingText: str = ""
    isRecording: bool = False
    _control: str = ""  # "show" | "hide" | ""


class ControlPayload(BaseModel):
    command: str  # "record-toggle"


@router.post("/show")
async def show_overlay():
    """Electronオーバーレイを前面に表示させる"""
    data = json.dumps({"_control": "show"})
    for q in _queues:
        await q.put(data)
    return {"ok": True}


@router.post("/hint")
async def push_hint(payload: HintPayload):
    """Webアプリからヒントを受け取り、SSE接続中のオーバーレイへ配信する"""
    data = json.dumps(payload.model_dump(), ensure_ascii=False)
    for q in _queues:
        await q.put(data)
    return {"ok": True, "clients": len(_queues)}


@router.post("/control")
async def overlay_control(payload: ControlPayload):
    """Electronオーバーレイからのコマンドを本体アプリ（Chrome）へ中継する"""
    data = json.dumps({"command": payload.command})
    for q in _main_queues:
        await q.put(data)
    return {"ok": True, "clients": len(_main_queues)}


@router.get("/main-stream")
async def main_stream():
    """本体アプリ（Chrome）が接続するSSEエンドポイント（オーバーレイからのコマンド受信用）"""
    q: asyncio.Queue = asyncio.Queue()
    _main_queues.append(q)

    async def event_generator():
        try:
            yield "data: {\"connected\": true}\n\n"
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"ping\": true}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if q in _main_queues:
                _main_queues.remove(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/stream")
async def overlay_stream():
    """Electronオーバーレイが接続するSSEエンドポイント"""
    q: asyncio.Queue = asyncio.Queue()
    _queues.append(q)

    async def event_generator():
        try:
            yield "data: {\"connected\": true}\n\n"
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"ping\": true}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if q in _queues:
                _queues.remove(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
