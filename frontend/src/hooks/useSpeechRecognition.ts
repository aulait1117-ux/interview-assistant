import { useState, useRef, useCallback } from 'react'
import { InterviewType } from '../types'

interface SpeechRecognitionHook {
  isListening: boolean
  transcript: string
  detectedQuestion: string
  startListening: () => void
  stopListening: () => void
  resetTranscript: () => void
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: ISpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

interface ISpeechRecognitionEvent {
  resultIndex: number
  results: { isFinal: boolean; [0]: { transcript: string } }[]
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition
    webkitSpeechRecognition: new () => ISpeechRecognition
  }
}

export function useSpeechRecognition(
  interviewType: InterviewType,
  onQuestionDetected: (question: string) => void
): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [detectedQuestion, setDetectedQuestion] = useState('')
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const accumulatedRef = useRef('')

  const handleResult = useCallback((event: ISpeechRecognitionEvent) => {
    let interim = ''
    let final = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        final += t
      } else {
        interim += t
      }
    }

    if (final) {
      accumulatedRef.current += final + ' '
      setTranscript(accumulatedRef.current)

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        const q = accumulatedRef.current.trim()
        if (q.length > 5) {
          setDetectedQuestion(q)
          onQuestionDetected(q)
          accumulatedRef.current = ''
          setTranscript('')
        }
      }, 1800)
    } else {
      setTranscript(accumulatedRef.current + interim)
    }
  }, [onQuestionDetected])

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      alert('このブラウザは音声認識に対応していません。Chrome を使用してください。')
      return
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'ja-JP'

    recognition.onresult = handleResult
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognition.start()
      }
    }
    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.error('Speech error:', e.error)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [handleResult])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
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
