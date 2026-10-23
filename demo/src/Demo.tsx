import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const { fontFamily: sans } = loadInter('normal', { weights: ['400', '500', '600', '700', '800'] });
const { fontFamily: mono } = loadMono('normal', { weights: ['400', '500', '700'] });

export const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);

const INK = '#0E0E12';
const PAPER = '#F4F3EF';
const TERMINAL = '#111116';
const MUTED = '#8A8A96';
const ACCENT = '#6D4AFF';
const GREEN = '#3CCB7F';

// Scenes, in frames.
const TITLE = s(3.5);
const CONNECT = s(5);
const BUILD = s(27);
const MONTAGE = s(11);
const END = s(6.5);
export const DURATION = TITLE + CONNECT + BUILD + MONTAGE + END;

const fade = (frame: number, length: number, edge = 12) =>
  interpolate(frame, [0, edge, length - edge, length], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const typed = (text: string, frame: number, start: number, perChar = 1.2) =>
  text.slice(0, Math.max(0, Math.floor((frame - start) / perChar)));

const Caret = () => {
  const frame = useCurrentFrame();
  return (
    <span style={{ opacity: Math.floor(frame / 15) % 2 === 0 ? 1 : 0, color: '#E8E8EE' }}>▍</span>
  );
};

export const Demo = () => (
  <AbsoluteFill style={{ background: INK, fontFamily: sans }}>
    <Sequence durationInFrames={TITLE}>
      <Title />
    </Sequence>
    <Sequence from={TITLE} durationInFrames={CONNECT}>
      <Connect />
    </Sequence>
    <Sequence from={TITLE + CONNECT} durationInFrames={BUILD}>
      <Build />
    </Sequence>
    <Sequence from={TITLE + CONNECT + BUILD} durationInFrames={MONTAGE}>
      <Montage />
    </Sequence>
    <Sequence from={TITLE + CONNECT + BUILD + MONTAGE} durationInFrames={END}>
      <End />
    </Sequence>
  </AbsoluteFill>
);

/* ---------- 1. Title ---------- */

const Title = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade(frame, TITLE),
        color: '#fff',
      }}
    >
      <div
        style={{
          fontSize: 168,
          fontWeight: 800,
          letterSpacing: -6,
          transform: `translateY(${(1 - rise) * 30}px)`,
        }}
      >
        Tusche
      </div>
      <div style={{ fontSize: 44, color: '#B9B9C4', marginTop: 8, opacity: rise }}>
        An open design canvas for your AI agent
      </div>
    </AbsoluteFill>
  );
};

/* ---------- 2. Connect ---------- */

const Window = ({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      background: TERMINAL,
      borderRadius: 18,
      border: '1px solid #26262E',
      boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    <div
      style={{
        height: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 18px',
        borderBottom: '1px solid #22222A',
      }}
    >
      {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
        <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
      ))}
      <div style={{ flex: 1, textAlign: 'center', color: MUTED, fontFamily: mono, fontSize: 17 }}>
        {title}
      </div>
      <div style={{ width: 57 }} />
    </div>
    <div style={{ flex: 1, padding: '26px 30px', fontFamily: mono, color: '#E8E8EE' }}>
      {children}
    </div>
  </div>
);

const COMMAND = 'claude mcp add tusche -- npx -y @tusche/cli mcp';

const Connect = () => {
  const frame = useCurrentFrame();
  const done = s(0.6) + COMMAND.length * 1.2;
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', opacity: fade(frame, CONNECT) }}
    >
      <div style={{ color: '#B9B9C4', fontSize: 38, marginBottom: 36, fontWeight: 500 }}>
        Connect it to your agent once
      </div>
      <Window title="~/habit-app" style={{ width: 1360, height: 300 }}>
        <div style={{ fontSize: 34, lineHeight: 1.7 }}>
          <span style={{ color: GREEN }}>❯ </span>
          {typed(COMMAND, frame, s(0.6))}
          {frame < done + 6 && <Caret />}
          {frame > done + 8 && (
            <div style={{ color: '#B9B9C4' }}>
              Added stdio MCP server <span style={{ color: '#fff' }}>tusche</span> to local config
            </div>
          )}
        </div>
      </Window>
      <div style={{ color: MUTED, fontSize: 26, marginTop: 30 }}>
        Claude Code · Codex · Gemini CLI · any MCP client — on your own subscription
      </div>
    </AbsoluteFill>
  );
};

/* ---------- 3. Build ---------- */

