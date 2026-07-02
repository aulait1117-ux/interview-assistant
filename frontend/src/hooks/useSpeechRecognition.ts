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
  const chunksRef = useRef<Blob[]>([])
  const onQuestionDetectedRef = useRef(onQuestionDetected)
  onQuestionDetectedRef.current = onQuestionDetected

  const clearPermissionError = useCallback(() => setPermissionError(null), [])

  const startListening = useCallback(async () => {
    if (mediaRecorderRef.current) return

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

    chunksRef.current = []
    const recorder = new MediaRecorder(stream)

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const mimeType = recorder.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []

      setTranscript(`音声取得: ${blob.size}バイト`)
      if (blob.size < 100) {
        setTranscript(`音声が短すぎます (${blob.size}バイト)。マイクがミュートになっていないか確認してください。`)
        return
      }

      setTranscript('文字起こし中...')
      try {
        const formData = new FormData()
        formData.append('audio', blob, 'recording.webm')
        const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        const text: string = data.text ?? ''
        setTranscript(text)
        if (text.length > 0) {
          setDetectedQuestion(text)
          onQuestionDetectedRef.current(text)
        }
      } catch (e) {
        console.error('Transcription error:', e)
        setTranscript('文字起こしに失敗しました')
      }
    }

    recorder.onerror = (e) => {
      setTranscript('録音エラー: ' + String(e))
    }

    mediaRecorderRef.current = recorder
    try {
      recorder.start(250)
    } catch (e) {
      setTranscript('録音開始エラー: ' + String(e))
      mediaRecorderRef.current = null
      return
    }
    setIsListening(true)
    setTranscript('録音中...')
  }, [])

  const stopListening = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    mediaRecorderRef.current = null
    setIsListening(false)
    setTranscript('処理中...')
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        setTranscript(`録音状態エラー: ${recorder.state}`)
      }
    } catch (e) {
      setTranscript('停止エラー: ' + String(e))
    }
  }, [])

  const resetTranscript = useCallback(() => {
    setTranscript('')
    setDetectedQuestion('')
    chunksRef.current = []
  }, [])

  return {
    isListening, transcript, detectedQuestion, micSupported, permissionError,
    startListening, stopListening, resetTranscript, clearPermissionError,
  }
}
