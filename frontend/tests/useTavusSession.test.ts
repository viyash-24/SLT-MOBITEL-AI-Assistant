import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTavusSession } from "../app/hooks/useTavusSession";

const daily = vi.hoisted(() => ({ createCallObject: vi.fn() }));
vi.mock("@daily-co/daily-js", () => ({ default: daily }));

class FakeMediaStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const conversation = {
  conversation_id: "conversation-test",
  conversation_url: "https://test.daily.co/avatar",
  meeting_token: "test-meeting-token",
};
type Participant = {
  local: boolean;
  session_id: string;
  audio: boolean;
  tracks: Record<string, { state: string; persistentTrack?: MediaStreamTrack }>;
};

function makeCall() {
  const handlers = new Map<string, Set<(event?: unknown) => void>>();
  const participants: Record<string, Participant> = {
    local: { local: true, session_id: "customer", audio: true, tracks: {} },
  };
  const call = {
    on: vi.fn((name: string, callback: (event?: unknown) => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(callback);
      return call;
    }),
    off: vi.fn((name: string, callback: (event?: unknown) => void) => {
      handlers.get(name)?.delete(callback);
      return call;
    }),
    join: vi.fn(async () => participants),
    leave: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    participants: vi.fn(() => participants),
    setLocalAudio: vi.fn((enabled: boolean) => {
      participants.local.audio = enabled;
      return call;
    }),
    meetingState: vi.fn(() => "joined-meeting"),
    emit(name: string, event?: unknown) { handlers.get(name)?.forEach((callback) => callback(event)); },
    remote(audio = true, video = true) {
      const track = (kind: string) => ({ kind, id: `avatar-${kind}`, readyState: "live" }) as MediaStreamTrack;
      participants.avatar = {
        local: false, session_id: "avatar", audio,
        tracks: {
          audio: { state: audio ? "playable" : "loading", persistentTrack: audio ? track("audio") : undefined },
          video: { state: video ? "playable" : "loading", persistentTrack: video ? track("video") : undefined },
        },
      };
      call.emit("participant-updated", { participant: participants.avatar });
      return participants.avatar;
    },
  };
  return call;
}

let call: ReturnType<typeof makeCall>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  call = makeCall();
  daily.createCallObject.mockReset().mockReturnValue(call);
  fetchMock = vi.fn(async (input: string) => {
    if (input.endsWith("/status")) return response({ configured: true, has_pal: true });
    if (input.endsWith("/end")) return response({ status: "ended" });
    return response(conversation);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.unstubAllGlobals();
});

const requestsFor = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));

