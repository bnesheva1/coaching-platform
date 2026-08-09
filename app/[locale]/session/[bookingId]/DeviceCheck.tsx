"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Headphones, Mic, MicOff, ShieldCheck, TriangleAlert, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import styles from "./session.module.css";

// What the user chose to join with. VideoStage turns this into LiveKitRoom's
// audio/video props. A device-less join (both false) is the deliberate floor
// — someone who can't fix permissions still gets to see and hear the other
// person rather than lose a paid session.
export type JoinChoice = {
  micOn: boolean;
  camOn: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
};

// "intro" is the priming step: we explain WHY before ever calling
// getUserMedia, and only fire the prompt on a deliberate tap. This is the
// prevention that matters on iOS Safari, where a denied prompt cannot be
// re-triggered programmatically — the user would have to change Safari's
// site settings and reload. "unsupported" is for in-app webviews that expose
// no getUserMedia at all.
type Phase = "intro" | "requesting" | "ready" | "blocked" | "nodevices" | "unsupported";

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
}

type StepsKey =
  | "iosSafari"
  | "iosChrome"
  | "iosFirefox"
  | "inApp"
  | "androidChrome"
  | "desktopChrome"
  | "firefox"
  | "safari"
  | "generic";

type DeviceEnv = {
  // Which re-enable instructions to show. Never a behavioural gate — only
  // picks a string.
  stepsKey: StepsKey;
  isIOS: boolean;
  // An embedded webview (Instagram / Facebook / TikTok / etc.). These often
  // can't reach camera/mic and have no site-settings UI, so the only real
  // fix is "open in Safari".
  inApp: boolean;
  // getUserMedia actually exists in this context. False in some in-app
  // webviews and any non-secure context.
  supported: boolean;
};

const GENERIC_ENV: DeviceEnv = { stepsKey: "generic", isIOS: false, inApp: false, supported: true };

// Coarse UA sniff purely to show the RIGHT re-enable steps and detect
// webviews — never a behavioural gate. Runs on the client only (guarded by
// the `mounted` flag) so SSR and first client render agree.
function detectEnv(): DeviceEnv {
  if (typeof navigator === "undefined") return GENERIC_ENV;
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // In-app webview markers. `; wv)` is the Android WebView tag; the rest are
  // the common social apps whose in-app browser clients arrive from a link.
  const inApp =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Twitter|Snapchat|Pinterest|musical_ly|Bytedance|TikTok|; wv\)|GSA\//.test(
      ua,
    );
  const supported = typeof navigator.mediaDevices?.getUserMedia === "function";

  let stepsKey: StepsKey = "generic";
  if (inApp) {
    stepsKey = "inApp";
  } else if (isIOS) {
    // Every iOS browser is WebKit, but the re-enable path differs. Only
    // Safari has the "AA" site-settings menu; Chrome/Firefox on iOS don't,
    // so we steer them to Safari where our steps are known-correct.
    if (/CriOS/.test(ua)) stepsKey = "iosChrome";
    else if (/FxiOS/.test(ua)) stepsKey = "iosFirefox";
    else stepsKey = "iosSafari";
  } else if (/Android/.test(ua) && /Chrome/.test(ua)) {
    stepsKey = "androidChrome";
  } else if (/Firefox/.test(ua)) {
    stepsKey = "firefox";
  } else if (/Edg|Chrome/.test(ua)) {
    stepsKey = "desktopChrome";
  } else if (/Safari/.test(ua)) {
    stepsKey = "safari";
  }
  return { stepsKey, isIOS, inApp, supported };
}

