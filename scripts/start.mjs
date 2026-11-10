import {loadEnv} from './db-shared.mjs';
await loadEnv();
// This repository entrypoint is the local preview. systemd starts server.js directly.
process.env.HOSTNAME='127.0.0.1';
process.env.PORT ||= '3000';
await import('../.next/standalone/server.js');