describe("one Tavus voice session", () => {
  it("starts only on demand and deduplicates rapid starts", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useTavusSession());
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      const first = result.current.startTavusSession();
      const second = result.current.startTavusSession();
      pending.resolve(response({ configured: true, has_pal: true }));
      await Promise.all([first, second]);
    });
    expect(requestsFor("/conversation")).toHaveLength(1);
    expect(daily.createCallObject).toHaveBeenCalledTimes(1);
    expect(call.join).toHaveBeenCalledWith(expect.objectContaining({
      url: conversation.conversation_url, token: conversation.meeting_token,
      startVideoOff: true, startAudioOff: false,
    }));
  });

  it("waits for remote audio AND video and exposes them through one media stream", async () => {
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    expect(result.current.tavusState).toBe("connecting");
    act(() => { call.remote(false, true); });
    expect(result.current.tavusState).toBe("connecting");
    act(() => { call.remote(true, true); });
    expect(result.current.tavusState).toBe("active");
    expect(result.current.avatarStream?.getAudioTracks()).toHaveLength(1);
    expect(result.current.avatarStream?.getVideoTracks()).toHaveLength(1);
    expect(result.current.avatarStream?.getTracks().map((track) => track.id)).toEqual(expect.arrayContaining(["avatar-audio", "avatar-video"]));
  });

  it("mutes the actual microphone through Daily and confirms local state", async () => {
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    act(() => { call.remote(); });
    await act(async () => { await result.current.toggleMute(); });
    expect(call.setLocalAudio).toHaveBeenLastCalledWith(false);
    expect(result.current.isMuted).toBe(true);
    await act(async () => { await result.current.toggleMute(); });
    expect(call.setLocalAudio).toHaveBeenLastCalledWith(true);
    expect(result.current.isMuted).toBe(false);
  });

  it("never exposes audio without the avatar video, including during an interrupted track", async () => {
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    act(() => { call.remote(true, false); });
    expect(result.current.tavusState).toBe("connecting");
    expect(result.current.avatarStream).toBeNull();

    act(() => { call.remote(true, true); });
    expect(result.current.tavusState).toBe("active");
    expect(result.current.avatarStream?.getTracks()).toHaveLength(2);

    act(() => { call.remote(true, false); });
    expect(result.current.tavusState).toBe("connecting");
    expect(result.current.avatarStream).toBeNull();

    act(() => { call.remote(true, true); });
    expect(result.current.tavusState).toBe("active");
    expect(result.current.avatarStream?.getTracks()).toHaveLength(2);
  });

  it("requires failed session cleanup to succeed before creating another conversation", async () => {
    let endAttempts = 0;
    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith("/status")) return response({ configured: true, has_pal: true });
      if (input.endsWith("/end")) {
        endAttempts += 1;
        return endAttempts < 3
          ? response({ detail: "Could not reach Tavus to end the session." }, 502)
          : response({ status: "ended" });
      }
      return response(conversation);
    });
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    await act(async () => { await result.current.endTavusSession(); });
    expect(result.current.tavusState).toBe("error");
    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(result.current.avatarStream).toBeNull();

    // A retry still cannot start another assistant if cleanup fails again.
    await act(async () => { await result.current.startTavusSession(); });
    expect(result.current.tavusState).toBe("error");
    expect(requestsFor("/conversation")).toHaveLength(1);
    expect(daily.createCallObject).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.startTavusSession(); });
    expect(requestsFor("/conversation")).toHaveLength(2);
    expect(daily.createCallObject).toHaveBeenCalledTimes(2);
    expect(requestsFor("/end")).toHaveLength(3);
    expect(requestsFor("/end").map(([, init]) => JSON.parse(init.body))).toEqual([
      { conversation_id: conversation.conversation_id },
      { conversation_id: conversation.conversation_id },
      { conversation_id: conversation.conversation_id },
    ]);
    const order = fetchMock.mock.calls.map(([url]) => String(url).split("/").pop());
    expect(order).toEqual(["status", "conversation", "end", "end", "end", "status", "conversation"]);
  });

  it("ends the session when the selected avatar leaves instead of switching speakers", async () => {
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    let avatar!: Participant;
    act(() => { avatar = call.remote(); });
    expect(result.current.tavusState).toBe("active");
    call.participants().other = { ...avatar, session_id: "other" };

    await act(async () => {
      delete call.participants().avatar;
      call.emit("participant-left", { participant: avatar });
    });
    expect(result.current.tavusState).toBe("error");
    expect(result.current.avatarStream).toBeNull();
    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(requestsFor("/end")).toHaveLength(1);
  });

  it("releases media and ends the conversation even when Daily join is still pending", async () => {
    const joined = deferred<Record<string, Participant>>();
    call.join.mockImplementationOnce(() => joined.promise);
    const { result } = renderHook(() => useTavusSession());
    let start!: Promise<void>;
    act(() => { start = result.current.startTavusSession(); });
    await waitFor(() => expect(call.join).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.endTavusSession();
      await start;
    });
    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(requestsFor("/end")).toHaveLength(1);
    expect(result.current.tavusState).toBe("idle");
    // A late join result cannot resurrect the stopped assistant.
    await act(async () => { joined.resolve(call.participants()); });
    expect(result.current.tavusState).toBe("idle");
    expect(result.current.avatarStream).toBeNull();
  });

  it("ends a session returned after stop during creation without joining it", async () => {
    const created = deferred<Response>();
    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith("/status")) return response({ configured: true, has_pal: true });
      if (input.endsWith("/end")) return response({ status: "ended" });
      return created.promise;
    });
    const { result } = renderHook(() => useTavusSession());
    let start!: Promise<void>;
    act(() => { start = result.current.startTavusSession(); });
    await waitFor(() => expect(requestsFor("/conversation")).toHaveLength(1));
    await act(async () => {
      const stop = result.current.endTavusSession();
      created.resolve(response(conversation));
      await Promise.all([start, stop]);
    });
    expect(call.join).not.toHaveBeenCalled();
    expect(requestsFor("/end")).toHaveLength(1);
    expect(JSON.parse(requestsFor("/end")[0][1].body)).toEqual({ conversation_id: conversation.conversation_id });
    expect(result.current.tavusState).toBe("idle");
  });

  it("cleans up late creation when navigating away", async () => {
    const created = deferred<Response>();
    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith("/status")) return response({ configured: true, has_pal: true });
      if (input.endsWith("/end")) return response({ status: "ended" });
      return created.promise;
    });
    const { result, unmount } = renderHook(() => useTavusSession());
    let start!: Promise<void>;
    act(() => { start = result.current.startTavusSession(); });
    await waitFor(() => expect(requestsFor("/conversation")).toHaveLength(1));
    unmount();
    await act(async () => { created.resolve(response(conversation)); await start; });
    await waitFor(() => expect(requestsFor("/end")).toHaveLength(1));
    expect(call.join).not.toHaveBeenCalled();
  });

  it("destroys media and ends the server session when joining fails", async () => {
    call.join.mockRejectedValueOnce(new Error("Microphone permission denied"));
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    expect(result.current.tavusState).toBe("error");
    expect(result.current.tavusError).toMatch(/microphone permission denied/i);
    expect(result.current.avatarStream).toBeNull();
    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(requestsFor("/end")).toHaveLength(1);
  });

  it("preserves credit errors without starting a fallback assistant", async () => {
    fetchMock.mockImplementation(async (input: string) => input.endsWith("/status")
      ? response({ configured: true, has_pal: true })
      : response({ detail: "Tavus account is out of conversational credits." }, 402));
    const { result } = renderHook(() => useTavusSession());
    await act(async () => { await result.current.startTavusSession(); });
    expect(result.current.tavusState).toBe("error");
    expect(result.current.tavusError).toMatch(/out of conversational credits/);
    expect(daily.createCallObject).not.toHaveBeenCalled();
    expect(result.current.avatarStream).toBeNull();
  });
});
