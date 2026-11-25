package nl.dartflow.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun PlayerPlayGameView(session: PlayerPlaySession) {
    if (!session.supported) { Notice("Deze spelvorm of regelversie wordt niet ondersteund. Werk DartFlow bij voordat je deze partij bedient.", true); return }
    val game = session.game; val progress = session.progress; val mode = session.rules.text("mode")
    Text("${playerPlayModeName(mode)} · set ${game.optInt("set", 1)} · leg ${game.optInt("leg", 1)}", color = PlayerMuted)
    Text(if (session.complete) "Partij afgerond" else if (game.text("status") == "replay-required") "Gelijk gesloten · deze leg wordt overgespeeld" else "Aan de beurt: ${session.currentName()}", color = PlayerLime, fontWeight = FontWeight.Bold)
    if(mode in listOf("x01","cricket","tactics"))Text(session.sides.indices.joinToString(" · "){side->"${session.sideName(side)}: ${game.optJSONArray("sets")?.optInt(side)?:0} sets / ${game.optJSONArray("legs")?.optInt(side)?:0} legs"},color=PlayerMuted)
    when (mode) {
        "x01" -> {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { session.sides.indices.forEach { side -> PlayerCard(modifier = Modifier.weight(1f)) {
                Text(session.sideName(side), fontWeight = FontWeight.Bold)
                Text("${progress.optJSONArray("remaining")?.optInt(side) ?: session.rules.optInt("startScore")}", fontFamily = PlayerBarlow, fontSize = if (session.sides.size > 2) 34.sp else 56.sp, color = if (side == session.turn) PlayerLime else PlayerText)
                if (session.rules.text("inRule") == "double") Text(if (progress.optJSONArray("opened")?.optBoolean(side) == true) "Geopend" else "Nog dubbel openen", color = PlayerMuted)
            } } }
            PlayVisits(session)
        }
        "cricket", "tactics" -> PlayMarks(session)
        "around" -> session.sides.indices.forEach { side -> PlayerCard(session.sideName(side)) {
            val targets = progress.optJSONArray("targets").ints(); val index = progress.optJSONArray("targetIndex")?.optInt(side) ?: 0
            val target = targets.getOrNull(index)
            Text(if (target == null) "✓ Voltooid" else if (target == 25) "BULL" else "$target", fontFamily = PlayerBarlow, fontSize = 64.sp, color = PlayerLime)
            Text("${index.coerceAtMost(targets.size)} / ${targets.size} doelen · ${progress.optJSONArray("targetHits")?.optInt(side) ?: 0} / ${session.rules.optInt("hitsPerTarget", 1)} treffers op dit doel", color = PlayerMuted)
            Text("${progress.optJSONArray("darts")?.optInt(side) ?: 0} geregistreerde pijlen", color = PlayerMuted)
        } }
        "bingo" -> {
            Text("Kaartcode ${progress.text("cardCode")}", color = PlayerLime)
            session.sides.indices.sortedBy { if (it == session.turn) 0 else 1 }.forEach { side -> PlayerCard(session.sideName(side) + if (side == session.turn) " · aan de beurt" else "") {
                val card = progress.optJSONArray("card").ints(); val filled = progress.optJSONArray("filled")?.optJSONArray(side)
                if (session.sides.size <= 2 || side == session.turn || session.complete) card.chunked(3).forEachIndexed { rowIndex, row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEachIndexed { column, target ->
                    val index = rowIndex * 3 + column; val done = filled?.optBoolean(index) == true
                    Box(Modifier.weight(1f).heightIn(min = 54.dp).border(1.dp, if (done) PlayerLime else PlayerBorder, RoundedCornerShape(8.dp)).background(if (done) PlayerLime.copy(alpha = .12f) else PlayerPanel).padding(12.dp).testTag("bingo-$side-$index")) { Text("${if (done) "✓ " else ""}D$target", color = if (done) PlayerLime else PlayerText) }
                } } } else Text("${(0 until 9).count { filled?.optBoolean(it) == true }} / 9 vakken", color = PlayerMuted)
                Text("${progress.optJSONArray("darts")?.optInt(side) ?: 0} pijlen", color = PlayerMuted)
            } }
        }
        "finish" -> PlayerCard("Finish ${session.rules.optInt("target")}") {
            Text("${progress.optInt("remaining", session.rules.optInt("target"))}", fontFamily = PlayerBarlow, fontSize = 70.sp, color = PlayerLime)
            Text("Poging ${progress.optInt("attemptNumber", 1).coerceAtMost(session.rules.optInt("attemptCount", 5))} / ${session.rules.optInt("attemptCount", 5)} · ${progress.optInt("dartsLeft", 3)} pijlen over", color = PlayerMuted)
            progress.rows("completed").forEach { attempt -> Text("Poging ${attempt.optInt("number")}: ${if (attempt.optBoolean("success")) "uit" else if (attempt.optBoolean("bust")) "bust" else "niet uit"} · ${attempt.optInt("darts")} pijlen · dubbelpogingen ${attempt.text("doubleAttempts", "onbekend")}", color = PlayerMuted) }
        }
        "leg-challenge" -> {
            PlayerCard("Jouw poging · ${session.currentName()}") { Text("${progress.optInt("remaining")}", fontFamily = PlayerBarlow, fontSize = 60.sp, color = PlayerLime); Text("${progress.optInt("ownVisits")} beurten · ${progress.optInt("ownDarts")} geregistreerde pijlen", color = PlayerMuted) }
            PlayerCard(session.raw.text("sourceName").takeIf(String::isNotBlank)?.let{"Gespeelde leg · $it"}?:"Gespeelde leg") {
                Text("${progress.optInt("sourceRemaining")}", fontFamily = PlayerBarlow, fontSize = 60.sp, color = PlayerMuted)
                if (progress.optBoolean("sourceChanged")) Notice("De bron is later gewijzigd. Deze poging gebruikt de vastgelegde bronversie.")
                if (progress.optBoolean("sourceInvalidated")) Notice("De bron is ongeldig verklaard; nieuwe pogingen zijn gesloten.", true)
                val revealed = progress.optInt("revealedSourceVisits").coerceAtLeast(0)
                session.rules.obj("source").rows("visits").take(revealed).forEachIndexed { i, visit -> Text("${i + 1}. ${if (visit.optBoolean("bust")) "BUST" else visit.text("score")} · rest ${visit.optInt("remainingAfter")}", color = PlayerMuted) }
                if (revealed == 0) Text("De historische worp verschijnt pas na jouw bevestigde beurt.", color = PlayerMuted)
            }
            PlayVisits(session)
        }
    }
    game.optJSONObject("result")?.let { result -> PlayerCard("Resultaat") { Text(when (result.text("kind")) { "draw" -> "Gelijkspel"; "completed" -> "Oefening voltooid"; "loss" -> "Poging verloren"; else -> session.sides.indexOfFirst { it.text("id") == result.text("winnerSideId") }.takeIf { it >= 0 }?.let { "Gewonnen: ${session.sideName(it)}" } ?: "Poging gewonnen" }, color = PlayerLime); Text(result.text("reason"), color = PlayerMuted) } }
}

