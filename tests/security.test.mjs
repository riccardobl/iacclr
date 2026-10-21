import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

test("the optimizer rejects URL smuggling and redirects while converting allowed images", async () => {
  const image = await sharp({create: {width: 2, height: 2, channels: 3, background: "red"}}).png().toBuffer();
  let originRequests = 0;
  const origin = createServer((req, res) => {
    originRequests++;
    if (req.url === "/image/redirect.png") {
      res.writeHead(302, {location: "/image/ok.png"}).end();
      return;
    }
    res.writeHead(200, {"content-type": "image/png"}).end(image);
  });
  const originPort = await listen(origin);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "iacclr-security-"));
  const configPath = path.join(directory, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    URL_WHITELIST: [`http://127\\.0\\.0\\.1:${originPort}/image/.+`]
  }));
  const probe = createServer();
  const appPort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  const app = spawn(process.execPath, ["index.js"], {
    cwd: path.resolve("."),
    env: {...process.env, CONFIG_PATH: configPath, PORT: String(appPort), NODE_OPTIONS: ""},
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        app.stdout.on("data", chunk => {
          if (chunk.toString().includes("Server started")) resolve();
        });
        app.once("exit", code => reject(new Error(`optimizer exited: ${code}`)));
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("optimizer startup timed out")), 5000);
        timer.unref();
      })
    ]);
    const request = url => fetch(`http://127.0.0.1:${appPort}/?i=${encodeURIComponent(url)}`);
    const accepted = await request(`http://127.0.0.1:${originPort}/image/ok.png`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("content-type"), "image/webp");
    assert.equal((await accepted.arrayBuffer()).byteLength > 0, true);

    const beforeSmuggle = originRequests;
    const smuggled = await request(`http://127.0.0.1:${originPort}/other/http://127.0.0.1:${originPort}/image/ok.png`);
    assert.equal(smuggled.status, 403);
    assert.equal(originRequests, beforeSmuggle);

    const redirected = await request(`http://127.0.0.1:${originPort}/image/redirect.png`);
    assert.equal(redirected.status, 502);
    assert.equal(originRequests, beforeSmuggle + 1);
  } finally {
    app.kill("SIGTERM");
    if (app.exitCode === null) await new Promise(resolve => app.once("exit", resolve));
    await new Promise(resolve => origin.close(resolve));
    await fs.rm(directory, {recursive: true, force: true});
  }
});
