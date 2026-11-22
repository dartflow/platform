package nl.dartflow.app

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

internal const val PLAYER_SCORE_INPUT_FILE = "dartflow-score-input-v1"
internal const val PLAYER_TOTAL_INPUT = "total"
internal const val PLAYER_DART_INPUT = "per-dart"
internal val playerScoreInputModes = linkedMapOf("x01" to "X01 · 301 / 501 / 701", "cricket" to "Cricket", "tactics" to "Tactics", "around" to "Around the Clock", "bingo" to "Dubbelbingo", "finish" to "Finishtraining", "leg-challenge" to "Leguitdagingen")

/** Presentation preferences only; actor identity, score commands and measured darts are separate. */
internal class PlayerScoreInputStore(context: Context) {
    val preferences: SharedPreferences = context.applicationContext.getSharedPreferences(PLAYER_SCORE_INPUT_FILE, Context.MODE_PRIVATE)
    fun key(actor: String) = "$PLAYER_SCORE_INPUT_FILE:${actor.ifBlank { "guest" }}"
    fun input(actor: String, mode: String): String {
        if (mode !in listOf("x01", "leg-challenge")) return PLAYER_DART_INPUT
        val record = runCatching { JSONObject(preferences.getString(key(actor), "").orEmpty()) }.getOrNull()
        return if (record?.optInt("version") == 1 && record.obj("modes").text(mode) == PLAYER_DART_INPUT) PLAYER_DART_INPUT else PLAYER_TOTAL_INPUT
    }
    fun save(actor: String, mode: String, input: String) {
        require(mode in listOf("x01", "leg-challenge") && input in listOf(PLAYER_TOTAL_INPUT, PLAYER_DART_INPUT))
        val existing = runCatching { JSONObject(preferences.getString(key(actor), "").orEmpty()) }.getOrNull()
        val modes = if (existing?.optInt("version") == 1) existing.obj("modes") else JSONObject()
        modes.put(mode, input)
        check(preferences.edit().putString(key(actor), json("version" to 1, "modes" to modes).toString()).commit()) { "Je score-invoervoorkeur kon niet op dit toestel worden bewaard." }
    }
}

internal fun playerScoreInputActor(state: PlayerUiState): String = state.session?.userId?.takeIf { it.isNotBlank() } ?: state.profile?.id?.takeIf { it.isNotBlank() } ?: "guest"
internal data class PlayerScoreInputPreference(val input: String, val error: String?, val select: (String) -> Unit)

@Composable internal fun rememberPlayerScoreInput(state: PlayerUiState, mode: String = "x01"): PlayerScoreInputPreference {
    val context = LocalContext.current
    val store = remember(context.applicationContext) { PlayerScoreInputStore(context) }
    val actor = playerScoreInputActor(state)
    var input by remember(actor, mode) { mutableStateOf(store.input(actor, mode)) }
    var error by remember(actor, mode) { mutableStateOf<String?>(null) }
    DisposableEffect(store, actor, mode) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key == store.key(actor)) input = store.input(actor, mode) }
        store.preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { store.preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return PlayerScoreInputPreference(input, error) { selected ->
        runCatching { store.save(actor, mode, selected) }
            .onSuccess { input = store.input(actor, mode); error = null }
            .onFailure { error = it.message ?: "Je voorkeur kon niet worden bewaard." }
    }
}

@Composable internal fun PlayerScoreInputChoice(preference: PlayerScoreInputPreference, mode: String = "x01") {
    Text(if (mode == "leg-challenge") "Leguitdagingen" else "X01 · alle startscores", color = PlayerLime)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(PLAYER_TOTAL_INPUT to "Beurtotaal", PLAYER_DART_INPUT to "Per pijl").forEach { (value, label) ->
            OutlinedButton(onClick = { preference.select(value) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("score-input-$mode-$value").semantics { selected = preference.input == value }, colors = ButtonDefaults.outlinedButtonColors(contentColor = if (preference.input == value) PlayerLime else PlayerText)) { Text(label) }
        }
    }
    Text("Beurtotaal begint met 3 pijlen; je kunt 1, 2 of 3 kiezen. Bij een finish bevestig je altijd het werkelijk gebruikte aantal.", color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp)
    preference.error?.let { Notice(it, true) }
}

@Composable internal fun PlayerScoreInputSettings(state: PlayerUiState) {
    val preference = rememberPlayerScoreInput(state)
    val challenge = rememberPlayerScoreInput(state, "leg-challenge")
    PlayerCard("Score-invoer", Modifier.testTag("score-input-settings")) {
        Text("Bewaard voor jouw account op dit toestel. Deze voorkeur wordt niet naar andere telefoons of browsers gesynchroniseerd.", color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp)
        PlayerScoreInputChoice(preference)
        PlayerScoreInputChoice(challenge, "leg-challenge")
        Text("Een uitdaging die pijlen vergelijkt vereist altijd werkelijke pijlregistratie.", color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp)
        Text("Bij double-in of afwijkende uitregels kunnen geraakte vakken verplicht zijn om de opening en finish correct te registreren.", color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp)
        playerScoreInputModes.filterKeys { it !in listOf("x01", "leg-challenge") }.forEach { (_, label) -> Text("$label · per pijl / doelregistratie", color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp) }
    }
}

@Composable internal fun PlayerRequiredDartExplanation(message: String) {
    Text(message, color = PlayerMuted, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.fillMaxWidth().testTag("required-dart-explanation"))
}

internal fun playerCoreDartExplanation(settings: JSONObject): String? = when {
    settings.text("discipline", "x01") in listOf("cricket", "tactics") -> null
    settings.text("inRule", "single") == "double" || settings.text("outRule", "double") != "double" -> "Deze opening of uitregel vereist de werkelijk geraakte vakken per pijl. Je voorkeur voor beurtotalen blijft bewaard."
    else -> null
}
