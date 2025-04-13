'use client';

import { useState } from 'react';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    setChunks([]);
    recorder.ondataavailable = (e) => setChunks((prev) => [...prev, e.data]);

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const formData = new FormData();
      formData.append('file', new File([arrayBuffer], 'audio.webm', { type: 'audio/webm' }));

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        console.error('レスポンスエラー:', e);
        setTranscript('レスポンスが読めなかったよ…💦');
        return;
      }

      if (data && typeof data.text === 'string' && data.text.trim().length > 0) {
        setTranscript(data.text);
      } else {
        setTranscript('変換されたけど、内容が空だったよ〜💦');
      }
    };

    recorder.start();
    setMediaRecorder(recorder);
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setIsRecording(false);
  };

  return (
    <div className="p-10 text-center">
      <h1 className="text-2xl font-bold mb-4">🎤 議事録アプリ</h1>
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        {isRecording ? '🛑 停止' : '▶️ 録音開始'}
      </button>
      <div className="mt-6">
        <h2 className="text-lg font-semibold">📝 結果:</h2>
        <p>{transcript || 'まだ結果はないよ〜'}</p>
      </div>
    </div>
  );
}
