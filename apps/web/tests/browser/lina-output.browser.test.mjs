import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const WEB_URL=process.env.AGENTLAB_WEB_URL??'http://127.0.0.1:5173';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(cdp,expression,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await cdp.evaluate(expression))return;await delay(75);}throw new Error('Browser condition failed: '+expression+'\n'+await cdp.evaluate('document.body.innerText.slice(-2000)'));}
async function click(cdp,text){await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)throw new Error('Missing button '+${JSON.stringify(text)});b.click()})()`);await delay(50);}
async function select(cdp,id,value){await cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(50);}
async function nextUntil(cdp,expression,max=1000){for(let i=0;i<max;i++){if(await cdp.evaluate(expression))return;await click(cdp,'Next');}throw new Error('Playback did not reach '+expression);}

test('Lina Output modal, manual delivery, unknown recovery, automatic playback and JSON inspector',{timeout:180000},async()=>{
 const profile=await mkdtemp(join(tmpdir(),'agentlab-lina-output-')),port=await unusedPort();
 const chrome=spawn(process.env.AGENTLAB_CHROME_BIN??'google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});let cdp;
 try{
  const target=await waitForPageTarget(port);cdp=await CdpClient.connect(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await cdp.send('Page.navigate',{url:WEB_URL+'/studio/lina'});
  await until(cdp,"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Run'&&!b.disabled)");
  await click(cdp,'Run');await until(cdp,"!!document.querySelector('dialog[open]')");
  assert.equal(await cdp.evaluate("document.getElementById('lina-output-case').options.length>=40"),true);
  await select(cdp,'lina-simulation-playback','manual');await select(cdp,'lina-simulation-follow','manual');await select(cdp,'lina-output-case','final');await click(cdp,'Run simulation');
  await nextUntil(cdp,"document.querySelector('.lina-simulation-progress')?.textContent.includes('Turn complete')");
  assert.equal(await cdp.evaluate("document.querySelectorAll('.lina-canvas-node.is-simulation-visited').length>10"),true);
  assert.equal(await cdp.evaluate("document.querySelector('.lina-simulation')?.textContent.includes('Delivery evidence')"),true);
  await cdp.evaluate("document.querySelector('[aria-label=\"Expand inspector sidebar\"]')?.click()");
  await cdp.evaluate("document.querySelector('[aria-label=\"Select Execute transport attempt\"]').click()");
  await click(cdp,'Contract');
  await until(cdp,"document.body.textContent.includes('Input schema')");
  assert.ok(await cdp.evaluate("document.querySelectorAll('.lina-contract-json .lina-json-key').length>0"));
  await click(cdp,'Run');await select(cdp,'lina-output-case','unknown-send');await click(cdp,'Run simulation');
  await nextUntil(cdp,"document.querySelector('.lina-simulation-progress')?.textContent.includes('Waiting for')");
  const before=await cdp.evaluate("document.querySelector('.lina-simulation-progress').textContent.match(/\\d+\\/\\d+/)?.[0]");await click(cdp,'Try mismatched response');assert.equal(await cdp.evaluate("document.querySelector('.lina-simulation-progress').textContent.match(/\\d+\\/\\d+/)?.[0]"),before);assert.ok(await cdp.evaluate("document.querySelector('.lina-simulation-progress').textContent.includes('Waiting for')"));
  await click(cdp,'Original send confirmed');await nextUntil(cdp,"document.querySelector('.lina-simulation-progress')?.textContent.includes('Turn complete')");
  await click(cdp,'Run');await select(cdp,'lina-output-case','final');await select(cdp,'lina-simulation-playback','automatic');await click(cdp,'Run simulation');await until(cdp,"document.querySelector('.lina-simulation-progress')?.textContent.includes('Auto-running')");await delay(2200);await click(cdp,'Pause');assert.ok(await cdp.evaluate("document.querySelector('.lina-simulation-progress').textContent.includes('Paused')"));
  await nextUntil(cdp,"document.querySelector('.lina-simulation-progress')?.textContent.includes('Turn complete')");
  if(process.env.AGENTLAB_LINA_SCREENSHOT){const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(process.env.AGENTLAB_LINA_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 }catch(error){console.error('Browser proof failure',error);console.error(await cdp?.evaluate('document.body.innerText'));throw error;}finally{await cdp?.close();chrome.kill('SIGTERM');await waitForExit(chrome);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForPageTarget(debugPort) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data))));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  evaluate(expression) {
    return this.send("Runtime.evaluate", { expression, returnByValue: true }).then((response) => {if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result?.value ?? null;});
  }

  close() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    this.socket.close();
    return new Promise((resolve) => this.socket.addEventListener("close", resolve, { once: true }));
  }

  receive(message) {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }
}
