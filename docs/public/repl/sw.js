/* eslint-disable no-console */

const update = async (version, options) => {
  console.time('Update');

  const diagnostics = [];
  const result = {
    type: 'result',
    outputHtml: '',
    clientModules: [],
    serverModules: [],
    diagnostics,
    docElementAttributes: {},
    headAttributes: {},
    headElements: [],
    bodyAttributes: {},
    bodyInnerHtml: '',
  };

  try {
    await loadDependencies(version, options);

    result.clientModules = await bundleApp(options, diagnostics, '/main.tsx', 'client');
    result.serverModules = await bundleApp(options, diagnostics, '/entry.server.tsx', 'server');

    await renderHtml(result);

    ctx.clientModules = result.clientModules;
  } catch (e) {
    result.diagnostics.push({
      message: String(e),
      severity: 'Error',
    });
    console.error(e);
  }

  await sendMessageToIframe(result);

  console.timeEnd('Update');
};

const bundleApp = async (options, diagnostics, inputPath, buildType) => {
  console.time(`Bundle ${buildType}`);

  const isSsr = buildType === 'server';

  const qwikRollupPluginOpts = {
    srcInputs: options.srcInputs,
    entryStrategy: options.entryStrategy,
    minify: options.minify,
    debug: options.debug,
    ssrBuild: isSsr,
  };

  const rollupInputOpts = {
    input: inputPath,
    cache: ctx.rollupCache,
    plugins: [
      self.qwikOptimizer.qwikRollup(qwikRollupPluginOpts),
      {
        resolveId(importee, importer) {
          if (!importer) {
            return importee;
          }
          if (importee === '@builder.io/qwik' || importee === '@builder.io/qwik/jsx-runtime') {
            return '\0qwikCore';
          }
          if (importee === '@builder.io/qwik/server') {
            return '\0qwikServer';
          }
          return {
            id: importee,
            external: true,
          };
        },
        load(id) {
          if (buildType === 'server') {
            if (id === '\0qwikCore') {
              return getRuntimeBundle('qwikCore');
            }
            if (id === '\0qwikServer') {
              return getRuntimeBundle('qwikServer');
            }
          }
          if (id === '\0qwikCore') {
            return ctx.coreEsmCode;
          }
          return null;
        },
      },
    ],
    onwarn(warning) {
      diagnostics.push({ message: warning.message });
    },
  };

  const rollupOutputOpts = {
    format: isSsr ? 'cjs' : 'es',
    inlineDynamicImports: isSsr,
  };

  const bundle = await self.rollup.rollup(rollupInputOpts);

  ctx.rollupCache = bundle.cache;

  const generated = await bundle.generate(rollupOutputOpts);

  const outputs = generated.output.map((o) => ({
    path: o.fileName,
    code: o.code,
    isEntry: o.isDynamicEntry,
  }));

  console.timeEnd(`Bundle ${buildType}`);

  return outputs;
};

const renderHtml = async (result) => {
  console.time(`SSR Html`);

  const serverTransformModule = result.serverModules.find((m) => m.path.endsWith('.js'));
  const serverCode = serverTransformModule.code;

  const module = { exports: {} };
  const runModule = new Function('module', 'exports', serverCode);
  runModule(module, module.exports);

  const server = module.exports;

  const ssrResult = await server.render({
    url: '/repl/',
    base: '/repl/',
  });

  result.outputHtml = self.prettier.format(ssrResult.html, {
    parser: 'html',
    plugins: self.prettierPlugins,
  });

  console.timeEnd(`SSR Html`);
};

const receiveMessageFromIframe = (ev) => {
  if (ev.data.type === 'update') {
    update(ev.data.version, ev.data.options);
  }
};

const sendMessageToIframe = async (msg) => {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage(msg));
};

