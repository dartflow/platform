package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import org.json.JSONObject

@Composable internal fun PlayerTournamentConsolation(event: JSONObject) {
    val cup = event.obj("state").obj("consolation")
    if (!cup.optBoolean("enabled")) return
    fun name(id: String) = event.rows("members").find { it.text("id") == id }?.text("name") ?: "Speler"
    PlayerCard(cup.text("title", "Troostbeker")) {
        Text("Afzonderlijke troostbeker voor echte eerste-rondeverliezers. Een vrijstelling of administratieve uitslag is geen gespeelde nederlaag. De hoofdeindplaats blijft leidend; dit levert geen extra circuitbonus of automatische officiële rating op.", color = PlayerMuted)
        cup.text("notice").takeIf { it.isNotBlank() }?.let { Notice(it) }
        Text(if (cup.optBoolean("completed")) "Troostbeker afgerond" else "Troostschema en uitslag volgen de bevestigde partijen", color = PlayerLime)
        cup.text("championId").takeIf { it.isNotBlank() }?.let { Text("Winnaar: ${name(it)}", color = PlayerLime) }
        cup.rows("placings").forEach { Text("${it.optInt("position")}. ${name(it.text("playerId"))}") }
    }
}
