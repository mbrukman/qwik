self.result = null;
self.iframeLocation = '';

const update = async (version, options) => {
  await loadQwikModules(version);

  const optimizer = await self.qwikOptimizer.createOptimizer();
  self.result = await optimizer.transformModules(options);

  sendMessageToIframe({
    type: 'result',
    result: self.result,
    html: `<html>
      <head>
      </head>
      <body style="color:red">fu</body>
    </html>`,
  });
};

const receiveMessageFromIframe = (ev) => {
  const evData = ev.data;
  const evType = evData && evData.type;
  if (evData && evData.location) {
    self.iframeLocation = evData.location;
  }
  if (evType === 'update') {
    update(evData.version, evData.options);
  }
};

const sendMessageToIframe = async (msg) => {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage(msg));
};

const loadQwikModules = async (version) => {
  if (
    !self.qwikOptimizer ||
    !self.qwikServer ||
    self.qwikOptimizer.versions.qwik !== version ||
    self.qwikServer.versions.qwik !== version
  ) {
    // https://cdn.jsdelivr.net/npm/@builder.io/qwik@${version}/optimizer.cjs
    const optimizerUrl = `/repl/optimizer.cjs`;
    const serverUrl = `/repl/server.cjs`;

    // cannot use importScripts() at this point in a service worker (too late)
    const [optimizerRsp, serverRsp] = await Promise.all([fetch(optimizerUrl), fetch(serverUrl)]);
    const [optimizerCode, serverCode] = await Promise.all([optimizerRsp.text(), serverRsp.text()]);

    const evalOptimizer = new Function(optimizerCode);
    const evalServer = new Function(serverCode);

    evalOptimizer();
    evalServer();

    console.log(`Loaded Qwik ${self.qwikOptimizer.versions.qwik}`);
  }
};

self.onfetch = (ev) => {
  const modules = self.result && self.result.modules;
  if (!Array.isArray(modules)) {
    return;
  }

  const req = ev.request;
  const reqUrl = new URL(req.url);
  const pathname = reqUrl.pathname;

  const module = modules.find((m) => {
    const moduleUrl = new URL('./' + m.path, reqUrl);
    return pathname === moduleUrl.pathname;
  });

  if (module) {
    const rsp = new Response(module.code, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
    ev.respondWith(rsp);
  }
};

self.onmessage = receiveMessageFromIframe;

self.oninstall = () => self.skipWaiting();

self.onactivate = () => self.clients.claim();