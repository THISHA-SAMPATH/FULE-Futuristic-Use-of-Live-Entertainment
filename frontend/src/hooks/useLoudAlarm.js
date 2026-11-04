import { useCallback, useEffect, useRef } from 'react';

export default function useLoudAlarm(active, enabled) {
  const contextRef = useRef(null);
  const createContext = useCallback(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    contextRef.current ??= new AudioCtx();
    return contextRef.current;
  }, []);
  const beep = useCallback((context) => {
    if (context?.state !== 'running') return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 880; gain.gain.value = 0.07;
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.22);
  }, []);
  const startOnGesture = useCallback(() => {
    if (!enabled) return;
    const context = createContext();
    if (context) context.resume().then(() => beep(context)).catch(() => {});
  }, [enabled, createContext, beep]);

  useEffect(() => {
    if (!active || !enabled) return undefined;
    const context = createContext();
    if (!context) return undefined;
    context.resume().then(() => beep(context)).catch(() => {});
    const timer = window.setInterval(() => beep(context), 1600);
    return () => window.clearInterval(timer);
  }, [active, enabled, createContext, beep]);

  return startOnGesture;
}