const PROMPT =
  'Design the home screen of a habit-tracking iPhone app in design/app.pen: today’s habits with progress, a streak summary and a bottom tab bar with four tabs. Make it playful.';

/** What the agent did, from the transcript of the eval run (skill 0.1.1). */
const STEPS: { at: number; tool: string; detail: string; frame?: number; say?: string }[] = [
  { at: 4.2, tool: 'read_skill', detail: 'SKILL.md · guide/mobile-app.md' },
  { at: 5.2, tool: 'get_style', detail: 'soft-play · accent: grape' },
  { at: 6.4, tool: 'execute', detail: 'tokens, phone frame, Habit row component', frame: 0 },
  { at: 8.4, tool: 'execute', detail: 'status bar, header', frame: 1 },
  { at: 10.2, tool: 'execute', detail: 'streak card  +49 nodes', frame: 2 },
  {
    at: 12.2,
    tool: '',
    detail: '',
    say: 'Header and streak card are done. Next: today’s habits and the tab bar.',
  },
  { at: 14.6, tool: 'execute', detail: 'today, habit list', frame: 3 },
  { at: 16.4, tool: 'execute', detail: 'more habits', frame: 4 },
  { at: 18.2, tool: 'execute', detail: 'tab bar  +27 nodes', frame: 5 },
  { at: 20.0, tool: 'render', detail: 'screenshot · the agent checks its work' },
  { at: 21.2, tool: 'lint', detail: '0 errors · 0 warnings' },
];

