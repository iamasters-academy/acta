// Fallback capture when the native helper is not available: browser microphone (channel 0)
// and optionally a shared tab's audio (channel 1), downsampled to 16 kHz PCM over the socket.
import { connectEvents, sendAudio } from '../api';

let ctx: AudioContext | null = null;
let streams: MediaStream[] = [];

const WORKLET = `
class Down extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.buf = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      if (this.pos >= this.ratio) { this.pos -= this.ratio; this.buf.push(Math.max(-1, Math.min(1, ch[i])) * 32767); }
    }
    if (this.buf.length >= 1600) { this.port.postMessage(Int16Array.from(this.buf)); this.buf = []; }
    return true;
  }
}
registerProcessor('down-16k', Down);`;

async function pipe(stream: MediaStream, channel: 0 | 1) {
  const src = ctx!.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx!, 'down-16k');
  node.port.onmessage = (e) => sendAudio(channel, e.data as Int16Array);
  src.connect(node);
}

export async function startWindowsCapture(opts: { echoCancellation?: boolean } = {}) {
  connectEvents();
  ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: opts.echoCancellation !== false, noiseSuppression: true },
  });
  streams.push(mic);
  await pipe(mic, 0);
  try {
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1, height: 1, frameRate: 1 }, audio: true });
    const audio = disp.getAudioTracks();
    if (!audio.length) {
      disp.getTracks().forEach((t) => t.stop());
      return { system: false };
    }
    streams.push(disp);
    await pipe(new MediaStream(audio), 1);
    for (const t of disp.getVideoTracks()) t.stop();
    return { system: true };
  } catch {
    return { system: false };
  }
}

export async function startBrowserCapture(opts: { tabAudio?: boolean } = {}) {
  connectEvents();
  ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  streams.push(mic);
  await pipe(mic, 0);
  if (opts.tabAudio) {
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (disp.getAudioTracks().length) {
      streams.push(disp);
      await pipe(new MediaStream(disp.getAudioTracks()), 1);
    }
  }
}

export function stopBrowserCapture() {
  for (const s of streams) s.getTracks().forEach((t) => t.stop());
  streams = [];
  void ctx?.close();
  ctx = null;
}
