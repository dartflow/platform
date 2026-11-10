import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createDevDb} from './baan-dev-db.mjs';

execFileSync(process.execPath, ['scripts/build.mjs'], {stdio: 'inherit'});
const {default: worker} = await import('../dist/server/index.js');
const DB = createDevDb();
const arg = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (arg >= 0 && process.argv[arg + 1]) || 5173);

createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method;
    const proto = incoming.headers['x-forwarded-proto']?.split(',')[0] || 'http';
    const host = incoming.headers['x-forwarded-host']?.split(',')[0] || incoming.headers.host;
    const options = {method, headers: incoming.headers};
    if (method !== 'GET' && method !== 'HEAD') {
      options.body = Readable.toWeb(incoming);
      options.duplex = 'half';
    }
    const response = await worker.fetch(new Request(`${proto}://${host}${incoming.url}`, options), {DB});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500).end('De lokale preview kon het verzoek niet verwerken.');
  }
}).listen(port, '0.0.0.0', () => console.log(`Dartflow preview on port ${port}`));
