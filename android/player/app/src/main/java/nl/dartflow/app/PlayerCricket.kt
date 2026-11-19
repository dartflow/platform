package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import org.json.JSONObject

internal val playerCricketTargets = listOf(20, 19, 18, 17, 16, 15, 25)
internal fun playerIsCricket(match: PlayerMatch) = match.raw.obj("settings").text("discipline", "x01") == "cricket"
internal fun playerCricketMark(value: Int): String = when (value.coerceIn(0, 3)) { 0 -> "–"; 1 -> "/"; 2 -> "X"; else -> "⊗" }
internal fun playerCricketMpr(visits: List<JSONObject>, side: Int): Double? {
    val own = visits.filter { it.optInt("playerIndex") == side && it.has("cricket") }
    val darts = own.sumOf { it.optInt("darts") }
    return if (darts > 0) 3.0 * own.sumOf { it.obj("cricket").optInt("creditedMarks") } / darts else null
}
@Composable internal fun PlayerCricketTable(match: PlayerMatch) {
    val cricket = match.raw.obj("cricket")
    val marks = cricket.optJSONArray("marks")
    PlayerCard(if (match.raw.obj("settings").text("cricketMode", "standard") == "no-score") "Cricket · zonder punten" else "Cricket · punten") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(match.sideName(0), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Text("Doel", color = PlayerMuted); if (match.players.size > 1) Text(match.sideName(1), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)) }
        playerCricketTargets.forEachIndexed { index, target -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            Text(playerCricketMark(marks?.optJSONArray(0)?.optInt(index) ?: 0), color = PlayerLime)
            Text(if (target == 25) "Bull" else "$target", color = PlayerMuted)
            if (match.players.size > 1) Text(playerCricketMark(marks?.optJSONArray(1)?.optInt(index) ?: 0), color = PlayerLime)
        } }
        Text("Punten ${cricket.optJSONArray("points")?.ints()?.joinToString(" – ").orEmpty()}", color = PlayerLime)
        Text("/ één mark · X twee · ⊗ gesloten. Alleen de server bepaalt sluiting, punten en winnaar.", color = PlayerMuted)
    }
}
