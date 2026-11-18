package nl.dartflow.app

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerScoreSnapshotsTest {
    private val id = "training-a"
    private fun input(revision: Int = 1) = JSONObject().put("expectedRevision", revision)
        .put("requestId", "same-request-on-retry").put("action", JSONObject().put("type", "training.score").put("id", id).put("score", 112))
    private fun entity(revision: Any = 2, remaining: Int = 389) = JSONObject().put("id", id).put("kind", "training")
        .put("revision", revision).put("canManage", true).put("name", "Dartbot")
        .put("state", JSONObject().put("mode", "bot").put("undoCount", 1)
            .put("game", JSONObject().put("turn", 0).put("status", "live")
                .put("remaining", JSONArray(listOf(remaining, 421))).put("visits", JSONArray(listOf(
                    JSONObject().put("playerIndex", 0).put("score", 112), JSONObject().put("playerIndex", 1).put("score", 80))))))
    private fun response(entity: JSONObject = entity()) = JSONObject().put("ok", true).put("id", id).put("entity", entity)
    private fun state() = PlayerUiState(screen = PlayerScreen.TRAINING, activeId = id, busy = true, hasPendingCommand = false,
        platform = JSONObject().put("trainings", JSONArray(listOf(entity(1, 501)))),
        resource = JSONObject().put("entity", entity(1, 501)))

    @Test fun authoritativeCompactAckUpdatesBothPlayersAndRevisionWithoutAnotherFetch() {
        val request = input()
        val original = request.toString()
        val accepted = requireNotNull(acceptedPlayerScoreSnapshot(state(), "/platform/actions", request, response()))
        val training = accepted.resource.getJSONObject("entity")
        assertEquals(2, training.getInt("revision"))
        assertEquals(listOf(389, 421), training.getJSONObject("state").getJSONObject("game").getJSONArray("remaining").ints())
        assertEquals(2, training.getJSONObject("state").getJSONObject("game").getJSONArray("visits").length())
        assertEquals(0, training.getJSONObject("state").getJSONObject("game").getInt("turn"))
        assertEquals(1, training.getJSONObject("state").getInt("undoCount"))
        assertFalse(training.getJSONObject("state").has("undo"))
        assertEquals(2, accepted.platform.getJSONArray("trainings").getJSONObject(0).getInt("revision"))
        assertEquals(original, request.toString()) // ACK handling cannot rewrite the persisted retry identity/body.
        assertFalse(accepted.hasPendingCommand)
        assertFalse(accepted.finishedTask(ownsBusy = true).busy)
    }

    @Test fun onlyAnAcceptedMatchingCompleteRevisionCanBypassRefresh() {
        val invalid = listOf(
            response().put("ok", false), response().put("id", "other-training"),
            response(entity().put("id", "other-training")), response(entity().put("kind", "lobby")),
            response(entity(1)), response(entity(-1)), response(entity(2.5)), response(entity("2")),
            response(entity(Int.MAX_VALUE.toLong() + 1)), response(entity().put("canManage", JSONObject.NULL)),
            response(entity().put("state", JSONObject.NULL)), response(entity().put("state", JSONObject())), JSONObject().put("ok", true),
        )
        invalid.forEach { ack -> assertNull(ack.toString(), acceptedPlayerScoreSnapshot(state(), "/platform/actions", input(), ack)) }
        assertNull(acceptedPlayerScoreSnapshot(state(), "/other", input(), response()))
        assertNull(acceptedPlayerScoreSnapshot(state(), "/platform/actions", input().put("expectedRevision", 1.5), response()))
    }

    @Test fun delayedPollAndExactRetryCannotUndoANewerAcceptedRevision() {
        val latest = requireNotNull(acceptedPlayerScoreSnapshot(state(), "/platform/actions", input(), response(entity(4, 201))))
        val retry = requireNotNull(acceptedPlayerScoreSnapshot(latest, "/platform/actions", input(), response(entity(2, 389))))
        val polled = applyPlayerTrainingSnapshot(retry, entity(3, 301))
        assertEquals(4, polled.resource.getJSONObject("entity").getInt("revision"))
        assertEquals(201, polled.resource.getJSONObject("entity").getJSONObject("state").getJSONObject("game").getJSONArray("remaining").getInt(0))
        assertEquals(1, polled.platform.getJSONArray("trainings").length())
    }

    @Test fun ackAfterNavigationUpdatesTheTrainingCacheWithoutReplacingTheOtherScreen() {
        val elsewhere = state().copy(screen = PlayerScreen.PROFILE, activeId = null, resource = JSONObject().put("profile-marker", true))
        val accepted = requireNotNull(acceptedPlayerScoreSnapshot(elsewhere, "/platform/actions", input(), response()))
        assertEquals(PlayerScreen.PROFILE, accepted.screen)
        assertTrue(accepted.resource.getBoolean("profile-marker"))
        assertTrue(accepted.loading)
        assertEquals(2, accepted.platform.getJSONArray("trainings").getJSONObject(0).getInt("revision"))
    }

    @Test fun stalledReadStartedBeforeOrDuringSubmitCannotOverwriteItsAck() = runTest {
        val gate = PlayerSnapshotGate()
        var current = state()
        val oldRead = gate.capture()
        gate.advance() // Command starts; older dashboard reads are now irrelevant.
        val readDuringSubmit = gate.capture()
        val release = CompletableDeferred<Unit>()
        val stale = async {
            release.await()
            if (gate.accepts(oldRead) || gate.accepts(readDuringSubmit)) current = applyPlayerTrainingSnapshot(current, entity(1, 501))
        }
        gate.advance() // The accepted response also invalidates reads started during its request.
        current = requireNotNull(acceptedPlayerScoreSnapshot(current, "/platform/actions", input(), response()))
        current = current.finishedTask(ownsBusy = true)
        assertFalse(current.busy) // No dependency on completing the suspended background read.
        assertEquals(2, current.resource.getJSONObject("entity").getInt("revision"))
        release.complete(Unit)
        stale.await()
        assertEquals(389, current.resource.getJSONObject("entity").getJSONObject("state").getJSONObject("game").getJSONArray("remaining").getInt(0))
        assertTrue(gate.accepts(gate.capture()))
    }

    @Test fun backgroundRefreshCompletionDoesNotUnlockTheCommand() {
        val submitting = state().copy(hasPendingCommand = true)
        val refreshed = submitting.finishedTask(ownsBusy = false)
        assertTrue(refreshed.busy)
        assertTrue(refreshed.hasPendingCommand)
        assertFalse(refreshed.finishedTask(ownsBusy = true).busy)
    }

    @Test fun aLateBackgroundFailureCannotMarkAnAcknowledgedScoreOfflineOrFinishTheNewScreenLoad() = runTest {
        val gate = PlayerSnapshotGate()
        var current = state()
        val ticket = gate.capture()
        val finishRefresh = CompletableDeferred<Unit>()
        val refresh = async {
            finishRefresh.await()
            if (gate.acceptsTaskFeedback(ticket, ownsBusy = false, originalIdentity = 1, currentIdentity = 1)) {
                current = current.copy(online = false, error = "Verbinding verbroken").finishedTask(ownsBusy = false)
            }
        }
        gate.advance()
        current = requireNotNull(acceptedPlayerScoreSnapshot(current, "/platform/actions", input(), response()))
        current = current.copy(screen = PlayerScreen.PROFILE, activeId = null, loading = true)
        finishRefresh.complete(Unit)
        refresh.await()
        assertTrue(current.online)
        assertNull(current.error)
        assertTrue(current.loading)
        assertFalse(gate.acceptsTaskFeedback(gate.capture(), ownsBusy = false, originalIdentity = 1, currentIdentity = 2))
        // The command owns its busy flag and can finish after advancing its own ACK epoch.
        assertTrue(gate.acceptsTaskFeedback(ticket, ownsBusy = true, originalIdentity = 1, currentIdentity = 1))
    }

    private fun match(revision: Int = 2) = JSONObject().put("id", "match-a").put("revision", revision).put("status", "live")
        .put("players", JSONArray(listOf(JSONObject().put("id", "one"), JSONObject().put("id", "two"))))
        .put("remaining", JSONArray(listOf(389, 501))).put("turn", 1)
        .put("permissions", JSONObject().put("canScore", false))

    @Test fun matchAckUpdatesTurnAndPermissionsAndRejectsOtherMatches() {
        val request = JSONObject().put("matchId", "match-a").put("expectedRevision", 1).put("action", JSONObject().put("type", "score").put("score", 112))
        val playing = PlayerUiState(screen = PlayerScreen.MATCH, activeId = "match-a")
        val updated = requireNotNull(acceptedPlayerScoreSnapshot(playing, "/matches/match-a/actions", request, match()))
        assertEquals(listOf(389, 501), updated.match!!.remaining)
        assertEquals(1, updated.match!!.turn)
        assertFalse(updated.match!!.permissions.getBoolean("canScore"))
        val withInvitation = updated.copy(resource = JSONObject(updated.resource.toString()).put("invitation", JSONObject().put("code", "K7M2")))
        assertEquals("K7M2", applyPlayerMatchSnapshot(withInvitation, match(3)).resource.getJSONObject("invitation").getString("code"))
        val afterPoll = applyPlayerMatchSnapshot(updated.copy(match = PlayerMatch.parse(match(4))), match(3))
        assertEquals(4, afterPoll.match!!.revision)
        assertNull(acceptedPlayerScoreSnapshot(playing, "/matches/other/actions", request, match()))
        assertNull(acceptedPlayerScoreSnapshot(playing, "/matches/match-a/actions", request, match().put("id", "other")))
        assertNull(acceptedPlayerScoreSnapshot(playing, "/matches/match-a/actions", request, match().put("permissions", JSONObject.NULL)))
    }

    @Test fun undoAndFinishUseTheirAcceptedServerStateRatherThanReplayingAScore() {
        for (action in listOf("training.undo", "training.finish")) {
            val request = input().apply { getJSONObject("action").put("type", action) }
            val server = entity().apply { getJSONObject("state").put("completed", action == "training.finish") }
            val updated = requireNotNull(acceptedPlayerScoreSnapshot(state(), "/platform/actions", request, response(server)))
            assertEquals(action == "training.finish", updated.resource.getJSONObject("entity").getJSONObject("state").getBoolean("completed"))
        }
    }
}
