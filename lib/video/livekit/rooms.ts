import { getRoomServiceClient } from "./client";
import type { CreateRoomInput, VideoRoomHandle } from "../types";

export async function createRoom(input: CreateRoomInput): Promise<VideoRoomHandle> {
  const room = await getRoomServiceClient().createRoom({
    name: input.bookingId, // server-set = booking id; never client-controlled
    emptyTimeout: input.emptyTimeoutSeconds,
    maxParticipants: input.maxParticipants,
  });
  return { providerRoomName: room.name, providerRoomSid: room.sid };
}

export async function closeRoom(bookingId: string): Promise<void> {
  // deleteRoom disconnects any remaining participants and destroys the
  // room. Swallow-and-log a failure: deleting an already-gone room (the
  // sweep racing the empty-timeout, or a double close) is expected and
  // must not throw into the caller.
  try {
    await getRoomServiceClient().deleteRoom(bookingId);
  } catch (err) {
    console.error("closeRoom: deleteRoom failed (room may already be closed)", { bookingId, err });
  }
}

// Names of rooms the provider currently considers live — used by the
// reconcile sweep to spot rooms that outlived their window.
export async function listOpenRoomNames(): Promise<string[]> {
  const rooms = await getRoomServiceClient().listRooms();
  return rooms.map((r) => r.name);
}
