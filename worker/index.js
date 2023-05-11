
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

	const url=request.url.toString();

	const etag=request.headers.get("If-None-Match");
	const params={};
	const searchParams=new URL(request.url).searchParams;
	if(searchParams){
		for(const [k,v] of searchParams) params[k]=v;
	}

	console.log(url);

	let optimizerUrl=url;
	if(optimizerUrl.indexOf("?")==-1) optimizerUrl+="?";
	else optimizerUrl+="&";
	optimizerUrl+="noCache";
	optimizerUrl=IMAGE_OPTIMIZER+encodeURIComponent(optimizerUrl);
	for(const [k,v] of Object.entries(params)) optimizerUrl+=`&${k}=${v}`;
	const cacheRequest=new Request(optimizerUrl);        
	const optimizedHash=await hash(optimizerUrl);
	const cache = await caches.open('optimgs:cache');



	const transform=(response)=>{
		const { readable, writable } = new TransformStream();
		response.body.pipeTo(writable);		
		   
        const proxiedResp=new Response(readable, response);
        proxiedResp.headers.set("Cache-Control","public, max-age=31536000, immutable");
		proxiedResp.headers.set("Content-Type","image/webp");
		proxiedResp.headers.set("etag",optimizedHash);
		return proxiedResp;
		
	}

	// local cache
	if(etag==optimizedHash){
		return new Response("", {
			status:304,
			headers: {
				'Cache-Control': 'public, max-age=0, must-revalidate'
			}
		});
	}


	// edge cache
	{
		const cachedResponse=await cache.match(cacheRequest);
		if(cachedResponse){ // check if request is in cache
			console.log("Response already in cache");
			return transform(cachedResponse);
		}
	}
	
	// Object cache
	{
		const cacheUrl=IMAGE_CACHE+optimizedHash+".webp";
		console.log("Fetch optimized image",cacheUrl);
		const optimizedCacheRequest=new Request(cacheUrl);
		const optimizedCacheResponse=await fetch(optimizedCacheRequest);
		
		if(optimizedCacheResponse.status<400){	 
			console.log("Optimized image found!");
			const proxiedResp=transform(optimizedCacheResponse);

			console.log("Cache response");
			await cache.put(cacheRequest,proxiedResp.clone());

			return proxiedResp;
		}
	}

	// Optimizer
	{
		console.log("Optimized image not found. Invoke optimizer",optimizerUrl);
		const optimizerRequest=new Request(optimizerUrl);
		const optimizerResponse= await fetch(optimizerRequest);
		if(optimizerResponse.status<400){	 
			console.log("Received optimized image from optimizer");
			const proxiedResp=transform(optimizerResponse);

			console.log("Cache response");
			await cache.put(cacheRequest,proxiedResp.clone());

			return proxiedResp;
		}
	}

	return undefined;
}


export default {
	async fetch(request, env, ctx) {
		if(request.url.endsWith("/acclr")){
			return new Response("2.0", {
				status: 200,
				statusText: "OK",
				headers: {
					"Content-Type": "text/plain",
					"Cache-Control": "no-cache, no-store, must-revalidate"
				}
			});
		}

		
		const searchParams=new URL(request.url).searchParams;

		const noCache = searchParams&&searchParams.has("noCache");
		console.log("Cache enabled:",!noCache);
 		let response;

		if(!noCache&&isImage(request)){
			console.log("Is image");
			response = await fetchOptimizedImage(request,env);
		}
		
		if(!response){
			response = await fetchOrigin(request,env)
		}

		return response;	

	},
};
