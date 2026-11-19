package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import org.json.JSONObject

internal fun playerOwnPreCalls(state: PlayerUiState): List<JSONObject> {
    val actor = state.profile?.id ?: return emptyList()
    return (state.platform.rows("tournaments") + state.platform.rows("leagues")).flatMap { event ->
        val body = event.obj("state")
        if (body.optBoolean("closed") || body.optBoolean("completed") || body.optBoolean("paused")) return@flatMap emptyList()
        val calls = body.obj("preCalls")
        calls.keys().asSequence().toList().mapNotNull { boardId ->
            val call = calls.obj(boardId)
            val fixture = body.rows("fixtures").find { it.text("id") == call.text("fixtureId") && it.text("status") == "scheduled" && it.text("matchId").isBlank() } ?: return@mapNotNull null
            val players = fixture.optJSONArray("players")?.strings().orEmpty().filter { it.isNotBlank() && it != "null" }
            if (players.size != 2 || actor !in players && call.text("writerId") != actor) return@mapNotNull null
            val people = players + listOfNotNull(call.text("writerId").takeIf { it.isNotBlank() })
            if (people.any { id -> event.rows("members").none { member -> member.text("id") == id && member.text("status") == "active" && member.obj("attributes").optBoolean("registered") && (!member.obj("attributes").has("available") || member.obj("attributes").optBoolean("available")) } }) return@mapNotNull null
            val board = body.rows("boards").find { it.text("id") == boardId } ?: (state.overview.rows("boards") + state.platform.rows("clubBoards")).find { it.text("id") == boardId }
            if (board != null && (board.optBoolean("blocked") || board.optBoolean("closed") || board.optBoolean("archived") || board.optBoolean("closePending"))) return@mapNotNull null
            json("entityId" to event.text("id"), "name" to event.text("name"), "boardName" to (board?.text("name") ?: "de aangewezen baan"), "writer" to (call.text("writerId") == actor))
        }
    }
}
@Composable internal fun PlayerOwnPreCalls(state: PlayerUiState, actions: PlayerActions) {
    playerOwnPreCalls(state).forEach { call -> PlayerCard("Vooroproep · ${call.text("name")}") {
        Text("Verwacht bij ${call.text("boardName")}${if (call.optBoolean("writer")) " als schrijver" else ""} · wacht op definitieve oproep.", color = PlayerLime)
        Text("De lopende partij en je huidige toewijzing blijven leidend. Dit is een verwachting voor de volgende partij.", color = PlayerMuted)
        Action("Open evenement", primary = false) { actions.navigate(PlayerScreen.EVENT, call.text("entityId")) }
    } }
}
