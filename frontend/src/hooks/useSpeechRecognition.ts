import { useState, useRef, useCallback } from 'react'
import { InterviewType } from '../types'

export type MicPermissionError = 'denied' | 'not-found' | 'unsupported' | 'unknown'

interface SpeechRecognitionHook {
  isListening: boolean
  transcript: string
  detectedQuestion: string
  micSupported: boolean
  permissionError: MicPermissionError | null
  startListening: () => void
  stopListening: () => void
  resetTranscript: () => void
  clearPermissionError: () => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// 何秒ごとに録音を区切ってWhisperへ送るか（区切らないとstopを押すまで一切文字起こしされず
// 「音声を拾わない」ように見えるため、デスクトップ版のポーリング方式に合わせて区切る）
const SEGMENT_MS = 4000
// 区切った文章がこの間隔だけ途切れたら「ひと区切りの質問」とみなして確定する
const SILENCE_MS = 3000

// ブラウザがマイク録音に対応しているか（getUserMedia + MediaRecorder）
function checkMicSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false
  if (typeof window === 'undefined' || typeof (window as any).MediaRecorder === 'undefined') return false
  return true
}

export function useSpeechRecognition(
  _interviewType: InterviewType,
  onQuestionDetected: (question: string) => void
): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [detectedQuestion, setDetectedQuestion] = useState('')
  const [permissionError, setPermissionError] = useState<MicPermissionError | null>(null)
  const micSupported = checkMicSupported()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const shouldContinueRef = useRef(false)
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const accumulatedRef = useRef('')
  const onQuestionDetectedRef = useRef(onQuestionDetected)
  onQuestionDetectedRef.current = onQuestionDetected

  const clearPermissionError = useCallback(() => setPermissionError(null), [])

  const transcribeBlob = useCallback(async (blob: Blob): Promise<string> => {
    if (blob.size < 100) return ''
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')
      const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      return (data.text ?? '').trim()
    } catch (e) {
      console.error('Transcription error:', e)
      return ''
    }
  }, [])

  const flushAccumulated = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    const q = accumulatedRef.current.trim()
    accumulatedRef.current = ''
    setTranscript('')
    if (q.length >= 5) {
      setDetectedQuestion(q)
      onQuestionDetectedRef.current(q)
    }
  }, [])

  // 1区切り分（SEGMENT_MS）だけ録音し、文字起こし結果を蓄積しながら次の区切りへ続ける。
  // 「stopを押すまで何も起きない」単発録音ではなく、話している間は自動でヒント検出が走るようにする
  const startSegment = useCallback(() => {
    const stream = streamRef.current
    if (!stream || !shouldContinueRef.current) return

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onerror = (e) => {
      setTranscript('録音エラー: ' + String(e))
    }
    recorder.onstop = async () => {
      const isFinal = !shouldContinueRef.current
      const mimeType = recorder.mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type: mimeType })
      const text = await transcribeBlob(blob)
      if (text) {
        accumulatedRef.current = (accumulatedRef.current + ' ' + text).trim()
        setTranscript(accumulatedRef.current)
      }

      if (isFinal) {
        flushAccumulated()
        return
      }

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(flushAccumulated, SILENCE_MS)

      startSegment()
    }

    mediaRecorderRef.current = recorder
    try {
      recorder.start()
    } catch (e) {
      setTranscript('録音開始エラー: ' + String(e))
      return
    }
    segmentTimerRef.current = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, SEGMENT_MS)
  }, [transcribeBlob, flushAccumulated])

  const startListening = useCallback(async () => {
    if (shouldContinueRef.current) return

    if (!checkMicSupported()) {
      setPermissionError('unsupported')
      return
    }

    setPermissionError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setPermissionError('denied')
      } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
        setPermissionError('not-found')
      } else {
        setPermissionError('unknown')
      }
      return
    }

    streamRef.current = stream
    shouldContinueRef.current = true
    accumulatedRef.current = ''
    setIsListening(true)
    setTranscript('録音中...')
    startSegment()
  }, [startSegment])

  const stopListening = useCallback(() => {
    if (!shouldContinueRef.current) return
    shouldContinueRef.current = false
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current)
      segmentTimerRef.current = null
    }
    setIsListening(false)
    setTranscript('処理中...')

    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    mediaRecorderRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const resetTranscript = useCallback(() => {
    setTranscript('')
    setDetectedQuestion('')
    accumulatedRef.current = ''
  }, [])

  return {
    isListening, transcript, detectedQuestion, micSupported, permissionError,
    startListening, stopListening, resetTranscript, clearPermissionError,
  }
}
