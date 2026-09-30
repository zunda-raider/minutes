'use client';

import { useRef, useState } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setError('');
    setTranscript('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error('マイク許可エラー:', e);
      setError(
        'マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。'
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      stopTracks();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      if (blob.size === 0) {
        setError('録音データが空でした。もう一度試してください。');
        setIsTranscribing(false);
        return;
      }

      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append('file', new File([blob], 'audio.webm', { type: mimeType }));

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        let data: { text?: string; error?: string };
        try {
          data = await res.json();
        } catch (parseErr) {
          console.error('レスポンスエラー:', parseErr);
          setError('サーバー応答を読めませんでした。');
          return;
        }

        if (!res.ok) {
          setError(data.error || `文字起こしに失敗しました (${res.status})`);
          return;
        }

        if (data.text && data.text.trim().length > 0) {
          setTranscript(data.text);
        } else {
          setError('変換はできたけど、内容が空でした。');
        }
      } catch (fetchErr) {
        console.error('送信エラー:', fetchErr);
        setError('文字起こしリクエストに失敗しました。');
      } finally {
        setIsTranscribing(false);
      }
    };

    recorder.onerror = () => {
      setError('録音中にエラーが発生しました。');
      stopTracks();
      setIsRecording(false);
    };

    // timeslice: emit chunks every 1s so data is not lost if stop is abrupt
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stopTracks();
      setIsRecording(false);
      return;
    }
    recorder.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>🎤 議事録アプリ</h1>
      <p className={styles.hint}>
        マイクで録音し、停止後に Whisper で文字起こしします。
      </p>

      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isTranscribing}
        className={isRecording ? styles.stopButton : styles.startButton}
      >
        {isRecording ? '🛑 停止' : isTranscribing ? '⏳ 文字起こし中…' : '▶️ 録音開始'}
      </button>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.result}>
        <h2 className={styles.resultTitle}>📝 結果</h2>
        <pre className={styles.transcript}>
          {transcript || (isTranscribing ? '処理中…' : 'まだ結果はないよ〜')}
        </pre>
      </section>
    </main>
  );
}
