import { Room } from 'livekit-client';

let room;
let canvasStream;
let animation;

window.startLiveKitSmokePublisher = async ({ serverUrl, token }) => {
  room = new Room({ adaptiveStream: false, dynacast: false });
  await room.connect(serverUrl, token);
  const canvas = document.getElementById('publisher');
  const context = canvas.getContext('2d');
  let frame = 0;
  const draw = () => {
    context.fillStyle = frame % 2 ? '#172544' : '#0F1B33';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#F6EFE3';
    context.font = '32px sans-serif';
    context.fillText(`FULE LIVEKIT SMOKE ${frame++}`, 28, 60);
    animation = requestAnimationFrame(draw);
  };
  draw();
  canvasStream = canvas.captureStream(12);
  const videoTrack = canvasStream.getVideoTracks()[0];
  await room.localParticipant.publishTrack(videoTrack, { name: 'smoke-video', simulcast: false });
  return { connected: room.state === 'connected', identity: room.localParticipant.identity };
};

window.stopLiveKitSmokePublisher = async () => {
  if (animation) cancelAnimationFrame(animation);
  canvasStream?.getTracks().forEach((track) => track.stop());
  await room?.disconnect();
  room = null;
  return true;
};
