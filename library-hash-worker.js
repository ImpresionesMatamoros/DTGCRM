importScripts('library-hash.js');
self.onmessage=async function(e){try{var file=e.data.file,hash=new DTGFileHash();for(var p=0;p<file.size;p+=4194304){hash.update(new Uint8Array(await file.slice(p,p+4194304).arrayBuffer()));self.postMessage({progress:Math.min(1,(p+4194304)/file.size)});}self.postMessage({sha256:hash.hex()});}catch{self.postMessage({error:true});}};
