import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {extname, join} from 'node:path';

const contents = file => readFileSync(file, 'utf8');
const source = (file, imports, exported) => {
  const body = contents(file)
    .replace(/^import\s+[^;]+;\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|class)\s)/gm, '');
  return `(() => {\n${imports}\n${body}\nreturn {${exported}};\n})()`;
};

function collectAssets(folder, base = '') {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = join(folder, entry.name);
    const url = base + '/' + entry.name;
    if (entry.isDirectory()) return collectAssets(file, url);
    const extension = extname(entry.name);
    const types = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
    };
    if (!types[extension]) throw new Error(`Onbekend assettype ${file}`);
    const text = types[extension].includes('charset=') || extension === '.svg';
    return [[url, [types[extension], readFileSync(file, text ? 'utf8' : 'base64'), !text]]];
  });
}

const qrFolder = 'worker/vendor/qr';
const qrModules = readdirSync(qrFolder).filter(name => name.endsWith('.js')).map(name =>
  `${JSON.stringify('./' + name.slice(0, -3))}: (module, require) => {\n${contents(join(qrFolder, name))}\n}`
).join(',\n');

const qr = `
/*
${contents(join(qrFolder, 'LICENSE'))}
*/
const QRCode = (() => {
  const modules = {${qrModules}};
  const cache = {};
  function require(id) {
    if (!cache[id]) {
      const module = {exports: {}};
      cache[id] = module;
      modules[id](module, require);
    }
    return cache[id].exports;
  }
  return require('./index');
})();
`;

const scoring = source('public/scoring.js', '', 'createMatch,applyScore,undo,checkout');
const domain = source('worker/baan-domain.js', 'const {createMatch,applyScore,undo,checkout} = scoring;', 'createBoard,applyBoard,boardView');
const apiImports = contents('worker/baan-api.js').match(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/baan-domain\.js['"];/m)?.[1];
if (!apiImports) throw new Error('Missing Baanmodus domain import');
const api = source('worker/baan-api.js', `const {${apiImports}} = baanDomain;`, 'handleBaanApi');
const domainExports = contents('worker/baan-domain.js').match(/^export\s+function\s+\w+/gm)?.map(x => x.split(/\s+/).at(-1)) || [];
const extraDomainExports = domainExports.filter(name => !['createBoard','applyBoard','boardView'].includes(name));

mkdirSync('dist/server', {recursive: true});
mkdirSync('dist/.openai', {recursive: true});
writeFileSync('dist/.openai/hosting.json', contents('.openai/hosting.json'));
writeFileSync('dist/server/index.js', [
  qr,
  `const scoring = ${scoring};`,
  `const baanDomain = ${extraDomainExports.length ? source('worker/baan-domain.js', 'const {createMatch,applyScore,undo,checkout} = scoring;', ['createBoard','applyBoard','boardView',...extraDomainExports].join(',')) : domain};`,
  `const {handleBaanApi} = ${api};`,
  `const assets = ${JSON.stringify(Object.fromEntries(collectAssets('public')))};`,
  contents('worker/index.js')
].join('\n'));
