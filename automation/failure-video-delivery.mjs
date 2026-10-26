// Dependencies are injected for offline tests: no production message is sent
// when exercising cover/ffmpeg/upload failures.
export async function deliverFailureVideo(artifact, io) {
  if (!artifact.video) return 'no-video';
  let imageKey = artifact.imageKey;
  if (!imageKey) {
    try { imageKey = await io.cover(artifact.video); }
    catch { io.warn('失败截图不可用，录像抽帧失败；将直接发送原录像文件。'); }
  }
  if (imageKey) {
    try {
      const mp4 = await io.convert(artifact.video);
      const fileKey = await io.upload(mp4, 'mp4');
      await io.send('media', { file_key: fileKey, image_key: imageKey });
      return 'media';
    } catch { io.warn('可播放录像发送失败；降级发送原录像文件。'); }
  }
  const fileKey = await io.upload(artifact.video, 'stream');
  await io.send('file', { file_key: fileKey });
  return 'file';
}
