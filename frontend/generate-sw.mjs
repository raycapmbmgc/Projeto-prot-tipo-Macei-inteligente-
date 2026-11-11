import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const assets = readdirSync('dist/assets').filter(x => !x.endsWith('.map')).map(x => '/assets/' + x);
const files = ['/', '/icon.svg', '/manifest.webmanifest', '/logo-maceio.png', ...assets];
const hash = createHash('sha256');
for (const file of files) hash.update(readFileSync(file === '/' ? 'dist/index.html' : 'dist' + file));
const sw = readFileSync('public/sw.js', 'utf8').replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16)).replace('/* PRECACHE */ []', JSON.stringify(files));
writeFileSync('dist/sw.js', sw);
