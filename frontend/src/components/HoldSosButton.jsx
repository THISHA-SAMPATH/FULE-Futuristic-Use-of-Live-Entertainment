import { useCallback, useEffect, useRef, useState } from 'react';

const HOLD_MS = 1000;

export default function HoldSosButton({ onTrigger, disabled = false, className = '', children, label = 'Trigger SOS', shortcut = false }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef(null);
  const frame = useRef(null);
  const startedAt = useRef(0);
  const fired = useRef(false);

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    window.cancelAnimationFrame(frame.current);
    timer.current = null;
    frame.current = null;
    setProgress(0);
  }, []);

  const begin = useCallback(() => {
    if (disabled || timer.current) return;
    fired.current = false;
    startedAt.current = performance.now();
    const animate = () => {
      const value = Math.min(1, (performance.now() - startedAt.current) / HOLD_MS);
      setProgress(value);
      if (value < 1) frame.current = window.requestAnimationFrame(animate);
    };
    frame.current = window.requestAnimationFrame(animate);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      stop();
      onTrigger?.();
    }, HOLD_MS);
  }, [disabled, onTrigger, stop]);

  useEffect(() => {
    if (!shortcut) return undefined;
    const down = (event) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key.toLowerCase() === 's' && !event.repeat && !editing) begin();
    };
    const up = (event) => { if (event.key.toLowerCase() === 's') stop(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [begin, shortcut, stop]);

  const keyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(); }
  };
  const keyUp = (event) => { if (event.key === 'Enter' || event.key === ' ') stop(); };

  return <button type="button" className={`hold-sos ${className}`} style={{ '--hold-progress': progress }} disabled={disabled} aria-label={label} aria-description="Press and hold for one second to trigger an SOS" onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); begin(); }} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onKeyDown={keyDown} onKeyUp={keyUp} onContextMenu={(event) => event.preventDefault()}>
    <span className="hold-sos-ring" aria-hidden="true"/>{children}
  </button>;
}
