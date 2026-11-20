import { writeFileSync } from 'node:fs'

// 测试用音频不依赖 ffmpeg：直接生成 16bit PCM 单声道 WAV，
// 既能被 Chromium 解码，也能被 ffmpeg 探测出时长。
const HEADER_BYTES = 44

export function makeWavBuffer(seconds: number, sampleRate = 8000, freq = 440): Buffer {
  const samples = Math.max(1, Math.round(seconds * sampleRate))
  const dataBytes = samples * 2
  const buf = Buffer.alloc(HEADER_BYTES + dataBytes)

  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)

  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 8000)
    buf.writeInt16LE(value, HEADER_BYTES + i * 2)
  }
  return buf
}

export function writeWav(path: string, seconds: number, sampleRate = 8000): number {
  const buf = makeWavBuffer(seconds, sampleRate)
  writeFileSync(path, buf)
  return buf.length
}

// 内容可预测的二进制文件：用于断言 Range 返回的字节偏移是否精确
export function makePatternBuffer(size: number): Buffer {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = i % 251
  return buf
}
