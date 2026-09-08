export function encodeWav(channels: Float32Array[], sampleRate: number, start: number, end: number): Blob {
  const count = end - start;
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const label = (offset: number, value: string) => {for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i));};
  label(0,'RIFF'); view.setUint32(4,36+count*2,true); label(8,'WAVE'); label(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); label(36,'data'); view.setUint32(40,count*2,true);
  for (let i=0;i<count;i++) {
    let sample=0;
    for (const channel of channels) sample+=channel[start+i]/channels.length;
    sample=Math.max(-1,Math.min(1,sample));
    view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);
  }
  return new Blob([buffer],{type:'audio/wav'});
}
export async function transcribeRecording(blob: Blob, key: string, options: {request?: typeof fetch; onProgress?: (message: string)=>void; proxyUrl?: string; proxyHeaders?: HeadersInit} = {}): Promise<string> {
  const proxy = options.proxyUrl?.trim();
  if (!proxy && !key?.trim()) throw new Error('OpenAI 전사 서버가 설정되지 않았습니다.');
  if (!blob.size) throw new Error('녹음 파일이 비어있습니다.');
  const request=options.request??fetch;
  const call=async (stage:string,url:string,init:RequestInit,timeout=120000) => {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const response=await request(url,{...init,signal:controller.signal});
      if (response.status===401) throw new Error('OpenAI 인증 실패 (401): API 키가 유효하지 않습니다. 유효한 키로 배포 설정을 갱신해야 합니다.');
      if (!response.ok && !(stage==='인증 확인' && response.status===403)) {
        throw new Error(`${stage} 실패 (HTTP ${response.status})${response.status===429?' — 사용량 또는 결제 한도를 확인하세요.':''}`);
      }
      // Consume the body while the timeout is active. Never echo provider messages containing credentials.
      return await response.json();
    } catch(error) {
      if (controller.signal.aborted) throw new Error(`${stage} 시간 초과. 연결을 확인하고 다시 시도하세요.`);
      if (error instanceof TypeError) throw new Error(`${stage} 네트워크 연결 실패. OpenAI 연결 또는 브라우저 차단을 확인하세요.`);
      throw error;
    } finally {clearTimeout(timer);}
  };
  if (!proxy) {
    options.onProgress?.('OpenAI 인증 확인 중…');
    await call('인증 확인','https://api.openai.com/v1/models/whisper-1',{headers:{Authorization:`Bearer ${key.trim()}`}},30000);
  }
  const upload=async (part:Blob,name:string) => {
    const form=new FormData();
    form.append('file',part,name); form.append('model','whisper-1'); form.append('language','ko');
    if (proxy) form.append('action','transcribe');
    // Long phone recordings can take several minutes even after upload; keep the
    // client waiting long enough for the server-side Whisper request to finish.
    const data=await call('Whisper 전사',proxy ?? 'https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:proxy ? options.proxyHeaders : {Authorization:`Bearer ${key.trim()}`},body:form},600000);
    if (typeof data.text!=='string' || !data.text.trim()) throw new Error('Whisper 전사 결과가 비어있습니다.');
    return data.text as string;
  };
  if (blob.size<=24*1024*1024) {
    const type=blob.type.toLowerCase();
    const ext=type.includes('wav')?'wav':type.includes('ogg')?'ogg':type.includes('mpeg')||type.includes('mp3')?'mp3':type.includes('mp4')?'mp4':'webm';
    options.onProgress?.('Whisper 전사 중…');
    return upload(blob,`recording.${ext}`);
  }
  options.onProgress?.('큰 녹음을 전사용 구간으로 변환 중…');
  const context=new AudioContext({sampleRate:16000});
  try {
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    const step=Math.min(decoded.sampleRate*300,Math.floor((24*1024*1024-44)/2)-decoded.sampleRate);
    const remainder=decoded.length%step;
    const total=Math.ceil(decoded.length/step)-(decoded.length>step && remainder>0 && remainder<decoded.sampleRate?1:0);
    const texts:string[]=[];
    for(let start=0,index=1;start<decoded.length;index++) {
      let end=Math.min(start+step,decoded.length);
      if(decoded.length-end<decoded.sampleRate) end=decoded.length;
      options.onProgress?.(`Whisper 전사 중… (${index}/${total} 구간)`);
      texts.push(await upload(encodeWav(channels,decoded.sampleRate,start,end),`part-${index}.wav`));
      start=end;
    }
    return texts.join('\n');
  } catch(error) {
    if (error instanceof DOMException && error.name==='EncodingError') throw new Error('녹음 파일을 디코딩하지 못했습니다. 원본 파일은 보관되어 있습니다.');
    throw error;
  } finally {await context.close();}
}
