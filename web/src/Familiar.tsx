import { motion, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";

export type CreatureState =
  | "idle" | "sweeping" | "preparing" | "asking" | "approved" | "denied" | "restored";

/* Each state must be unmistakable in silhouette. Eyes and brows carry the emotion;
   text carries the information — never both. */
const MOOD: Record<CreatureState, {
  scale: number; eyeR: number; brow: number; lidY: number; hue: number; bob: number; sacc: number;
}> = {
  idle:      { scale: 1.00, eyeR: 7, brow:   0, lidY:  0, hue: 262, bob: 4.0, sacc: 2200 },
  sweeping:  { scale: 1.02, eyeR: 6, brow:  -6, lidY:  0, hue: 205, bob: 1.5, sacc:  420 },
  preparing: { scale: 0.98, eyeR: 5, brow:   8, lidY:  3, hue: 205, bob: 2.0, sacc: 3000 },
  asking:    { scale: 1.10, eyeR: 9, brow: -12, lidY: -1, hue:  38, bob: 3.0, sacc: 5000 },
  approved:  { scale: 1.14, eyeR: 8, brow:  -8, lidY:  0, hue: 145, bob: 3.0, sacc: 1200 },
  denied:    { scale: 1.02, eyeR: 7, brow:  -4, lidY:  2, hue: 262, bob: 3.0, sacc: 1800 },
  restored:  { scale: 1.00, eyeR: 7, brow:   0, lidY:  0, hue: 262, bob: 4.0, sacc: 1000 },
};

export function Familiar({
  state = "idle", clearance = 0, size = 96,
}: { state?: CreatureState; clearance?: number; size?: number }) {
  const m = MOOD[state];
  const ref = useRef<SVGSVGElement>(null);
  const target = useRef({ x: 0, y: 0 });

  // Cursor gaze — the cheapest thing that turns a graphic into a creature.
  const gx = useSpring(0, { stiffness: 120, damping: 14 });
  const gy = useSpring(0, { stiffness: 120, damping: 14 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = ref.current?.getBoundingClientRect();
      if (!el) return;
      const dx = e.clientX - (el.left + el.width / 2);
      const dy = e.clientY - (el.top + el.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const r = (Math.min(d, 80) / 80) * 3.5;
      target.current = { x: (dx / d) * r, y: (dy / d) * r };
      gx.set(target.current.x); gy.set(target.current.y);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [gx, gy]);

  // Saccades — fast darts read as excitement, slow drift as contemplation.
  useEffect(() => {
    let t: number;
    const jitter = () => {
      t = window.setTimeout(() => {
        gx.set(target.current.x + (Math.random() - 0.5) * 3);
        gy.set(target.current.y + (Math.random() - 0.5) * 2);
        jitter();
      }, m.sacc * (0.6 + Math.random() * 0.8));
    };
    jitter();
    return () => clearTimeout(t);
  }, [m.sacc, gx, gy]);

  // Irregular blink. A regular one reads as mechanical.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 110);
        loop();
      }, 3000 + Math.random() * 4000);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // Clearance growth is permanent — it must still be visible in the last shot.
  const grow = 1 + clearance * 0.06;
  const tilt = state === "denied" ? -7 : 0;      // interested, never drooping
  const fill = `hsl(${m.hue} 62% 62%)`;

  return (
    <motion.svg
      ref={ref} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true"
      animate={{ scale: m.scale * grow, y: [0, -m.bob, 0], rotate: tilt }}
      transition={{
        scale: { type: "spring", stiffness: 300, damping: 18 },
        rotate: { type: "spring", stiffness: 260, damping: 16 },
        y: { duration: 3.6, repeat: Infinity, ease: "easeInOut" },
      }}
      style={{ overflow: "visible" }}
    >
      <motion.ellipse cx="48" cy="54" rx="29" ry="27" fill={fill}
        initial={false} animate={{ fill }}
        transition={{ duration: 0.3, ease: "easeOut" }} />
      {/* secondary action: a wisp that lags the body — cheap "expensive animation" signal */}
      <motion.circle
        cx="74" cy="24" r="4.5" fill={`hsl(${m.hue} 62% 78%)`}
        animate={{ y: [0, -m.bob * 1.8, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut", delay: 0.22 }}
      />
      {clearance >= 3 && (
        <motion.circle
          cx="20" cy="30" r="3.5" fill={`hsl(${m.hue} 62% 78%)`}
          initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
        />
      )}
      {[36, 60].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={48} rx={m.eyeR} ry={blink ? 0.8 : m.eyeR} fill="#fff" />
          <motion.circle
            r={m.eyeR * 0.48} fill="#141020" cx={cx} cy={48 + m.lidY}
            style={{ x: gx, y: gy }}
          />
          <motion.rect
            x={cx - 7} y={37} width={14} height={2.6} rx={1.3} fill="#141020"
            initial={false}
            animate={{ y: m.brow * 0.22, rotate: cx === 36 ? m.brow * 0.35 : -m.brow * 0.35 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
          />
        </g>
      ))}
    </motion.svg>
  );
}
