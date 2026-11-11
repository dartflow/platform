/** Browser-only camera replacement. Audio and the peer connection stay untouched. */
export type CameraTarget = { deviceId?: string; facingMode?: "user" | "environment" };
type CameraDevice = Pick<MediaDeviceInfo, "deviceId" | "kind">;

export function nextCamera(settings: MediaTrackSettings, devices: CameraDevice[]): CameraTarget {
  const cameras = devices.filter(device => device.kind === "videoinput");
  if (cameras.length > 1) {
    const index = cameras.findIndex(camera => camera.deviceId === settings.deviceId);
    return { deviceId: cameras[(index + 1) % cameras.length].deviceId };
  }
  return { facingMode: settings.facingMode === "environment" ? "user" : "environment" };
}

export function cameraConstraints(target: CameraTarget, settings: MediaTrackSettings): MediaStreamConstraints {
  return { audio: false, video: {
    ...(target.deviceId ? { deviceId: { exact: target.deviceId } } : { facingMode: { exact: target.facingMode || "environment" } }),
    width: { ideal: settings.width || 1280 }, height: { ideal: settings.height || 720 },
    frameRate: { ideal: Math.min(settings.frameRate || 30, 30), max: 30 },
  } };
}

export class CameraRecoveryError extends Error {
  constructor(readonly restored: boolean, options: ErrorOptions) {
    super(restored ? "De andere camera kon niet worden geopend. Je vorige camera is hersteld." : "De camera kon niet worden heropend. Je geluid blijft beschikbaar. Probeer de camera opnieuw te wisselen.", options);
    this.name = "CameraRecoveryError";
  }
}

export async function cameraReady(media: MediaStream, signal?: AbortSignal): Promise<void> {
  const video = document.createElement("video");
  video.muted = true; video.autoplay = true; video.playsInline = true; video.srcObject = media;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); video.removeEventListener("loadeddata", ready); video.removeEventListener("error", failed); signal?.removeEventListener("abort", aborted); };
      const ready = () => { if (video.readyState >= 2 && video.videoWidth > 0) { done(); resolve(); } };
      const failed = () => { done(); reject(new Error("De nieuwe camera geeft geen beeld.")); };
      const aborted = () => { done(); reject(new DOMException("Camera operation cancelled", "AbortError")); };
      const timer = setTimeout(failed, 8000);
      video.addEventListener("loadeddata", ready); video.addEventListener("error", failed);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      void video.play().then(ready).catch(failed);
      ready();
    });
  } finally { video.pause(); video.srcObject = null; }
}

export async function replaceCamera({ localStream, connection, target, getUserMedia, isCurrent, waitUntilReady = cameraReady, releaseCurrent = false, signal }: {
  localStream: MediaStream;
  connection: RTCPeerConnection | null;
  target: CameraTarget;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  isCurrent: () => boolean;
  waitUntilReady?: (media: MediaStream, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Explicit user fallback for devices that cannot open two cameras simultaneously. */
  releaseCurrent?: boolean;
}): Promise<MediaStreamTrack> {
  const previous = localStream.getVideoTracks()[0];
  if (!previous) throw new Error("Er is nog geen camera actief. Test eerst je camera.");
  const settings = previous.getSettings(), enabled = previous.enabled;
  const sender = connection?.getSenders().find(item => item.track === previous || item.track?.kind === "video");
  if (connection && (!sender || connection.connectionState === "closed")) throw new Error("De beeldverbinding is niet beschikbaar. Verbind opnieuw.");
  const check = () => { if (!isCurrent() || signal?.aborted) throw new DOMException("Camera operation cancelled", "AbortError"); };
  async function install(destination: CameraTarget): Promise<MediaStreamTrack> {
    check();
    const candidate = await getUserMedia(cameraConstraints(destination, settings));
    const replacement = candidate.getVideoTracks()[0];
    const cancel = () => candidate.getTracks().forEach(track => track.stop());
    signal?.addEventListener("abort", cancel, { once: true });
    let accepted = false;
    try {
      check();
      if (!replacement || replacement.readyState !== "live") throw new Error("De andere camera geeft geen beeld.");
      replacement.enabled = enabled;
      await waitUntilReady(candidate, signal);
      check();
      if (sender) { await sender.replaceTrack(replacement); accepted = true; }
      check();
      localStream.removeTrack(previous); localStream.addTrack(replacement);
      previous.stop();
      return replacement;
    } catch (cause) {
      // A rejected replacement must never consume a working original track.
      if (accepted && isCurrent() && previous.readyState === "live") await sender?.replaceTrack(previous).catch(() => undefined);
      throw cause;
    } finally {
      signal?.removeEventListener("abort", cancel);
      candidate.getTracks().filter(track => track !== replacement || !localStream.getTracks().includes(track)).forEach(track => track.stop());
    }
  }
  check();
  if (releaseCurrent) previous.stop();
  try { return await install(target); }
  catch (cause) {
    if ((!releaseCurrent && previous.readyState !== "ended") || !isCurrent() || signal?.aborted) throw cause;
    const original: CameraTarget = settings.deviceId ? { deviceId: settings.deviceId } : { facingMode: settings.facingMode === "environment" ? "environment" : "user" };
    try { await install(original); }
    catch { throw new CameraRecoveryError(false, { cause }); }
    throw new CameraRecoveryError(true, { cause });
  }
}
