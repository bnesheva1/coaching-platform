"use client";

import "@livekit/components-styles";
import { useRef } from "react";
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
import type { JoinChoice } from "./DeviceCheck";
import styles from "./session.module.css";

// The in-call layout: remote participant full-bleed, local self-view as a
// small PiP (per the approved mobile-first design — you look at the other
// person, not yourself). Controls pinned to the bottom.
export function VideoStage({
  token,
  url,
  choice,
  onLeave,
  onDropped,
  trouble,
}: {
  token: string;
  url: string;
  choice: JoinChoice;
  onLeave: () => void;
  onDropped: () => void;
  trouble: React.ReactNode;
}) {
  // Distinguishes an intentional "leave" (navigate away) from a network
  // drop (show the Reconnect screen) inside onDisconnected.
  const leavingRef = useRef(false);

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
        if (leavingRef.current || reason === DisconnectReason.CLIENT_INITIATED) onLeave();
        else onDropped();
      }}
      onError={(err) => console.error("LiveKitRoom error", err)}
    >
      <RoomAudioRenderer />
      <RoomInner leavingRef={leavingRef} trouble={trouble} />
    </LiveKitRoom>
  );
}

function RoomInner({
  leavingRef,
  trouble,
}: {
  leavingRef: React.MutableRefObject<boolean>;
  trouble: React.ReactNode;
}) {
  const t = useTranslations("Session");
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

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
            <span className={styles.bigIcon} aria-hidden>
              {connecting ? "⏳" : "👤"}
            </span>
            <p>{connecting ? t("connecting") : t("waitingForOther")}</p>
          </div>
        )}

        {local && (
          <div className={styles.selfView}>
            <ParticipantTile trackRef={local} />
          </div>
        )}

        {reconnecting && <div className={styles.toast}>{t("reconnecting")}</div>}
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
          <span aria-hidden>{isMicrophoneEnabled ? "🎤" : "🔇"}</span>
        </button>
        <button
          type="button"
          aria-pressed={isCameraEnabled}
          aria-label={t("cameraLabel")}
          className={`${styles.controlButton} ${isCameraEnabled ? "" : styles.controlButtonOff}`}
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        >
          <span aria-hidden>{isCameraEnabled ? "🎥" : "🚫"}</span>
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
          <span aria-hidden>📞</span>
        </button>
      </div>
    </div>
  );
}
