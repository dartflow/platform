package nl.dartflow.app

import org.json.JSONObject

internal fun playerCanMedia(match: PlayerMatch, actorId: String?): Boolean {
    if (match.raw.text("scoringMode") != "per-player" || actorId == null) return false
    if (match.permissions.has("canMedia")) return match.permissions.optBoolean("canMedia")
    return actorId in (match.raw.optJSONArray("remoteWriterIds")?.strings() ?: match.players.map { it.id })
}

/** Frames and transport state come from WebRTC callbacks, never a user readiness toggle. */
internal class PlayerMediaReadiness {
    @Volatile var connected = false
    @Volatile private var localFrameAt = 0L
    @Volatile private var remoteFrameAt = 0L
    fun localFrame(now: Long): Boolean { val stale = localFrameAt == 0L || now - localFrameAt > 7000; localFrameAt = now; return stale }
    fun remoteFrame(now: Long): Boolean { val stale = remoteFrameAt == 0L || now - remoteFrameAt > 7000; remoteFrameAt = now; return stale }
    fun localStopped() { localFrameAt = 0 }
    fun remoteStopped() { remoteFrameAt = 0 }
    fun reset() { connected = false; localFrameAt = 0; remoteFrameAt = 0 }
    fun payload(callId: String, now: Long, localEnabled: Boolean, remoteEnabled: Boolean): JSONObject {
        fun recent(at: Long) = at > 0 && now >= at && now - at <= 7000
        return json("purpose" to "media-ready", "callId" to callId, "video" to (localEnabled && recent(localFrameAt)), "connected" to connected, "peerVideo" to (remoteEnabled && recent(remoteFrameAt)))
    }
}
