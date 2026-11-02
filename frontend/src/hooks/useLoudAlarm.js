import { useEffect, useRef } from 'react';

export default function useLoudAlarm(active, enabled) {
  const contextRef = useRef(null);
  useEffect(() => {
    if (!active || !enabled) return undefined;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;
    let context = contextRef.current;
    if (!context) { context = new AudioCtx(); contextRef.current = context; }
    const beep = () => {
      if (context.state !== 'running') return;
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = 880; gain.gain.value = 0.07;
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.22);
    };
    context.resume().then(beep).catch(() => {});
    const timer = window.setInterval(beep, 1600);
    return () => window.clearInterval(timer);
  }, [active, enabled]);
}
