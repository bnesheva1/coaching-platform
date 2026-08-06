"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type Phase = "requesting" | "ready" | "blocked" | "nodevices";

function isNotAllowed(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
}
function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
}

// Coarse UA sniff purely to show the RIGHT re-enable steps — never used for
// any behavioural gate, only which instruction string to render.
function detectBrowserKey(): string {
  if (typeof navigator === "undefined") return "generic";
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) return "iosSafari";
  if (/Android/.test(ua) && /Chrome/.test(ua)) return "androidChrome";
  if (/Firefox/.test(ua)) return "firefox";
  if (/Chrome/.test(ua)) return "desktopChrome";
  if (/Safari/.test(ua)) return "safari";
  return "generic";
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
  const [phase, setPhase] = useState<Phase>("requesting");
  const [audioOnly, setAudioOnly] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>();
  const [videoDeviceId, setVideoDeviceId] = useState<string | undefined>();
  const [level, setLevel] = useState(0);

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
          setPhase(isNotFound(e) && isNotFound(e2) ? "nodevices" : isNotAllowed(e) || isNotAllowed(e2) ? "blocked" : "blocked");
        }
      }
    },
    [onGotStream, stopStream],
  );

  useEffect(() => {
    // Requesting media on mount is exactly the "synchronize with an
    // external system" case effects are for; the synchronous phase set
    // inside acquire() is intentional (and redundant with the initial
    // state on first mount, meaningful on retries).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    acquire();
    return stopStream;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the preview element bound if it mounts after the stream arrives.
  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [phase, camOn]);

  const browserKey = detectBrowserKey();

  if (phase === "requesting") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <span className={styles.bigIcon} aria-hidden>🎥</span>
          <h1 className={styles.title}>{t("deviceCheckRequestingTitle")}</h1>
          <p className={styles.subtle}>{t("deviceCheckRequestingBody")}</p>
          {trouble}
        </div>
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className={styles.center}>
        <div className={styles.panel}>
          <span className={styles.bigIcon} aria-hidden>⚠️</span>
          <h1 className={styles.title}>{t("deviceBlockedTitle")}</h1>
          <p className={styles.subtle}>{t("deviceBlockedBody")}</p>
          <div className={styles.instructions}>
            {t(`deviceBlockedSteps.${browserKey}` as Parameters<typeof t>[0])
              .split("\n")
              .map((line, i) => (
                <span key={i}>{line}</span>
              ))}
          </div>
          <div className={styles.actions}>
            <Button variant="primary" fullWidth onClick={() => acquire()}>
              {t("deviceTryAgain")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => onJoin({ micOn: false, camOn: false })}>
              {t("joinWithoutDevices")}
            </Button>
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
          <span className={styles.bigIcon} aria-hidden>🎧</span>
          <h1 className={styles.title}>{t("noDevicesTitle")}</h1>
          <p className={styles.subtle}>{t("noDevicesBody")}</p>
          <div className={styles.actions}>
            <Button variant="primary" fullWidth onClick={() => acquire()}>
              {t("deviceTryAgain")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => onJoin({ micOn: false, camOn: false })}>
              {t("joinWithoutDevices")}
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
            <span aria-hidden>{micOn ? "🎤" : "🔇"}</span> {t("micLabel")}
          </button>
          <button
            type="button"
            className={`${styles.toggle} ${camOn ? "" : styles.toggleOff}`}
            aria-pressed={camOn}
            disabled={audioOnly}
            onClick={() => setCamOn((v) => !v)}
          >
            <span aria-hidden>{camOn ? "🎥" : "🚫"}</span> {t("cameraLabel")}
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
