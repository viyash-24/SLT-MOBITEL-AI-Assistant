import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TavusAvatarView } from "../app/components/TavusAvatarView";

afterEach(cleanup);

describe("Tavus avatar playback", () => {
  it("plays synchronized audio/video through one inline media element and detaches on exit", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const stream = {} as MediaStream;
    const { container, unmount } = render(createElement(TavusAvatarView, { stream }));
    const video = screen.getByLabelText("SLT Avatar live video") as HTMLVideoElement;
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(false);
    expect(video.playsInline).toBe(true);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelectorAll("audio, iframe, canvas")).toHaveLength(0);
    unmount();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("offers a user gesture to enable the same stream if autoplay is blocked", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"))
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    render(createElement(TavusAvatarView, { stream: {} as MediaStream }));
    const enable = await screen.findByRole("button", { name: "Enable avatar audio and video" });
    fireEvent.click(enable);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enable avatar audio and video" })).toBeNull());
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("SLT Avatar live video")).toBeTruthy();
  });
});
