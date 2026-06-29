import { useState, useRef, useCallback } from 'react'
import { InterviewType } from '../types'

interface SystemAudioRecognitionHook {
  isListening: boolean
  transcript: string
  detectedQuestion: string
  startListening: () => void
  stopListening: () => void
  resetTranscript: () => void
}

async function getSystemAudioStream(): Promise<MediaStream | null> {
  const api = window.electronAPI as any

  // Electron環境: desktopCapturer でシステム音声をダイアログなしにキャプチャ
  if (api?.getDesktopSources) {
    const sources: { id: string; name: string }[] = await api.getDesktopSources()
    if (!sources || sources.length === 0) return null

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error Electron独自の制約
        mandatory: { chromeMediaSource: 'desktop' },
      },
      video: {
        // @ts-expect-error Electron独自の制約
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      },
    })
    stream.getVideoTracks().forEach(t => t.stop())
    return stream
  }

  // ブラウザ環境: getDisplayMedia（タブ共有 + 「音声を共有」チェックが必要）
  const raw = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  raw.getVideoTracks().forEach(t => t.stop())

  const audioTracks = raw.getAudioTracks()
  if (audioTracks.length === 0) {
    alert('システム音声を取得できませんでした。\n画面共有ダイアログで「システム音声を共有する」にチェックを入れてください。')
    raw.getTracks().forEach(t => t.stop())
    return null
  }
  return new MediaStream(audioTracks)
}

export function useSystemAudioRecognition(
  _interviewType: InterviewType,
  onQuestionDetected: (question: string) => void
): SystemAudioRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [detectedQuestion, setDetectedQuestion] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const accumulatedRef = useRef('')
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleQuestionDetection = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      const q = accumulatedRef.current.trim()
      if (q.length > 5) {
        setDetectedQuestion(q)
        onQuestionDetected(q)
        accumulatedRef.current = ''
        setTranscript('')
      }
    }, 3000)
  }, [onQuestionDetected])

  const startListening = useCallback(async () => {
    try {
      const stream = await getSystemAudioStream()
      if (!stream) return

      streamRef.current = stream

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(
        m => MediaRecorder.isTypeSupported(m)
      ) ?? ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      recorder.ondataavailable = async (e) => {
        if (e.data.size < 500) return

        const formData = new FormData()
        formData.append('audio', e.data, 'chunk.webm')

        try {
          const res = await fetch('/api/speech/transcribe', {
            method: 'POST',
            body: formData,
          })
          if (!res.ok) return
          const { text } = await res.json() as { text: string }
          if (!text || text.trim().length < 2) return

          accumulatedRef.current += text + ' '
          setTranscript(accumulatedRef.current)
          scheduleQuestionDetection()
        } catch {
          // ignore transient network errors
        }
      }

      stream.getAudioTracks()[0].onended = () => stopListening()

      mediaRecorderRef.current = recorder
      recorder.start(5000)
      setIsListening(true)
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') {
        console.error('System audio capture error:', err)
      }
    }
  }, [scheduleQuestionDetection])

  const stopListening = useCallback(() => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setIsListening(false)
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
  }, [])

  const resetTranscript = useCallback(() => {
    accumulatedRef.current = ''
    setTranscript('')
    setDetectedQuestion('')
  }, [])

  return { isListening, transcript, detectedQuestion, startListening, stopListening, resetTranscript }
}
