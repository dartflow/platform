package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import org.json.JSONObject

/** Totals never stand in for observed darts during an opening or a measured leg challenge. */
internal fun playerPlayAllowsTotal(session: PlayerPlaySession): Boolean = when (session.rules.text("mode")) {
    "x01" -> session.progress.optJSONArray("opened")?.optBoolean(session.turn) == true
    "leg-challenge" -> session.rules.text("comparison") == "visits" && session.progress.optBoolean("opened")
    else -> false
}

@Composable internal fun PlayerPlayScoreScreen(state: PlayerUiState, actions: PlayerActions, onOverview: () -> Unit) {
    val session = state.play.session ?: return
    val mode = session.rules.text("mode")
    val outRule = if (mode == "leg-challenge") session.rules.obj("source").text("outRule", "double") else session.rules.text("outRule", "double")
    val pending = state.play.pending
    var observedDarts by rememberSaveable(session.id) { mutableStateOf(false) }
    val inputState = rememberSaveableStateHolder()
    val allowsTotal = playerPlayAllowsTotal(session)
    val totals = allowsTotal && !observedDarts
    val canScore = session.permissions.optBoolean("canScore") && state.play.pendingOperation == null && (session.raw.text("deviceMode") != "individual" || pending == 0)
    val message = state.play.error ?: when {
        state.play.pendingOperation != null -> "Eerdere partijwijziging wacht op bevestiging."
        !canScore -> "Wacht op de beurt van ${session.currentName()}. De stand wordt automatisch vernieuwd."
        else -> null
    }
    val scoreLabel = when (mode) { "cricket", "tactics" -> "punten"; "around" -> "doel"; "bingo" -> "gevulde vakken"; else -> "restscore" }
    val players = session.sides.indices.map { side ->
        val remaining = when (mode) {
            "x01" -> session.progress.optJSONArray("remaining")?.optInt(side) ?: session.rules.optInt("startScore")
            "cricket", "tactics" -> session.progress.optJSONArray("points")?.optInt(side) ?: 0
            "around" -> session.progress.optJSONArray("targets").ints().getOrNull(session.progress.optJSONArray("targetIndex")?.optInt(side) ?: 0) ?: 0
            "bingo" -> session.progress.optJSONArray("filled")?.optJSONArray(side)?.let { filled -> (0 until filled.length()).count { filled.optBoolean(it) } } ?: 0
            else -> session.progress.optInt("remaining", session.rules.optInt("target"))
        }
        ScorePlayer(session.sides[side].text("id"), session.sideName(side), remaining)
    }
    PlayerScoreConsole(
        title = "${playerPlayModeName(mode)} · Set ${session.game.optInt("set", 1)} · Leg ${session.game.optInt("leg", 1)}",
        players = players, active = session.turn, currentThrowerName = session.currentName(), scoreLabel = scoreLabel,
        canScore = canScore, busy = state.play.syncing && !state.play.offline, offline = state.play.offline,
        checkout = null, message = message, scoreKey = "${session.id}:${session.revision}",
        queueSupported = true, queuedVisits = pending, onSubmit = { _, _, _, _ -> },
        unknownDartsByDefault = true, finishRule = outRule, optionsLabel = "Scorekaart & correctie", onSubmitVisit = { score, darts, double, attempts ->
            val input = json("score" to score)
            darts?.let { input.put("darts", it) }
            if (double && outRule != "straight") input.put("doubleConfirmed", true)
            attempts?.let { input.put("doubleAttempts", it) }
            actions.playAction(json("type" to "session.score", "input" to input))
        },
        onBack = onOverview, onRetry = { actions.playAction(json("type" to if (state.play.pendingOperation != null) "local.retry-operation" else "local.refresh")) },
        dartEntry = if (totals) null else { {
            inputState.SaveableStateProvider("observed-darts:${session.id}") { PlayerPlayDartEntry(session, canScore && (!state.play.syncing || state.play.offline)) {
                actions.playAction(json("type" to "session.score", "input" to it))
            } }
        } },
        options = {
            PlayerPlayTimer(session, state.play.syncing, actions)
            Text(playerPlayRulesLabel(session.rules), color = PlayerMuted)
            if (session.permissions.optBoolean("canUndo") || pending > 0) Action(if (pending > 0) "Laatste wachtende invoer terugnemen" else "Laatste verwerkte beurt terugnemen", !state.play.syncing, false) { actions.playAction(json("type" to "session.undo")) }
            if (pending > 0) Action("Synchroniseer bewaarde invoer", !state.play.syncing) { actions.playAction(json("type" to "local.refresh")) }
            PlayerPlayGameView(session)
        },
        activity = if (session.raw.optLong("deadlineAt") > 0) JSONObject(session.raw.toString()).put("phase", "active").put("sessionId", session.id).put("canExtend", session.permissions.optBoolean("canManage") || session.permissions.optBoolean("canScore")) else JSONObject(),
        onExtend = { actions.playAction(json("type" to "session.extend", "warningEpoch" to session.raw.text("warningEpoch"))) },
        onToggleDartEntry = if (allowsTotal) { { observedDarts = !observedDarts } } else null,
    )
}
