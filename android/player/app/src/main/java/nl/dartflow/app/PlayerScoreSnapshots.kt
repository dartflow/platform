package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject

/** Invalidates reads started before a command, including reads suspended when its ACK arrives. */
internal class PlayerSnapshotGate {
    private var epoch = 0L
    fun capture(): Long = epoch
    fun advance() { epoch++ }
    fun accepts(ticket: Long): Boolean = ticket == epoch
    fun acceptsTaskFeedback(ticket: Long, ownsBusy: Boolean, originalIdentity: Int, currentIdentity: Int): Boolean =
        ownsBusy || originalIdentity == currentIdentity && accepts(ticket)
}

internal fun PlayerUiState.finishedTask(ownsBusy: Boolean): PlayerUiState =
    copy(busy = if (ownsBusy) false else busy, loading = false)

private fun JSONObject.snapshotRevision(): Int? = when (val value = opt("revision")) {
    is Int -> value.takeIf { it >= 0 }
    is Long -> value.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
    else -> null
}

private fun expectedRevision(input: JSONObject): Int? = when (val value = input.opt("expectedRevision")) {
    is Int -> value.takeIf { it >= 0 }
    is Long -> value.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
    else -> null
}

private fun replaceEntity(platform: JSONObject, key: String, entity: JSONObject): JSONObject {
    val rows = platform.optJSONArray(key).objects()
    val replacement = rows.map { if (it.optString("id") == entity.optString("id")) entity else it }.toMutableList()
    if (rows.none { it.optString("id") == entity.optString("id") }) replacement.add(entity)
    return JSONObject(platform.toString()).put(key, JSONArray(replacement))
}

private fun latestTraining(state: PlayerUiState, id: String): JSONObject? =
    (state.platform.optJSONArray("trainings").objects() + listOfNotNull(state.resource.optJSONObject("entity")))
        .filter { it.optString("id") == id && it.snapshotRevision() != null }
        .maxByOrNull { it.snapshotRevision()!! }

/** A server response may arrive out of order. An accepted score can never roll back to an older revision. */
internal fun applyPlayerTrainingSnapshot(state: PlayerUiState, entity: JSONObject): PlayerUiState {
    val id = entity.optString("id")
    val incomingRevision = entity.snapshotRevision() ?: return state
    val previous = latestTraining(state, id)
    val accepted = if ((previous?.snapshotRevision() ?: -1) > incomingRevision) previous!! else entity
    val active = state.screen == PlayerScreen.TRAINING && state.activeId == id
    return state.copy(
        platform = replaceEntity(state.platform, "trainings", accepted),
        resource = if (active) JSONObject().put("entity", accepted) else state.resource,
        loading = if (active) false else state.loading,
    )
}

internal fun applyPlayerMatchSnapshot(state: PlayerUiState, resource: JSONObject): PlayerUiState {
    val match = PlayerMatch.parse(resource)
    val previous = state.match?.takeIf { it.id == match.id }
    if (previous != null && previous.revision > match.revision) return state
    val merged = if (previous != null && !resource.has("invitation") && state.resource.has("invitation"))
        JSONObject(resource.toString()).put("invitation", state.resource.opt("invitation")) else resource
    return state.copy(resource = merged, match = match, loading = false)
}

private fun completeTrainingState(entity: JSONObject): Boolean {
    val state = entity.optJSONObject("state") ?: return false
    if (state.optString("mode") == "around") return state.optJSONArray("rounds") != null
    if (state.optString("mode") !in listOf("solo", "bot", "170")) return false
    val game = state.optJSONObject("game") ?: return false
    return (game.optJSONArray("remaining")?.length() ?: 0) > 0 && game.optJSONArray("visits") != null &&
        game.opt("turn") is Number && game.optString("status").isNotBlank()
}

/** Only complete, authoritative ACKs bypass dashboard reloads. Never calculate a score locally. */
internal fun acceptedPlayerScoreSnapshot(state: PlayerUiState, path: String, input: JSONObject, response: JSONObject): PlayerUiState? {
    val expected = expectedRevision(input)?.toLong() ?: return null
    if (path == "/platform/actions" && input.optJSONObject("action")?.optString("type") in listOf("training.score", "training.undo", "training.finish")) {
        val id = input.getJSONObject("action").optString("id")
        val entity = response.optJSONObject("entity") ?: return null
        val revision = entity.snapshotRevision()?.toLong() ?: return null
        if (!response.optBoolean("ok") || id.isBlank() || response.optString("id") != id || entity.optString("id") != id ||
            entity.optString("kind") != "training" || revision <= expected || !completeTrainingState(entity) || entity.opt("canManage") !is Boolean) return null
        return applyPlayerTrainingSnapshot(state, entity).copy(error = null, notice = null, online = true)
    }
    val id = input.optString("matchId")
    if (id.isBlank() || path != "/matches/$id/actions") return null
    val match = response.optJSONObject("match") ?: response
    val revision = match.snapshotRevision()?.toLong() ?: return null
    if (match.optString("id") != id || revision <= expected || match.optString("status").isBlank() ||
        match.optJSONArray("players")?.length() != 2 || match.optJSONArray("remaining")?.length() != 2 || match.optJSONObject("permissions") == null) return null
    // A back/navigation action can change the visible screen while this request is in flight.
    val updated = if (state.screen == PlayerScreen.MATCH && state.activeId == id) applyPlayerMatchSnapshot(state, response) else state
    return updated.copy(error = null, notice = null, online = true)
}
