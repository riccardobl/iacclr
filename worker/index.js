
//Set environment variables
// IMAGE_OPTIMIZER="";
// const IMAGE_CACHE="";

function isImage(request){
	const url=new URL(request.url);	
	const ext=url.pathname.split(".").pop();
	console.log("Ext",ext);
	return ["png","jpg","jpeg","gif","webp"].indexOf(ext)>-1;
}

 
async function hash(tx){
	const msgBuffer = await new TextEncoder().encode(tx);
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	return [...new Uint8Array(hashBuffer)]
	.map((b) => b.toString(16).padStart(2, '0'))
	.join('');
}


async function fetchOrigin(request,env){
	console.log("Fetch origin content. Not image. Assume dynamic")
	return fetch(request);
}

async function fetchOptimizedImage(request,env){
	const IMAGE_CACHE=env.IMAGE_CACHE;
	const IMAGE_OPTIMIZER=env.IMAGE_OPTIMIZER;	

	const url=request.url;
	const urlHash=await hash(url);

	const cache = await caches.open('optimgs:cache');
	const cachedResponse=await cache.match(request);
	if(cachedResponse){ // check if request is in cache
		console.log("Response already in cache");
		return cachedResponse;
	}

	const transform=(response)=>{
		const { readable, writable } = new TransformStream();
		response.body.pipeTo(writable);		
		   
        const proxiedResp=new Response(readable, response);
        proxiedResp.headers.set("Cache-Control","public, max-age=31536000, immutable");
		proxiedResp.headers.set("Content-Type","image/webp");
		return proxiedResp;
		
	}
	
	const cacheUrl=IMAGE_CACHE+urlHash+".webp";
	console.log("Fetch optimized image",cacheUrl);
	const cacheRequest=new Request(cacheUrl);
	const cacheResponse=await fetch(cacheRequest);
	
	if(cacheResponse.status<400){	 
		console.log("Optimized image found!");
		const proxiedResp=transform(cacheResponse);

		console.log("Cache response");
		await cache.put(request,proxiedResp.clone());

		return proxiedResp;
	}

	// if image not cached, trigger optimizer
	const optimizedUrl=IMAGE_OPTIMIZER+encodeURIComponent(url+"?noCache");
	console.log("Optimized image not found. Invoke optimizer",optimizedUrl,cacheResponse.status,cacheResponse.statusText);
	const optimizerRequest=new Request(optimizedUrl);
	const optimizerResponse= await fetch(optimizerRequest);
	if(optimizerResponse.status<400){	 
		console.log("Received optimized image from optimizer");
		const proxiedResp=transform(optimizerResponse);

		console.log("Cache response");
		await cache.put(request,proxiedResp.clone());

		return proxiedResp;
	}

	return undefined;
}


export default {
	async fetch(request, env, ctx) {
		if(request.url.endsWith("/acclr")){
			return new Response("1.0", {
				status: 200,
				statusText: "OK",
				headers: {
					"Content-Type": "text/plain",
					"Cache-Control": "no-cache, no-store, must-revalidate"
				}
			});
		}

		
		const searchParams = request.url.split("?")[1];
		const noCache = searchParams&&searchParams.indexOf("noCache") > -1;
		console.log("Cache enabled:",!noCache);
 		let response;

		if(isImage(request)){
			console.log("Is image");
			if (!noCache) {
				response = await fetchOptimizedImage(request,env);
			}
		}
		
		if(!response){
			response = await fetchOrigin(request,env)
		}

		return response;	

	},
};
