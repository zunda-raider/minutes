import { NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: '音声が見つからないよ〜💦' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filename = `audio-${Date.now()}.webm`;
  const webmPath = path.join('C:/Users/marac/nminutes/temp', filename);
  const wavPath = webmPath.replace('.webm', '.wav');

  const modelPath = 'C:/Users/marac/nminutes/whisper.cpp/models/ggml-base.bin';
  const execPath = 'C:/Users/marac/nminutes/whisper.cpp/build/bin/Release/whisper-cli.exe';

  await writeFile(webmPath, buffer);

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('D:/contempo/ffmpeg-7.1.1-essentials_build/ffmpeg-7.1.1-essentials_build/bin/ffmpeg.exe', [
      '-i', webmPath, wavPath
    ]);
    ffmpeg.on('close', (code) => {
      code === 0 ? resolve(null) : reject(new Error('ffmpeg failed'));
    });
  });

  const result = await new Promise<string>((resolve, reject) => {
    const proc = spawn(execPath, [
      '-m', modelPath,
      '-f', wavPath,
      '-l', 'ja' // ← ここ追加だけ！！
    ]);
    let output = '';
    proc.stdout.on('data', (data) => (output += data.toString()));
    proc.stderr.on('data', (data) => console.error(`stderr: ${data}`));
    proc.on('close', (code) => {
      code === 0 ? resolve(output) : reject(new Error('whisper-cli failed'));
    });
  });
  
  const plainText = result
  .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
  .trim();
  
   const txtPath = webmPath.replace('.webm', '.txt');
   const plainPath = webmPath.replace('.webm', '.plain.txt');
   await fs.writeFile(txtPath, result, 'utf-8');
   await fs.writeFile(plainPath, plainText, 'utf-8');
  
   await unlink(webmPath);
   await unlink(wavPath);

  return NextResponse.json({ text: result });
}
