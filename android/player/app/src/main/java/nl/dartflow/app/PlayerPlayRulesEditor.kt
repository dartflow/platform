package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONObject

@Composable internal fun PlayerPlayRulesEditor(rules: JSONObject, enabled: Boolean, change: (JSONObject) -> Unit) {
    val mode = rules.text("mode", "x01")
    fun set(key: String, value: Any) = change(JSONObject(rules.toString()).put(key, value))
    Choice("Spel", mode, playerPlayModes.filter { it != "leg-challenge" }.map { it to playerPlayModeName(it) }, { change(playerPlayDefaultRules(it)) }, enabled)
    when (mode) {
        "x01" -> {
            Choice("Startscore", rules.optInt("startScore", 301).toString(), listOf("301" to "301 · standaard dubbel openen", "501" to "501 · standaard open start", "701" to "701 · standaard open start"), { start -> change(JSONObject(rules.toString()).put("startScore", start.toInt()).put("inRule", if (start == "301") "double" else "single")) }, enabled)
            PlayerToggle("Dubbel openen", rules.text("inRule") == "double", enabled) { set("inRule", if (it) "double" else "single") }
            PlayOutChoice(rules.text("outRule", "double"), enabled) { set("outRule", it) }
            Text("Bij dubbel openen tellen pijlen vóór de eerste dubbel niet mee. Bullseye is een dubbel. De server controleert opening, bust en finish.", color = PlayerMuted)
        }
        "cricket" -> PlayerToggle("Met punten", rules.optBoolean("points", true), enabled) { set("points", it) }
        "tactics" -> {
            Choice("Tactics-preset", rules.text("preset", "tactics-5"), listOf("tactics-5" to "Tactics 5 · vijf treffers", "tactics-3" to "Tactics 3 · drie treffers"), { preset -> change(JSONObject(rules.toString()).put("preset", preset).put("requiredMarks", if (preset == "tactics-5") 5 else 3).put("tieRule", if (preset == "tactics-5") "replay" else "first-closed")) }, enabled)
            PlayerToggle("Met punten", rules.optBoolean("points", true), enabled) { set("points", it) }
            Text(if (rules.text("preset") == "tactics-3") "Alle doelen dicht en minstens evenveel punten wint." else "Alle doelen dicht en meer punten wint. Zijn beide zijden dicht bij gelijke punten, dan wordt de leg herkenbaar overgespeeld.", color = PlayerMuted)
        }
        "around" -> {
            Choice("Treffers op getallen", rules.text("segment", "any"), listOf("any" to "Single, dubbel of triple", "single" to "Alleen singles", "double" to "Alleen dubbels", "triple" to "Alleen triples"), { set("segment", it) }, enabled)
            Choice("Bull afsluiten", rules.text("bull", "any"), listOf("any" to "Buitenbull of bullseye", "outer" to "Alleen buitenbull (25)", "inner" to "Alleen bullseye (50)", "off" to "Geen bull"), { set("bull", it) }, enabled)
            Choice("Volgorde", rules.text("order", "ascending"), listOf("ascending" to "1 tot en met 20", "descending" to "20 tot en met 1"), { set("order", it) }, enabled)
            Choice("Treffers per doel", rules.optInt("hitsPerTarget", 1).toString(), (1..5).map { "$it" to "$it" }, { set("hitsPerTarget", it.toInt()) }, enabled)
            Text("Elke geldige pijl telt één succes. Een triple slaat geen doelen over; resterende pijlen mogen het volgende doel raken.", color = PlayerMuted)
        }
        "bingo" -> {
            Choice("Winstvoorwaarde", rules.text("win", "line"), listOf("line" to "Eerste lijn", "full-card" to "Volle kaart"), { set("win", it) }, enabled)
            Field("Kaartcode (leeg voor een nieuwe kaart)", rules.text("cardCode"), { value -> change(JSONObject(rules.toString()).also { if (value.isBlank()) it.remove("cardCode") else it.put("cardCode", value) }) }, enabled, max = 100)
            Text("Iedereen krijgt dezelfde negen unieke dubbels. Alleen de afgebeelde dubbel vult een vak; opnieuw raken vult geen extra vak. Teamleden wisselen na een volledige beurt.", color = PlayerMuted)
        }
        "finish" -> {
            Field("Te oefenen finish", rules.optInt("target", 68).toString(), { set("target", it.toIntOrNull() ?: 0) }, enabled, max = 3, keyboard = KeyboardType.Number)
            Choice("Aantal pogingen", rules.optInt("attemptCount", 5).toString(), listOf(5, 10, 15).map { "$it" to "$it" }, { set("attemptCount", it.toInt()) }, enabled)
            PlayOutChoice(rules.text("outRule", "double"), enabled) { set("outRule", it) }
            PlayerToggle("Routehulp", rules.optBoolean("routeHelp", true), enabled) { set("routeHelp", it) }
            Text("Elke poging start opnieuw op je doelstand, met maximaal drie pijlen. Een bust of geldige finish beëindigt die poging. Beoogde dubbels zijn optioneel en worden afzonderlijk geregistreerd.", color = PlayerMuted)
        }
    }
    if (mode in listOf("x01", "cricket", "tactics")) {
        Choice("Best of legs", rules.optInt("bestOfLegs", 1).toString(), listOf(1,3,5,7,9,11,13,15,17,19).map { "$it" to "$it" }, { set("bestOfLegs", it.toInt()) }, enabled)
        Choice("Best of sets", rules.optInt("bestOfSets", 1).toString(), listOf(1,3,5).map { "$it" to "$it" }, { set("bestOfSets", it.toInt()) }, enabled)
    }
    Text(playerPlayRulesLabel(rules), color = PlayerLime)
}

@Composable private fun PlayOutChoice(value: String, enabled: Boolean, change: (String) -> Unit) = Choice("Eindregel", value, listOf("double" to "Dubbel uit", "straight" to "Straight uit", "master" to "Master uit"), change, enabled)
