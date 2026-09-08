import { describe, expect, it, vi } from 'vitest';
import { encodeWav, transcribeRecording } from './recordingTranscription';

describe('recording transcription', () => {
  it('rejects a missing key before sending audio', async () => {
    const request = vi.fn();
    await expect(transcribeRecording(new Blob(['audio']), '', {request})).rejects.toThrow(/키/);
    expect(request).not.toHaveBeenCalled();
  });
  it('explains an invalid key instead of reporting a generic fetch failure', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'invalid_api_key'}}), {status:401}));
    await expect(transcribeRecording(new Blob(['audio']), 'test', {request})).rejects.toThrow(/401/);
  });
  it('stops before uploading when the key cannot be authenticated', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', {status:401}));
    await expect(transcribeRecording(new Blob(['audio']), 'test', {request})).rejects.toThrow();
    expect(request.mock.calls).toHaveLength(1);
    expect(request.mock.calls[0][1]?.body).toBeUndefined();
  });
  it('encodes exact sample boundaries as valid mono WAV instead of slicing compressed bytes', async () => {
    const wav = encodeWav([new Float32Array([-1,0,1,0.5])],16000,1,3);
    const buffer = await new Promise<ArrayBuffer>((resolve,reject)=> {const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(wav);});
    const view = new DataView(buffer);
    expect(buffer.byteLength).toBe(48);
    expect(view.getUint32(24,true)).toBe(16000);
    expect(view.getUint32(40,true)).toBe(4);
    expect(view.getInt16(44,true)).toBe(0);
    expect(view.getInt16(46,true)).toBe(32767);
  });
  it('transcribes a large recording as independently playable parts in order and closes the decoder', async () => {
    const samples = new Float32Array(16000*300+32000);
    const close=vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext',class {
      close=close;
      async decodeAudioData() {return {numberOfChannels:1,sampleRate:16000,length:samples.length,getChannelData:()=>samples};}
    });
    const blob={size:37644424,arrayBuffer:async()=>new ArrayBuffer(1)} as Blob;
    const sizes:number[]=[];
    const request=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=> {
      if (!init?.body) return new Response('{}');
      const file=(init.body as FormData).get('file') as File;
      sizes.push(file.size);
      expect(file.type).toBe('audio/wav');
      return new Response(JSON.stringify({text:`구간 ${sizes.length}`}));
    });
    try {
      await expect(transcribeRecording(blob,'test',{request})).resolves.toBe('구간 1\n구간 2');
      expect(sizes).toEqual([9600044,64044]);
      expect(close).toHaveBeenCalledOnce();
    } finally {vi.unstubAllGlobals();}
  });
  it('labels the failing network stage and never echoes credentials', async () => {
    const request=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(transcribeRecording(new Blob(['audio']),'secret-value',{request})).rejects.toThrow(/인증 확인 네트워크/);
  });
});
