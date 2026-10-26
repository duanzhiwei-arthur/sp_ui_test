import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverFailureVideo } from './failure-video-delivery.mjs';

function fixture(fail = '') {
  const calls = [];
  const io = {
    cover: async () => { calls.push('cover'); if (fail === 'cover') throw new Error('ffmpeg missing'); return 'image'; },
    convert: async () => { calls.push('convert'); if (fail === 'convert') throw new Error('timeout'); return 'movie.mp4'; },
    upload: async (file, type) => { calls.push(`upload:${type}`); if (fail === 'upload' && type === 'mp4') throw new Error('upload failed'); return file; },
    send: async (type) => { calls.push(`send:${type}`); if (fail === 'send' && type === 'media') throw new Error('media rejected'); },
    warn: () => calls.push('warning')
  };
  return { io, calls };
}
test('missing screenshot extracts cover and sends playable video', async () => {
  const { io, calls } = fixture();
  assert.equal(await deliverFailureVideo({ video: 'video.webm' }, io), 'media');
  assert.deepEqual(calls, ['cover', 'convert', 'upload:mp4', 'send:media']);
});
for (const stage of ['cover', 'convert', 'upload', 'send']) test(`${stage} failure still sends original file`, async () => {
  const { io, calls } = fixture(stage);
  assert.equal(await deliverFailureVideo({ video: 'video.webm' }, io), 'file');
  assert.equal(calls.at(-1), 'send:file');
});
test('screenshot already present avoids cover generation', async () => {
  const { io, calls } = fixture(); await deliverFailureVideo({ video: 'video.webm', imageKey: 'existing' }, io);
  assert.ok(!calls.includes('cover'));
});
test('no video produces no IO and final upload failures remain visible', async () => {
  const { io, calls } = fixture('cover');
  assert.equal(await deliverFailureVideo({}, io), 'no-video'); assert.equal(calls.length, 0);
  io.upload = async () => { throw new Error('file upload unavailable'); };
  await assert.rejects(deliverFailureVideo({ video: 'video.webm' }, io), /unavailable/);
});
