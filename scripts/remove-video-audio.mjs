import {renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const input = resolve(process.argv[2] || 'public/seuchatseguro-tour.mp4');
const temporary = `${input}.silent.mp4`;
const result = spawnSync('ffmpeg', ['-y', '-i', input, '-c:v', 'copy', '-an', '-movflags', '+faststart', temporary], {stdio: 'inherit'});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`ffmpeg encerrou com código ${result.status}`);
renameSync(temporary, input);
