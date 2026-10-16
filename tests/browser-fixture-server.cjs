'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
async function startFixtureServer(html){
 html=path.resolve(html);const root=path.dirname(html),fixtures=path.resolve(__dirname,'../tests/fixtures');
 for(const entry of JSON.parse(fs.readFileSync(path.join(fixtures,'audio-provenance.json'),'utf8'))){const bytes=fs.readFileSync(path.join(fixtures,entry.url));if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Audio fixture hash mismatch: '+entry.url);}
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||path.basename(html);
  const safe=directory=>{const target=path.resolve(directory,name);return target.startsWith(directory+path.sep)&&fs.existsSync(target)&&fs.statSync(target).isFile()?target:null;};
  const file=safe(root)||safe(fixtures);if(!file){res.writeHead(404);res.end();return;}
  const raw=fs.readFileSync(file),range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=raw.length-1;
  if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;if(start>end){res.writeHead(416);res.end();return;}}
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(range?206:200,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${raw.length}`}:{})});res.end(raw.subarray(start,end+1));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/${path.basename(html)}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={startFixtureServer};