@Composable private fun PlayMarks(session: PlayerPlaySession) {
    val p = session.progress; val required = p.optInt("requiredMarks", 3)
    PlayerCard(if (session.rules.text("mode") == "tactics") "${session.rules.text("preset").replace("tactics-", "Tactics ")} · $required treffers" else "Cricket · 3 treffers") {
        Row(Modifier.fillMaxWidth()) { Text("Doel", Modifier.weight(1f), color = PlayerMuted); session.sides.indices.forEach { Text(session.sideName(it), Modifier.weight(1f), fontSize = 12.sp) } }
        p.optJSONArray("targets").ints().forEachIndexed { index, target -> Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
            Text(if (target == 25) "Bull" else "$target", Modifier.weight(1f), color = PlayerMuted)
            session.sides.indices.forEach { side -> val marks = p.optJSONArray("marks")?.optJSONArray(side)?.optInt(index) ?: 0; Text(if (marks >= required) "✓" else "$marks/$required", Modifier.weight(1f), color = PlayerLime) }
        } }
        if (session.rules.optBoolean("points", true)) Row(Modifier.fillMaxWidth()) { Text("Punten", Modifier.weight(1f)); session.sides.indices.forEach { Text("${p.optJSONArray("points")?.optInt(it) ?: 0}", Modifier.weight(1f), color = PlayerLime) } }
        Text("Een sluitingspijl kan ook punten opleveren. De geaccepteerde stand bepaalt treffers, punten en winst.", color = PlayerMuted, fontSize = 11.sp)
    }
    PlayVisits(session)
}

@Composable private fun PlayVisits(session: PlayerPlaySession) {
    val visits = session.game.rows("visits")
    if (visits.isEmpty()) return
    PlayerCard("Beurtvolgorde") { visits.takeLast(8).forEach { v -> Text("${v.optInt("number")}. ${session.participantName(v.text("throwerId"))}: ${if (v.optBoolean("bust")) "BUST" else v.text("score")} · ${v.text("remainingAfter").takeIf(String::isNotBlank)?.let { "rest $it · " }.orEmpty()}${v.optInt("countingDarts")} pijlen${if (v.optBoolean("finish")) " · finish" else ""}", color = PlayerMuted) } }
}
