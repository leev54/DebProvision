import {afterEach,describe,expect,it} from 'vitest';
import {WebSocketServer,type WebSocket} from 'ws';
import {decode,encode} from '@msgpack/msgpack';
import {FishClient} from './services/fish/FishClient.js';
const servers:WebSocketServer[]=[];
afterEach(()=>servers.splice(0).forEach(server=>server.close()));
async function server(handler:(socket:WebSocket)=>void){const wss=new WebSocketServer({port:0});servers.push(wss);await new Promise<void>(resolve=>wss.once('listening',resolve));wss.on('connection',handler);const address=wss.address();if(typeof address==='string'||!address)throw new Error('no address');return `http://127.0.0.1:${address.port}`;}
const afterRequest=(socket:WebSocket,run:()=>void)=>{socket.on('message',raw=>{const event=decode(Buffer.from(raw as Buffer)) as {event?:string};if(event.event==='stop')run();});};
describe('Fish realtime protocol',()=>{
  it('requires audio followed by finish(stop)',async()=>{const base=await server(socket=>afterRequest(socket,()=>{socket.send(encode({event:'audio',audio:new Uint8Array([1,2])}));socket.send(encode({event:'finish',reason:'stop'}));}));const chunks:Uint8Array[]=[];await new FishClient('k',base,100).streamSynthesize({voiceId:'v',text:'hello'},c=>{chunks.push(c);});expect([...chunks[0]!]).toEqual([1,2]);});
  it('rejects finish(error)',async()=>{const base=await server(socket=>afterRequest(socket,()=>socket.send(encode({event:'finish',reason:'error'}))));await expect(new FishClient('k',base,100).streamSynthesize({voiceId:'v',text:'x'},()=>{})).rejects.toThrow('finish reason error');});
  it('rejects unexpected close',async()=>{const base=await server(socket=>afterRequest(socket,()=>socket.close()));await expect(new FishClient('k',base,100).streamSynthesize({voiceId:'v',text:'x'},()=>{})).rejects.toThrow('closed before');});
  it('times out waiting for first audio',async()=>{const base=await server(()=>{});await expect(new FishClient('k',base,100).streamSynthesize({voiceId:'v',text:'x'},()=>{})).rejects.toThrow('first-audio timeout');});
  it('cancels with AbortSignal',async()=>{const base=await server(()=>{});const controller=new AbortController();const result=new FishClient('k',base,1000).streamSynthesize({voiceId:'v',text:'x'},()=>{},controller.signal);controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});});
});
