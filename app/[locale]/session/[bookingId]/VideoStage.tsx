"use client";

import "@livekit/components-styles";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, MicOff, PhoneOff, User, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  useTracks,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track, ConnectionState, DisconnectReason } from "livekit-client";
import { Countdown } from "@/components/time/Countdown";
import type { JoinChoice } from "./DeviceCheck";
import styles from "./session.module.css";

// The in-call layout: remote participant full-bleed, local self-view as a
// small PiP (per the approved mobile-first design — you look at the other
// person, not yourself). Controls pinned to the bottom.
export function VideoStage({
  token,
  url,
  choice,
  endsAt,
  onLeave,
  onDropped,
  onEnded,
  trouble,
}: {
  token: string;
  url: string;
  choice: JoinChoice;
  endsAt: string | null;
  onLeave: () => void;
  onDropped: () => void;
  onEnded: () => void;
  trouble: React.ReactNode;
}) {
  // Distinguishes an intentional "leave" (navigate away) from a network
  // drop (show the Reconnect screen) and from the hard-stop at end_utc,
  // inside onDisconnected.
  const leavingRef = useRef(false);
  const endingRef = useRef(false);

  const audio = choice.micOn ? (choice.audioDeviceId ? { deviceId: choice.audioDeviceId } : true) : false;
  const video = choice.camOn ? (choice.videoDeviceId ? { deviceId: choice.videoDeviceId } : true) : false;

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={audio}
      video={video}
      className={styles.roomContainer}
      onDisconnected={(reason) => {
        if (endingRef.current) onEnded();
        else if (leavingRef.current || reason === DisconnectReason.CLIENT_INITIATED) onLeave();
        else onDropped();
      }}
      onError={(err) => console.error("LiveKitRoom error", err)}
    >
      <RoomAudioRenderer />
      <RoomInner leavingRef={leavingRef} endingRef={endingRef} endsAt={endsAt} trouble={trouble} />
    </LiveKitRoom>
  );
}

function RoomInner({
  leavingRef,
  endingRef,
  endsAt,
  trouble,
}: {
  leavingRef: React.MutableRefObject<boolean>;
  endingRef: React.MutableRefObject<boolean>;
  endsAt: string | null;
  trouble: React.ReactNode;
}) {
  const t = useTranslations("Session");
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  // Hard-stop: each client counts down to end_utc and force-disconnects
  // itself at the end — no grace. When both do, the room empties and is
  // reaped; the webhook then resolves the outcome. endingRef flags this as
  // an intentional end (not a drop) for onDisconnected above.
  const endMs = endsAt ? new Date(endsAt).getTime() : null;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (endMs === null || nowMs === null || nowMs < endMs) return;
    endingRef.current = true;
    room.disconnect();
  }, [nowMs, endMs, room, endingRef]);

  const msLeft = endMs !== null && nowMs !== null ? endMs - nowMs : null;
  const showCountdown = msLeft !== null && msLeft > 0 && msLeft <= 5 * 60_000;

  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const remote = cameraTracks.find((tr) => !tr.participant.isLocal);
  const local = cameraTracks.find((tr) => tr.participant.isLocal);

  const reconnecting =
    connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting;
  const connecting = connectionState === ConnectionState.Connecting;

  return (
    <div className={styles.roomContainer}>
      <div className={styles.stage}>
        {remote ? (
          <ParticipantTile trackRef={remote} className={styles.remoteTile} />
        ) : (
          <div className={styles.waiting}>
            {connecting ? (
              <LoaderCircle className={styles.spin} size={32} aria-hidden />
            ) : (
              <User size={32} aria-hidden />
            )}
            <p>{connecting ? t("connecting") : t("waitingForOther")}</p>
          </div>
        )}

        {local && (
          <div className={styles.selfView}>
            <ParticipantTile trackRef={local} />
          </div>
        )}

        {reconnecting && <div className={styles.toast}>{t("reconnecting")}</div>}
        {showCountdown && endMs !== null && nowMs !== null && (
          // No role="status" on the banner: the inner Countdown is a
          // role="timer" (aria-live off), so it won't be re-announced every
          // second. The banner is read on navigation when it appears.
          <div className={styles.endingBanner}>
            {t("endingInPrefix")} <Countdown targetMs={endMs} mode="clock" nowMs={nowMs} />
          </div>
        )}
        {trouble}
      </div>

      <div className={styles.controlBar}>
        <button
          type="button"
          aria-pressed={isMicrophoneEnabled}
          aria-label={t("micLabel")}
          className={`${styles.controlButton} ${isMicrophoneEnabled ? "" : styles.controlButtonOff}`}
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        >
          {isMicrophoneEnabled ? <Mic size={24} aria-hidden /> : <MicOff size={24} aria-hidden />}
        </button>
        <button
          type="button"
          aria-pressed={isCameraEnabled}
          aria-label={t("cameraLabel")}
          className={`${styles.controlButton} ${isCameraEnabled ? "" : styles.controlButtonOff}`}
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        >
          {isCameraEnabled ? <Video size={24} aria-hidden /> : <VideoOff size={24} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label={t("leave")}
          className={styles.leaveButton}
          onClick={() => {
            leavingRef.current = true;
            room.disconnect();
          }}
        >
          <PhoneOff size={24} aria-hidden />
        </button>
      </div>
    </div>
  );
}