const Build = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const visible = STEPS.filter((step) => frame >= s(step.at));
  const stage = Math.max(-1, ...visible.map((step) => step.frame ?? -1));
  const shown = stage >= 0 ? stage : 0;
  const changedAt = visible.filter((step) => step.frame !== undefined).at(-1)?.at ?? 0;
  const flash = interpolate(frame - s(changedAt), [0, 8, 26], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const checked = frame >= s(20.0);
  const scan = interpolate(frame, [s(20.0), s(21.0)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const intro = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{ opacity: fade(frame, BUILD), flexDirection: 'row', padding: 56, gap: 48 }}
    >
      <Window
        title="claude — ~/habit-app"
        style={{ width: 960, transform: `translateX(${(1 - intro) * -40}px)` }}
      >
        <div style={{ fontSize: 22, lineHeight: 1.55 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ color: GREEN }}>❯</span>
            <span style={{ fontFamily: sans, fontSize: 25, lineHeight: 1.5 }}>
              {typed(PROMPT, frame, s(0.5), 0.55)}
              {frame < s(0.5) + PROMPT.length * 0.55 + 4 && <Caret />}
            </span>
          </div>
          <div style={{ height: 22 }} />
          {visible.map((step) => {
            const t = frame - s(step.at);
            const opacity = interpolate(t, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
            const y = interpolate(t, [0, 8], [10, 0], { extrapolateRight: 'clamp' });
            const style = { opacity, transform: `translateY(${y}px)`, marginBottom: 10 };
            if (step.say) {
              return (
                <div
                  key={step.at}
                  style={{
                    ...style,
                    fontFamily: sans,
                    fontSize: 24,
                    color: '#fff',
                    margin: '14px 0 18px',
                  }}
                >
                  {step.say}
                </div>
              );
            }
            return (
              <div key={step.at} style={{ ...style, display: 'flex', gap: 12 }}>
                <span style={{ color: step.tool === 'lint' ? GREEN : ACCENT }}>●</span>
                <span style={{ color: MUTED }}>tusche ·</span>
                <span style={{ color: '#fff', fontWeight: 700 }}>{step.tool}</span>
                <span style={{ color: '#B9B9C4' }}>{step.detail}</span>
              </div>
            );
          })}
        </div>
      </Window>

      <div
        style={{
          flex: 1,
          borderRadius: 18,
          background: PAPER,
          backgroundImage: 'radial-gradient(#D6D4CC 1.4px, transparent 1.4px)',
          backgroundSize: '26px 26px',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          opacity: intro,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 24,
            fontFamily: mono,
            fontSize: 18,
            color: '#6B6A63',
          }}
        >
          design/app.pen
        </div>
        {frame >= s(6.4) && (
          <div style={{ position: 'relative', height: 860, aspectRatio: '780 / 1688' }}>
            <div
              style={{
                position: 'absolute',
                top: -26,
                left: 0,
                fontSize: 15,
                color: '#6B6A63',
                fontWeight: 500,
              }}
            >
              Home
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(20,20,30,0.18)',
                outline: `${2 + flash * 2}px solid rgba(109,74,255,${0.25 + flash * 0.6})`,
              }}
            >
              <Img
                src={staticFile(`frames/home-${shown}.png`)}
                style={{ width: '100%', height: '100%' }}
              />
              {checked && scan < 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${scan * 100}%`,
                    height: 4,
                    background: GREEN,
                    boxShadow: `0 0 24px ${GREEN}`,
                  }}
                />
              )}
            </div>
            {frame >= s(21.2) && (
              <div
                style={{
                  position: 'absolute',
                  top: -34,
                  right: -150,
                  whiteSpace: 'nowrap',
                  background: INK,
                  color: '#fff',
                  borderRadius: 999,
                  padding: '9px 20px',
                  fontSize: 18,
                  fontWeight: 600,
                  opacity: interpolate(frame - s(21.2), [0, 8], [0, 1], {
                    extrapolateRight: 'clamp',
                  }),
                }}
              >
                <span style={{ color: GREEN }}>✓</span> lint clean · saved
              </div>
            )}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- 4. Montage ---------- */

const SHOTS: { file: string; prompt: string; pan?: boolean }[] = [
  { file: 'dashboard', prompt: 'Analytics dashboard for a B2B email marketing tool' },
  { file: 'landing', prompt: 'Landing page for Shiplog, a changelog tool', pan: true },
  { file: 'pricing', prompt: 'Pricing page with plans, a yearly switch and an FAQ' },
  { file: 'settings', prompt: 'Account settings in the blueprint style' },
  { file: 'slides', prompt: 'A seed pitch deck for a flood-prediction startup' },
];

const Montage = () => {
  const frame = useCurrentFrame();
  const each = Math.floor((MONTAGE - s(1.2)) / SHOTS.length);
  return (
    <AbsoluteFill style={{ opacity: fade(frame, MONTAGE), alignItems: 'center' }}>
      <div style={{ color: '#fff', fontSize: 46, fontWeight: 700, marginTop: 52 }}>
        Dashboards, landing pages, settings, slides
      </div>
      <div style={{ color: MUTED, fontSize: 24, marginTop: 8 }}>
        Real results of the agent with the Tusche skill, one prompt each
      </div>
      {SHOTS.map((shot, i) => (
        <Sequence key={shot.file} from={s(1.2) + i * each} durationInFrames={each}>
          <Shot {...shot} length={each} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Shot = ({
  file,
  prompt,
  pan,
  length,
}: {
  file: string;
  prompt: string;
  pan?: boolean;
  length: number;
}) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, length], [1.0, 1.04]);
  const scroll = pan
    ? interpolate(frame, [8, length - 8], [0, -78], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
      })
    : 0;
  return (
    <AbsoluteFill style={{ alignItems: 'center', opacity: fade(frame, length, 8) }}>
      <div
        style={{
          position: 'absolute',
          top: 200,
          width: 1440,
          height: 760,
          borderRadius: 14,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        }}
      >
        <Img
          src={staticFile(`frames/${file}.png`)}
          style={{
            width: '100%',
            transform: `scale(${zoom}) translateY(${scroll}%)`,
            transformOrigin: 'top center',
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 984,
          fontFamily: mono,
          fontSize: 22,
          color: '#B9B9C4',
        }}
      >
        <span style={{ color: GREEN }}>❯ </span>
        {prompt}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- 5. End ---------- */

const End = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 } });
  const line = (delay: number): CSSProperties => ({
    opacity: interpolate(frame, [delay, delay + 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
      }}
    >
      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -4,
          transform: `scale(${0.96 + rise * 0.04})`,
        }}
      >
        Tusche
      </div>
      <div style={{ fontSize: 36, color: '#B9B9C4', marginTop: 4, ...line(8) }}>
        Free and open source · your own agent · opens pen.dev files
      </div>
      <div
        style={{
          marginTop: 56,
          fontFamily: mono,
          fontSize: 34,
          background: TERMINAL,
          border: '1px solid #26262E',
          borderRadius: 14,
          padding: '20px 34px',
          ...line(18),
        }}
      >
        <span style={{ color: GREEN }}>❯ </span>
        {COMMAND}
      </div>
      <div style={{ marginTop: 40, fontSize: 30, fontFamily: mono, color: '#fff', ...line(28) }}>
        github.com/tusche-dev/tusche
      </div>
    </AbsoluteFill>
  );
};