export function DeviceCheck({
  onJoin,
  trouble,
  errorMessage,
}: {
  onJoin: (choice: JoinChoice) => void;
  // Null for practitioners (the reveal is client-only), so rendering it
  // unconditionally below is safe.
  trouble: React.ReactNode;
  // A join attempt that failed for a non-window reason (rate limit /
  // transient) — shown so the user knows to retry, without leaving the
  // device check.
  errorMessage?: string | null;
}) {
  const t = useTranslations("Session");
  // Start on the intro: nothing touches the camera until the user taps
  // "Enable" (a real user gesture). This is the whole prevention strategy.
  const [phase, setPhase] = useState<Phase>("intro");
  const [audioOnly, setAudioOnly] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>();
  const [videoDeviceId, setVideoDeviceId] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  // UA-derived detail (steps text, in-app/unsupported) must not diverge
  // between SSR and first client paint, so it stays generic until mounted.
  const [mounted, setMounted] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) * (v - 128);
        const rms = Math.sqrt(sum / data.length) / 128;
        setLevel(Math.min(1, rms * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* metering is a nice-to-have; never block joining on it */
    }
  }, []);

  const onGotStream = useCallback(
    (stream: MediaStream, isAudioOnly: boolean) => {
      streamRef.current = stream;
      setAudioOnly(isAudioOnly);
      setCamOn(!isAudioOnly);
      if (videoRef.current) videoRef.current.srcObject = stream;
      startMeter(stream);
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setAudioInputs(devices.filter((d) => d.kind === "audioinput"));
          setVideoInputs(devices.filter((d) => d.kind === "videoinput"));
        })
        .catch(() => {});
      setPhase("ready");
    },
    [startMeter],
  );

  const acquire = useCallback(
    async (opts?: { videoId?: string; audioId?: string }) => {
      // Some in-app webviews expose no getUserMedia — calling it throws a
      // bare TypeError that looks like a permission block. Detect and route
      // to the "open in Safari" screen instead of mislabelling it.
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setPhase("unsupported");
        return;
      }
      stopStream();
      setPhase("requesting");
      const videoConstraint = opts?.videoId ? { deviceId: { exact: opts.videoId } } : true;
      const audioConstraint = opts?.audioId ? { deviceId: { exact: opts.audioId } } : true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint });
        onGotStream(stream, false);
      } catch (e) {
        // Camera denied or absent — fall back to audio-only before giving
        // up, so a client who can't share video can still join and talk.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint });
          onGotStream(stream, true);
        } catch (e2) {
          // Only NotFound on BOTH attempts means "no hardware"; every other
          // failure (denied, busy, transient) shows the blocked screen,
          // which now leads with the join-anyway escape hatch.
          setPhase(isNotFound(e) && isNotFound(e2) ? "nodevices" : "blocked");
        }
      }
    },
    [onGotStream, stopStream],
  );

  // Mark mounted so UA-derived rendering (steps text, in-app warnings) is
  // client-only. No camera access happens here — that waits for a tap.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    return stopStream;
  }, [stopStream]);

  // Keep the preview element bound if it mounts after the stream arrives.
  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [phase, camOn]);

  const env = mounted ? detectEnv() : GENERIC_ENV;
  const joinDeviceless = () => onJoin({ micOn: false, camOn: false });

  if (phase === "intro") {
    // Explain first; prompt only on the deliberate tap below. If the webview
    // can't do getUserMedia at all, don't offer a button that would fail —
    // send them straight to the open-in-Safari guidance.
    const canPrompt = env.supported;
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <Video size={32} aria-hidden />
          <h1 className={styles.title}>{t("deviceIntroTitle")}</h1>
          <p className={styles.subtle}>{t("deviceIntroBody")}</p>
          <p className={styles.privacyNote}>
            <ShieldCheck size={16} aria-hidden /> {t("deviceIntroPrivacy")}
          </p>

          {mounted && env.inApp && (
            <div className={styles.calloutBox}>
              <p className={styles.calloutLead}>
                <ExternalLink size={16} aria-hidden /> {t("openInBrowserLead")}
              </p>
              <div className={styles.instructions}>
                {t(`deviceBlockedSteps.${env.stepsKey}` as Parameters<typeof t>[0])
                  .split("\n")
                  .map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            {canPrompt && (
              <Button variant="primary" fullWidth onClick={() => acquire()}>
                {t("enableDevices")}
              </Button>
            )}
            <Button variant={canPrompt ? "ghost" : "primary"} fullWidth onClick={joinDeviceless}>
              {t("joinWithoutDevices")}
            </Button>
            <p className={styles.escapeHint}>{t("joinWithoutDevicesHint")}</p>
          </div>
          {trouble}
        </div>
      </div>
    );
  }

  if (phase === "requesting") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <Video size={32} aria-hidden />
          <h1 className={styles.title}>{t("deviceCheckRequestingTitle")}</h1>
          <p className={styles.subtle}>{t("deviceCheckRequestingBody")}</p>
          {trouble}
        </div>
      </div>
    );
  }

  if (phase === "unsupported") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <ExternalLink size={32} aria-hidden />
          <h1 className={styles.title}>{t("deviceUnsupportedTitle")}</h1>
          <p className={styles.subtle}>{t("deviceUnsupportedBody")}</p>
          <div className={styles.instructions}>
            {t(`deviceBlockedSteps.${env.inApp ? "inApp" : env.stepsKey}` as Parameters<typeof t>[0])
              .split("\n")
              .map((line, i) => (
                <span key={i}>{line}</span>
              ))}
          </div>
          <div className={styles.actions}>
            <Button variant="primary" fullWidth onClick={joinDeviceless}>
              {t("joinWithoutDevices")}
            </Button>
            <p className={styles.escapeHint}>{t("joinWithoutDevicesHint")}</p>
          </div>
          {trouble}
        </div>
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <TriangleAlert size={32} aria-hidden />
          <h1 className={styles.title}>{t("deviceBlockedTitle")}</h1>

          {/* Escape hatch FIRST and prominent: a denied user still has a paid
              session to attend, and can join to see/hear the other person. */}
          <div className={styles.escapeBox}>
            <p className={styles.escapeLead}>{t("deviceBlockedEscapeLead")}</p>
            <Button variant="primary" fullWidth onClick={joinDeviceless}>
              {t("joinWithoutDevices")}
            </Button>
            <p className={styles.escapeHint}>{t("joinWithoutDevicesHint")}</p>
          </div>

          {/* Recovery is secondary: browser- and version-aware steps, then a
              reload (iOS needs a reload after changing site settings). */}
          <p className={styles.stepsLead}>{t("deviceBlockedFixLead")}</p>
          <div className={styles.instructions}>
            {t(`deviceBlockedSteps.${env.stepsKey}` as Parameters<typeof t>[0])
              .split("\n")
              .map((line, i) => (
                <span key={i}>{line}</span>
              ))}
          </div>
          <div className={styles.actions}>
            {env.isIOS ? (
              // iOS can't re-prompt in place; a reload after the settings
              // change is the only path back to the intro's Enable button.
              <Button variant="secondary" fullWidth onClick={() => window.location.reload()}>
                {t("reloadPage")}
              </Button>
            ) : (
              <Button variant="secondary" fullWidth onClick={() => acquire()}>
                {t("deviceTryAgain")}
              </Button>
            )}
          </div>
          {trouble}
        </div>
      </div>
    );
  }

  if (phase === "nodevices") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <Headphones size={32} aria-hidden />
          <h1 className={styles.title}>{t("noDevicesTitle")}</h1>
          <p className={styles.subtle}>{t("noDevicesBody")}</p>
          <div className={styles.actions}>
            <Button variant="primary" fullWidth onClick={joinDeviceless}>
              {t("joinWithoutDevices")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => acquire()}>
              {t("deviceTryAgain")}
            </Button>
          </div>
          {trouble}
        </div>
      </div>
    );
  }

  // phase === "ready"
  return (
    <div className={styles.center}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{t("deviceReadyTitle")}</h1>

        <div className={styles.preview}>
          {audioOnly || !camOn ? (
            <span className={styles.previewPlaceholder}>{audioOnly ? t("cameraUnavailableNote") : t("cameraOffNote")}</span>
          ) : (
            <video ref={videoRef} className={styles.previewVideo} autoPlay playsInline muted />
          )}
        </div>

        {/* Live mic level — the reassurance that "your microphone works"
            before committing to join. */}
        <div className={styles.meter} aria-label={t("micLevelLabel")}>
          <div className={styles.meterFill} style={{ transform: `scaleX(${micOn ? level : 0})` }} />
        </div>

        <div className={styles.toggleRow}>
          <button
            type="button"
            className={`${styles.toggle} ${micOn ? "" : styles.toggleOff}`}
            aria-pressed={micOn}
            onClick={() => setMicOn((v) => !v)}
          >
            {micOn ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />} {t("micLabel")}
          </button>
          <button
            type="button"
            className={`${styles.toggle} ${camOn ? "" : styles.toggleOff}`}
            aria-pressed={camOn}
            disabled={audioOnly}
            onClick={() => setCamOn((v) => !v)}
          >
            {camOn ? <Video size={18} aria-hidden /> : <VideoOff size={18} aria-hidden />} {t("cameraLabel")}
          </button>
        </div>

        {videoInputs.length > 1 && camOn && !audioOnly && (
          <label className={styles.deviceRow}>
            <span className={styles.deviceLabel}>{t("cameraDeviceLabel")}</span>
            <select
              className={styles.select}
              value={videoDeviceId ?? ""}
              onChange={(e) => {
                const id = e.target.value || undefined;
                setVideoDeviceId(id);
                acquire({ videoId: id, audioId: audioDeviceId });
              }}
            >
              {videoInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t("cameraLabel")}
                </option>
              ))}
            </select>
          </label>
        )}

        {audioInputs.length > 1 && (
          <label className={styles.deviceRow}>
            <span className={styles.deviceLabel}>{t("micDeviceLabel")}</span>
            <select
              className={styles.select}
              value={audioDeviceId ?? ""}
              onChange={(e) => {
                const id = e.target.value || undefined;
                setAudioDeviceId(id);
                acquire({ videoId: videoDeviceId, audioId: id });
              }}
            >
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t("micLabel")}
                </option>
              ))}
            </select>
          </label>
        )}

        {errorMessage && (
          <p className={styles.subtle} role="alert" style={{ color: "#c0392b" }}>
            {errorMessage}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            variant="primary"
            fullWidth
            onClick={() => {
              stopStream(); // release the preview devices before the room re-acquires them
              onJoin({ micOn, camOn: camOn && !audioOnly, audioDeviceId, videoDeviceId });
            }}
          >
            {t("joinSession")}
          </Button>
        </div>
        {trouble}
      </div>
    </div>
  );
}
