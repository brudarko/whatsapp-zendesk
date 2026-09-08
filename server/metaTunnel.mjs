import { createServer, request } from "node:http";

// Expose only the state-validated OAuth callback, never the local send/admin API.
createServer((req, res) => {
  if (!["GET","POST"].includes(req.method) || req.url?.split("?")[0] !== "/meta/callback") {
    res.writeHead(404); return res.end();
  }
  const upstream = request({ hostname:"127.0.0.1", port:8787, path:req.url, method:req.method, headers:{...(req.headers.origin?{origin:req.headers.origin}:{}),"Content-Type":"application/json"}, timeout:60000 }, response => {
    res.writeHead(response.statusCode, { "Content-Type":response.headers["content-type"]||"application/json", "Cache-Control":"no-store", "Referrer-Policy":"no-referrer", "Content-Security-Policy":response.headers["content-security-policy"]||"default-src 'none'; frame-ancestors 'none'" });
    response.pipe(res);
  });
  upstream.on("timeout",()=>upstream.destroy());
  upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  req.on("aborted",()=>upstream.destroy());
  let size=0;
  req.on("data",chunk=>{size+=chunk.length;if(size>16384){upstream.destroy();req.destroy();}else upstream.write(chunk);});
  req.on("end",()=>upstream.end());
}).listen(8789,"127.0.0.1",()=>console.log("Retorno Meta disponível para túnel na porta 8789."));