const loadDependencies = async (version, options) => {
  if (
    !self.qwikCore ||
    !self.qwikOptimizer ||
    !self.qwikServer ||
    !self.rollup ||
    self.qwikCore.version !== version ||
    self.qwikOptimizer.versions.qwik !== version ||
    self.qwikServer.version !== version ||
    self.rollup.VERSION !== rollupVersion
  ) {
    console.time('Load dependencies');
    self.qwikCore = self.qwikOptimizer = self.qwikServer = self.rollup = null;

    const coreCjsUrl = `/repl/core.cjs`;
    const coreEsmUrl = `/repl/core.mjs`;
    const optimizerCjsUrl = `/repl/optimizer.cjs`;
    const serverCjsUrl = `/repl/server.cjs`;
    const rollupUrl = getNpmCdnUrl('rollup', rollupVersion, '/dist/rollup.browser.js');
    const prettierUrl = getNpmCdnUrl('prettier', prettierVersion, '/standalone.js');
    const prettierHtmlUrl = getNpmCdnUrl('prettier', prettierVersion, '/parser-html.js');

    const depUrls = [
      coreCjsUrl,
      coreEsmUrl,
      optimizerCjsUrl,
      serverCjsUrl,
      rollupUrl,
      prettierUrl,
      prettierHtmlUrl,
    ];

    const rsps = await Promise.all(depUrls.map((u) => fetch(u)));

    rsps.forEach((rsp) => {
      if (!rsp.ok) {
        throw new Error(`Unable to load dependency: ${rsp.url}`);
      }
    });

    const [
      coreCjsCode,
      coreEsmCode,
      optimizerCjsCode,
      serverCjsCode,
      rollupCode,
      prettierCode,
      prettierHtmlCode,
    ] = await Promise.all(rsps.map((rsp) => rsp.text()));

    ctx.coreEsmCode = coreEsmCode;

    const coreApply = new Function(coreCjsCode);
    const optimizerApply = new Function(optimizerCjsCode);
    const serverApply = new Function(serverCjsCode);
    const rollupApply = new Function(rollupCode);
    const prettierApply = new Function(prettierCode);
    const prettierHtmlApply = new Function(prettierHtmlCode);

    coreApply();
    console.debug(`Loaded @builder.io/qwik: ${self.qwikCore.version}`);
    optimizerApply();
    console.debug(`Loaded @builder.io/qwik/optimizer: ${self.qwikOptimizer.versions.qwik}`);
    serverApply();
    console.debug(`Loaded @builder.io/qwik/server: ${self.qwikServer.versions.qwik}`);
    rollupApply();
    console.debug(`Loaded rollup: ${self.rollup.VERSION}`);
    prettierApply();
    prettierHtmlApply();
    console.debug(`Loaded prettier: ${self.prettier.version}`);

    console.timeEnd('Load dependencies');
  }

  if (options.minify === 'minify' && !self.Terser) {
    console.time(`Load terser ${terserVersion}`);
    const terserUrl = getNpmCdnUrl('terser', terserVersion, '/dist/bundle.min.js');
    const terserRsp = await fetch(terserUrl);
    const terserCode = await terserRsp.text();
    const terserApply = new Function(terserCode);
    terserApply();
    console.timeEnd(`Load terser ${terserVersion}`);
  }
};

const onIframeRequest = (ev) => {
  const reqUrl = new URL(ev.request.url);
  const pathname = reqUrl.pathname;

  if (Array.isArray(ctx.clientModules)) {
    const clientModule = ctx.clientModules.find((m) => {
      const moduleUrl = new URL('./' + m.path, reqUrl);
      return pathname === moduleUrl.pathname;
    });

    if (clientModule) {
      return ev.respondWith(
        new Response(clientModule.code, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-QWIK-REPL': self.qwikCore.version,
          },
        })
      );
    }
  }
};

const ctx = {};

const rollupVersion = '2.70.1';
const prettierVersion = '2.6.2';
const terserVersion = '5.12.1';

const getNpmCdnUrl = (packageName, version, path) =>
  new URL(`https://cdn.jsdelivr.net/npm/${packageName}${version ? '@' + version : ''}${path}`);

const getRuntimeBundle = (runtimeBundle) => {
  const exportKeys = Object.keys(self[runtimeBundle]);
  const code = `
    const { ${exportKeys.join(', ')} } = self.${runtimeBundle};
    export { ${exportKeys.join(', ')} };
  `;
  return code;
};

self.onmessage = receiveMessageFromIframe;
self.onfetch = onIframeRequest;
self.oninstall = () => self.skipWaiting();
self.onactivate = () => self.clients.claim();
