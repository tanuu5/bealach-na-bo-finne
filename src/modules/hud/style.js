// hud/style.js — the HUD's one stylesheet (docs/DESIGN.md §9.1, §9.2, §9.5).
//
// Everything is scoped under `.bf-root` (the class the module puts on ctx.hud) with a `bf-`
// class prefix, so nothing here can reach the page. No panels, boxes, blur, borders or
// background fills exist anywhere in this file — §9.1 forbids them and §11.3 #5 forbids cards.
//
// Two layouts only (§9.2): the base rules below ARE the compact layout (portrait phones,
// landscape phones, small windows) and the single media query at the bottom is the wide one.
// R15: short landscape screens stay compact, which is why the query tests height as well.
//
// Opacity is driven from JS (one eased value per element, §9.5 timing) rather than by CSS
// transitions, so `?warm=` and `?phaseT=&freezeT` are deterministic. CSS only supplies the
// resting look and the sound button's beat strokes.

const WHITE = '236,228,207'; // boFinne
const GOLD = '217,165,71'; // torc

export const CSS = `
.bf-root{
  --bf-w:${WHITE};
  --bf-g:${GOLD};
  --bf-ja-a:.847;   /* × element 0.85 = 72% boFinne (§9.1) */
  --bf-sec-a:.529;  /* × element 0.85 = 45% secondary   */
  --bf-ja-serif:"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho",serif;
  --bf-ja-sans:"Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif;
  --bf-ga:"Cormorant Unicase","Cormorant Garamond",Georgia,serif;
  --bf-og:"Noto Sans Ogham","Segoe UI Historic",sans-serif;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  font-kerning:normal;
}
.bf-root *{box-sizing:border-box;margin:0;padding:0;border:0;background:none;}
.bf-el{
  position:absolute;
  pointer-events:none;
  opacity:0;
  text-shadow:0 0 14px rgba(8,13,12,.85);
  white-space:normal;
  -webkit-user-select:none;user-select:none;
}

/* ── title: a vertical tanzaku in the top-right corner ───────────────────── */
.bf-title{top:18px;right:16px;display:flex;flex-direction:row;align-items:flex-start;gap:6px;}
.bf-title>span{writing-mode:vertical-rl;font-family:var(--bf-ja-serif);font-weight:500;line-height:1;}
.bf-title .m{font-size:22px;letter-spacing:.4em;color:rgba(var(--bf-w),var(--bf-ja-a));}
.bf-title .s{font-size:12px;letter-spacing:.34em;margin-top:5px;color:rgba(var(--bf-w),var(--bf-sec-a));}

/* ── Irish signature + La Tène ornament, bottom-left ─────────────────────── */
.bf-irish{left:16px;bottom:16px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;}
.bf-irish .bf-ornament{display:block;color:rgb(var(--bf-g));opacity:.6;}
.bf-irish span{font-family:var(--bf-ga);font-weight:500;letter-spacing:.06em;line-height:1.1;}
.bf-irish .m{font-size:13px;color:rgba(var(--bf-w),var(--bf-ja-a));}
.bf-irish .s{font-size:11px;color:rgba(var(--bf-w),var(--bf-sec-a));}

/* ── one hint slot, bottom-centre ────────────────────────────────────────── */
.bf-hint{
  left:50%;transform:translateX(-50%);bottom:64px;
  width:max-content;max-width:min(560px,calc(100vw - 32px));
  text-align:center;line-height:1.5;max-height:39px;overflow:hidden;
}
/* ── toasts, upper third ─────────────────────────────────────────────────── */
.bf-toast{
  left:50%;transform:translateX(-50%);top:13vh;
  width:max-content;max-width:calc(100vw - 144px);
  text-align:center;line-height:1.5;max-height:39px;overflow:hidden;
}
.bf-hint .ja,.bf-toast .ja{font-family:var(--bf-ja-sans);font-weight:300;font-size:13px;letter-spacing:.05em;color:rgba(var(--bf-w),var(--bf-ja-a));}
.bf-hint .sep,.bf-toast .sep{font-family:var(--bf-ga);font-size:13px;margin:0 .55em;color:rgba(var(--bf-w),.62);}
.bf-hint .ga,.bf-toast .ga{font-family:var(--bf-ga);font-weight:500;font-size:12px;letter-spacing:.06em;color:rgb(var(--bf-g));}
/* Ogham is a display glyph — thin strokes crossing a stem — and collapses into a smear at the
   Irish size, which would make the reward for finding the typing secret unreadable. §9.1 sizes
   *Irish words* under the Japanese beside them; ogham has its own row there and no size rule, so
   t-word's glyphs are set at the stemline's size instead, where they are the subject. */
.bf-toast .og{font-family:var(--bf-og);font-size:18px;letter-spacing:.04em;white-space:nowrap;color:rgb(var(--bf-g));}

/* ── ogham stemline + harp ringing meter, left edge ──────────────────────── */
.bf-stemline{left:16px;bottom:120px;height:22vh;width:32px;}
.bf-stem{position:absolute;left:10px;top:0;width:1px;height:100%;background:rgb(var(--bf-g));opacity:0;}
.bf-og-word{
  position:absolute;left:0;bottom:0;
  writing-mode:vertical-lr;transform:rotate(180deg);
  font-family:var(--bf-og);font-size:18px;line-height:1;letter-spacing:.02em;
  color:rgba(var(--bf-g),.92);
}
.bf-notches{position:absolute;left:20px;top:0;height:100%;width:9px;}
.bf-notch{position:absolute;left:0;width:8px;height:1px;background:rgb(var(--bf-g));opacity:0;}
/* The two feather marks cap the bare stem so it reads as an ogham stemline and not as a rule
   (or a scrollbar). They share the word's writing mode, so their built-in stem lands on .bf-stem;
   they are hidden the moment a word arrives, because that word brings its own pair. */
.bf-feather{
  position:absolute;left:0;
  writing-mode:vertical-lr;transform:rotate(180deg);
  font-family:var(--bf-og);font-size:18px;line-height:1;
  color:rgba(var(--bf-g),.62);opacity:0;
}
.bf-f-top{top:0;}
.bf-f-bot{bottom:0;}
.bf-stemline.bf-bare .bf-feather{opacity:1;}

/* ── sound button, top-left, the only interactive element ────────────────── */
.bf-sound{
  position:absolute;top:16px;left:16px;width:44px;height:44px;
  pointer-events:auto;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  opacity:0;text-shadow:0 0 14px rgba(8,13,12,.85);
  -webkit-tap-highlight-color:transparent;
  font:inherit;color:inherit;appearance:none;-webkit-appearance:none;
}
.bf-sound:focus{outline:none;}
.bf-sound:focus-visible{outline:1px solid rgba(var(--bf-g),.75);outline-offset:3px;}
.bf-strokes{display:flex;align-items:flex-end;gap:5px;height:11px;}
.bf-stroke{
  width:1px;height:11px;background:rgb(var(--bf-g));
  transform-origin:50% 100%;transform:scaleY(.62);opacity:.45;
  transition:transform .34s cubic-bezier(.2,.7,.3,1),opacity .34s ease-out;
}
.bf-stroke.on{transform:scaleY(1);opacity:1;transition-duration:.07s;}
.bf-sound[aria-pressed="false"] .bf-stroke{opacity:0;transform:scaleY(.62);}
.bf-sound[aria-pressed="false"] .bf-stroke:nth-child(2){opacity:.3;transform:scaleY(.72);}
.bf-sound .lab{font-family:var(--bf-ja-sans);font-weight:400;font-size:13px;line-height:1;color:rgba(var(--bf-w),var(--bf-ja-a));}
.bf-sound .ga{font-family:var(--bf-ga);font-weight:500;font-size:9px;line-height:1;letter-spacing:.09em;color:rgb(var(--bf-g));}

/* ── ending + epilogue, centred ──────────────────────────────────────────── */
.bf-ending{
  left:50%;transform:translateX(-50%);top:30vh;
  width:max-content;max-width:min(680px,calc(100vw - 48px));text-align:center;
}
.bf-ending .ja{display:block;font-family:var(--bf-ja-serif);font-weight:500;font-size:22px;letter-spacing:.2em;line-height:1.4;color:rgba(var(--bf-w),var(--bf-ja-a));}
.bf-ending .ga{display:block;margin-top:9px;font-family:var(--bf-ga);font-weight:500;font-size:14px;letter-spacing:.08em;color:rgb(var(--bf-g));}
/* The epilogue arrives at T = 54, when the camera is still at (or near) the climax pose. The
   band of frame it used to occupy — just under the ending, at 30vh + 76 — is exactly where the
   mound's white quartz facade sits, the brightest non-sky surface in the shot, and §11.2 rules
   out a scrim behind the text. It is therefore anchored low instead, in the peat-dark meadow
   south of the loch rim, clear of the hint line and of the Irish signature. Measured under the
   text box in the live afterglow at T = 56.7 (camera still at the climax pose): background mean
   luma 25.4, max 92.4 at 1280×800 and mean 15.0, max 22.2 at 400×800, against ≈171 for the text
   itself — a margin of 79 and 149 over the brightest background pixel in the box. */
/* At 400 px the 41-character epilogue breaks 20 / 20 / 1 and leaves 「に。」 alone on the last
   line; text-wrap: balance evens the three lines instead (measured 13 / 14 / 14). The wide box is one
   character wider than the first sentence, so there the plain wrap already breaks at 「とも呼
   ぶ。」 and balancing would only move the break into the middle of a sentence — hence the plain
   wrap in the wide block below. At 844 × 390 the two settings measure identical. */
.bf-epilogue{
  left:50%;transform:translateX(-50%);bottom:max(96px,15vh);
  width:min(300px,calc(100vw - 112px));text-align:center;text-wrap:balance;
  font-family:var(--bf-ja-sans);font-weight:300;font-size:14px;line-height:1.95;
  color:rgba(var(--bf-w),var(--bf-ja-a));
}

/* ── wide layout (§9.2) ──────────────────────────────────────────────────── */
@media (min-width:720px) and (min-height:500px){
  .bf-title{top:28px;right:max(20px,calc(env(safe-area-inset-right,0px) + 16px));gap:10px;}
  .bf-title .m{font-size:30px;}
  .bf-title .s{font-size:14px;margin-top:6px;}
  .bf-irish{
    left:max(24px,calc(env(safe-area-inset-left,0px) + 24px));
    bottom:max(24px,calc(env(safe-area-inset-bottom,0px) + 24px));
    gap:4px;
  }
  .bf-irish .m{font-size:16px;}
  .bf-irish .s{font-size:12px;}
  .bf-hint{bottom:calc(28px + env(safe-area-inset-bottom,0px));max-height:45px;}
  .bf-toast{top:16vh;max-width:min(640px,calc(100vw - 200px));max-height:45px;}
  .bf-hint .ja,.bf-toast .ja{font-size:15px;}
  .bf-hint .sep,.bf-toast .sep{font-size:15px;}
  .bf-hint .ga,.bf-toast .ga{font-size:14px;}
  .bf-toast .og{font-size:22px;}
  .bf-stemline{left:28px;bottom:110px;height:34vh;width:38px;}
  .bf-stem{left:12px;}
  .bf-og-word,.bf-feather{font-size:22px;}
  .bf-notches{left:24px;width:10px;}
  .bf-notch{width:9px;}
  .bf-ending .ja{font-size:28px;}
  .bf-ending .ga{font-size:16px;margin-top:11px;}
  .bf-epilogue{bottom:max(104px,15vh);width:min(360px,calc(100vw - 48px));text-wrap:wrap;}
}

/* ── §9.5 reduced motion: opacity only, no beat pulses ───────────────────── */
.bf-root.bf-rm .bf-stroke{transition:opacity .6s linear;transform:scaleY(.72);}
.bf-root.bf-rm .bf-stroke.on{transform:scaleY(.72);transition-duration:.6s;}

/* ── acceptance helper (§10.9 #2): show everything at once ───────────────── */
.bf-root.bf-debug-all .bf-el,.bf-root.bf-debug-all .bf-sound{opacity:1 !important;}
.bf-root.bf-debug-all .bf-notch{opacity:.9 !important;}
.bf-root.bf-debug-all .bf-stem{opacity:.4 !important;}
`;
