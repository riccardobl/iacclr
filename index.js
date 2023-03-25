import Express from "express";
import Sharp from "sharp";
import Crypto from "crypto";
import Fs from "fs";
import Minio from "minio";
import {Readable} from "stream";
import fetch from "node-fetch";

let CONFIG={};
let URL_WHITELIST=[]; // whitelist of regex

const configPath=process.env.CONFIG_PATH||"./config.json";

try{
    if(!Fs.existsSync(configPath)){
        console.error("Config file not found");
        process.exit(1);
    }
    CONFIG=JSON.parse(Fs.readFileSync(configPath,{encoding:"utf8"}));
    for(let k in CONFIG){
        if(process.env[k]){
            if(CONFIG[k] instanceof Array){
                CONFIG[k]=process.env[k].split(",");
            }else if(CONFIG[k] instanceof Number){
                CONFIG[k]=Number(process.env[k]);
            }else if(CONFIG[k] instanceof Boolean){
                CONFIG[k]=process.env[k]=="true";
            }else{
                CONFIG[k]=process.env[k];
            }
        }
    }
    URL_WHITELIST=CONFIG.URL_WHITELIST.map(regex=>new RegExp(regex));    
}catch(err){
    console.error(err);
    process.exit(1);
}


function getMinio(){
    let path=CONFIG.S3;
    const ssl=path.split("://")[0]=="https";
    path=path.split("://")[1];
    const [userPassword,hostPortRegionBucket]=path.split("@");
    const [user,password]=userPassword.split(":");
    const [hostPortRegion,bucket]=hostPortRegionBucket.split("/");
    const [hostPort,region]=hostPortRegion.split("#");
    const [host,port]=hostPort.split(":");
    if(!port||!host||!user||!password||!bucket||!region)throw "Invalid S3 path. Expected http[s]://user:password@host:port#region/bucket";
    return [bucket,new Minio.Client({
        endPoint: host,
        port: parseInt(port),
        useSSL: ssl,
        accessKey: user,
        region:region,
        secretKey: password
    })];
}


const app = Express();
app.use(Express.json());

async function setCache(hash,buffer){
    try{
        const [bucket,minio]=getMinio();
        await minio.putObject(bucket,hash+".webp", buffer);       
    }catch(err){ // we don't care if the cache fails, it will just be slower and keep trying it on each request until it works
        console.error(err);
    }
}

async function getCache(hash){
    try{
        if (CONFIG.S3_PUBLIC){ // if s3 public http url is provided, we can just fetch it directly
            console.log("Fetch via link");
            const url=CONFIG.S3_PUBLIC+"/"+hash+".webp";
            const req=await fetch(url);
            if(req.status==200){
                return req.body;
            }else{
                console.log("Not found in cache");
                return undefined;
            }
        }else{ // otherwise we need to use s3 api
            console.log("Fetch via api");
            const [bucket,minio]=getMinio();
            const listStream=await minio.listObjects(bucket,hash+".webp");
            let found=false;
            for await (const obj of listStream){
                if(obj.name==hash+".webp"){
                    found=true;
                    break;
                }
            }
            if(found){
                console.log("Found in cache");
                const stream=await minio.getObject(bucket,hash+".webp");
                return stream;
            }else{
                console.log("Not found in cache");
                return undefined;
            }
        }
    }catch(err){
        console.error(err);
        return null;
    }
}


async function handle(req,res,body={}){
    const searchParams=new URL(req.url,`https://${req.headers.host}`).searchParams;
    const originUrl = searchParams.get("i");
    
    if(!originUrl){
        res.status(400).send("Missing url");
        return;
    }

    if(!URL_WHITELIST.some(regex=>regex.test(originUrl))){ // we don't want to open this to the whole internet
        res.status(403).send("Forbidden");
        return;
    }
    
    const ip=
        req.headers["x-forwarded-for"] || 
        req.headers["cf-connecting-ip"] || 
        req.headers["x-real-ip"] ||
        req.socket.remoteAddress;

    const cleanUrl=new URL(originUrl);
    cleanUrl.searchParams.delete("noCache");
    console.log("Hash",cleanUrl.toString());
    
    const urlHash=Crypto.createHash("sha256").update(cleanUrl.toString()).digest("hex");

    // check if already cached
    let outStream=await getCache(urlHash);

    if(!outStream){        
        console.log("Fetch",originUrl);
        const response = await fetch(originUrl,{
            headers:{
                "User-Agent": req.headers["user-agent"],
                "X-Forwarded-For": ip // not a security feature, this is just to make the origin server know the advertised ip of the client            
            }
        });
        console.log("Done fetch",originUrl);

        // convert
        console.log("Convert to WEBP",originUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer=Buffer.from(arrayBuffer);
        const maxWidth=parseInt(body.maxWidth||CONFIG.MAX_WIDTH||1920);
        const maxHeight=parseInt(body.maxHeight||CONFIG.MAX_HEIGHT||1920);
        const quality=parseInt(body.quality||CONFIG.QUALITY||80);
        const lossless=Boolean(body.lossless||CONFIG.LOSSLESS||false);
        const nearLossless=Boolean(body.nearLossless||CONFIG.NEAR_LOSSLESS||false);
        const smartSubsample=Boolean(body.smartSubsample||CONFIG.SMART_SUBSAMPLE||true);
        const alphaQuality=parseInt(body.alphaQuality||CONFIG.ALPHA_QUALITY||0);
        const effort=6;

        const image=await Sharp(buffer).resize({
            width: maxWidth,
            height: maxHeight,
            fit: "inside",
            withoutEnlargement: true
        }).webp({
            quality: quality,
            lossless: lossless,
            nearLossless:nearLossless,
            smartSubsample: smartSubsample,
            alphaQuality:alphaQuality,
            effort:effort
        }).toBuffer();
        console.log("Done convert to WEBP",originUrl);

        // cache
        console.log("Cache",originUrl);
        setCache(urlHash,image); 
        console.log("Done cache",originUrl);
        
        // create stream
        outStream= Readable.from(Buffer.from(image));
    }

    // send
    console.log("Send converted",originUrl);
    res.set("Content-Type", "image/webp");
    res.set("Cache-Control", "max-age=31536000"); //  cache for 1 year, we actually just want something big here. Upstream will handle the real cache   
    outStream.pipe(res);
}

app.get("/", async (req, res) => {
    await handle(req,res);
});

app.post("/", async (req, res) => {
    // if json
    let body={};
    if(req.headers["content-type"]=="application/json"){
        body=req.body;
    }
    await handle(req,res,body);
});


app.listen(8080, () => {
    console.log("Server started on port 8080");
});
