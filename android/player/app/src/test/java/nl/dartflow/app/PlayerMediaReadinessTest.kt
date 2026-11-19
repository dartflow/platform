package nl.dartflow.app

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class PlayerMediaReadinessTest {
    @Test fun cameraReadinessRequiresActualRecentFramesEnabledTracksAndConnectedTransport() {
        val state = PlayerMediaReadiness()
        assertFalse(state.payload("call", 1000, true, true).getBoolean("video"))
        assertFalse(state.payload("call", 1000, true, true).getBoolean("connected"))
        assertTrue(state.localFrame(1000)); assertTrue(state.remoteFrame(1000)); state.connected = true
        val live = state.payload("call", 2000, true, true)
        assertEquals("media-ready", live.getString("purpose")); assertEquals("call", live.getString("callId"))
        assertTrue(live.getBoolean("video")); assertTrue(live.getBoolean("connected")); assertTrue(live.getBoolean("peerVideo"))
        assertFalse(state.payload("call", 2000, false, true).getBoolean("video"))
        assertFalse(state.payload("call", 2000, true, false).getBoolean("peerVideo"))
        assertFalse(state.payload("call", 8001, true, true).getBoolean("video"))
        assertFalse(state.payload("call", 8001, true, true).getBoolean("peerVideo"))
        assertTrue(state.localFrame(8001)); assertFalse(state.localFrame(8002))
    }
    @Test fun stoppingOrResettingImmediatelyInvalidatesFrameEvidence() {
        val state = PlayerMediaReadiness(); state.localFrame(1000); state.remoteFrame(1000); state.connected = true
        state.localStopped(); assertFalse(state.payload("call", 1001, true, true).getBoolean("video"))
        assertTrue(state.payload("call", 1001, true, true).getBoolean("peerVideo"))
        state.remoteStopped(); assertFalse(state.payload("call", 1001, true, true).getBoolean("peerVideo"))
        state.localFrame(1001); state.remoteFrame(1001); state.reset()
        val reset = state.payload("new-call", 1002, true, true)
        for (key in listOf("video", "connected", "peerVideo")) assertFalse(reset.getBoolean(key))
    }
    @Test fun designatedMediaOperatorsUseCanonicalPermissionAndNeverAllTeamMembers() {
        val raw = json("id" to "match", "scoringMode" to "per-player", "players" to JSONArray(listOf(json("id" to "anchor"))), "remoteWriterIds" to JSONArray(listOf("writer", "other-writer")))
        assertTrue(playerCanMedia(PlayerMatch.parse(raw), "writer"))
        assertFalse(playerCanMedia(PlayerMatch.parse(raw), "anchor"))
        assertFalse(playerCanMedia(PlayerMatch.parse(raw), "partner"))
        raw.put("permissions", json("canMedia" to false))
        assertFalse(playerCanMedia(PlayerMatch.parse(raw), "writer"))
        raw.put("permissions", json("canMedia" to true))
        assertTrue(playerCanMedia(PlayerMatch.parse(raw), "writer"))
        assertFalse(playerCanMedia(PlayerMatch.parse(raw), null))
        raw.put("scoringMode", "single-writer")
        assertFalse(playerCanMedia(PlayerMatch.parse(raw), "writer"))
    }
}
