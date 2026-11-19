package nl.dartflow.app

import java.text.Normalizer
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

enum class PlayerScreen { HOME, PLAY, EVENTS, EVENT, FRIENDS, FEED, PROFILE, STATISTICS, HISTORY, BOARDS, MATCH, BOARD, LOBBY, TRAINING, CHAT, SEASONS, SEASON, NOTIFICATIONS, SCREENS, ORGANIZE, DIRECTOR, RANKINGS, HELP, CLUBS, CLUB, SEASON_CREATE, RANKING_EVENT, FAQ_ADMIN, LOCATIONS, PLAY_START, PLAY_SESSION, PLAY_HISTORY, PRACTICE, CHALLENGES, MANUAL }

/** UI session metadata intentionally contains no bearer or refresh credential. */
data class PlayerSession(val userId: String, val email: String, val expiresAt: Long, val local: Boolean = false)
data class PlayerProfile(
    val id: String, val name: String, val username: String = "", val displayName: String = name,
    val pinConfigured: Boolean = false, val onboardingComplete: Boolean = false,
    val displayNameConfirmed: Boolean = false,
    val fullName: String? = null, val usernameLocked: Boolean = displayNameConfirmed && username.isNotBlank(), val identityNeedsReview: Boolean = false,
) {
    companion object {
        fun parse(value: JSONObject) = PlayerProfile(
            value.text("id"), playerPublicName(value), value.text("username"), value.text("displayName"),
            value.optBoolean("pinConfigured"), value.optBoolean("onboardingComplete"), value.optBoolean("displayNameConfirmed"),
            value.text("fullName").takeIf { it.isNotBlank() },
            value.optBoolean("usernameLocked", value.optBoolean("displayNameConfirmed") && value.text("username").isNotBlank()),
            value.optBoolean("identityNeedsReview"),
        )
    }
}
data class PlayerMatch(
    val id: String, val status: String, val revision: Int, val players: List<PlayerProfile>,
    val remaining: List<Int>, val turn: Int, val legNumber: Int, val setNumber: Int,
    val checkout: String?, val permissions: JSONObject, val raw: JSONObject,
) {
    /** Side identities and the actual thrower are canonical server projections. */
    val sides: List<List<PlayerProfile>> get() = players.indices.map { index ->
        raw.optJSONArray("sideParticipants")?.optJSONArray(index).objects().map(PlayerProfile::parse).ifEmpty { listOf(players[index]) }
    }
    val participants: List<PlayerProfile> get() = sides.flatten().distinctBy { it.id }
    fun sideName(index: Int): String = raw.optJSONArray("sideNames")?.optString(index)?.takeIf { it.isNotBlank() && it != "null" }
        ?: sides.getOrNull(index)?.joinToString(" & ") { it.displayName.ifBlank { it.name } }.orEmpty()
    val currentThrower: PlayerProfile? get() = raw.optJSONObject("currentThrower")?.let(PlayerProfile::parse)
    companion object {
        fun parse(value: JSONObject): PlayerMatch {
            val match = value.optJSONObject("match") ?: value
            val game = match.optJSONObject("game") ?: JSONObject()
            return PlayerMatch(match.optString("id"), match.optString("status"), match.optInt("revision"),
                match.optJSONArray("players").objects().map(PlayerProfile::parse), (match.optJSONArray("remaining") ?: game.optJSONArray("remaining")).ints(),
                match.optInt("turn", game.optInt("turn")), match.optInt("legNumber", 1), match.optInt("setNumber", 1),
                match.optString("checkout").takeIf { it.isNotBlank() && it != "null" },
                match.optJSONObject("permissions") ?: JSONObject(), match)
        }
    }
}
data class PlayerUiState(
    val loading: Boolean = true, val busy: Boolean = false, val session: PlayerSession? = null,
    val profile: PlayerProfile? = null, val screen: PlayerScreen = PlayerScreen.HOME, val activeId: String? = null,
    val resource: JSONObject = JSONObject(), val overview: JSONObject = JSONObject(), val platform: JSONObject = JSONObject(),
    val match: PlayerMatch? = null, val board: JSONObject? = null, val error: String? = null, val notice: String? = null,
    val pendingEmail: String? = null, val localUsers: List<PlayerProfile> = emptyList(), val googleUrl: String? = null,
    val online: Boolean = true, val hasPendingCommand: Boolean = false, val capabilities: JSONObject = JSONObject(),
    val pendingMatchVisits: Int = 0, val pendingTrainingVisits: Int = 0,
    val safety: JSONObject = JSONObject(),
    val invitation: JSONObject = JSONObject(),
    val canManagePlatform: Boolean = false, val organizerDraft: JSONObject = JSONObject(), val organizerCloudDraft: JSONObject = JSONObject(), val faqAdminReceipt: JSONObject = JSONObject(),
    val accountDeletion: JSONObject = JSONObject(),
    val homeFeed: JSONObject = JSONObject(), val homeFeedLoading: Boolean = false, val homeFeedError: String? = null,
    val guestOperatorId: String = "",
    internal val play: PlayerPlayUi = PlayerPlayUi(),
)

fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray?.ints(): List<Int> = if (this == null) emptyList() else (0 until length()).map { optInt(it) }

/** Same label normalization as the server. Availability and uniqueness remain server decisions. */
object PlayerValidation {
    fun normalizeName(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFC).replace(Regex("[\\s\\p{Z}\\uFEFF]+"), " ").trim()
    fun normalizeUsername(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC).removePrefix("@").lowercase(Locale.ROOT)
    fun validName(value: String): Boolean {
        val normalized = normalizeName(value)
        return normalized.isNotEmpty() && normalized.length <= 80 && normalized.codePoints().anyMatch { Character.isLetterOrDigit(it) }
            && normalized.codePoints().noneMatch { Character.getType(it) in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt()) }
            && normalized.lowercase(Locale.forLanguageTag("nl")) != "nieuwe speler"
    }
    fun validUsername(value: String): Boolean {
        if (value.codePoints().anyMatch(::invalidUsernameCodePoint)) return false
        val canonical = normalizeUsername(value)
        return !canonical.startsWith('@') && canonical.length in 1..80 && validName(canonical) && canonical.codePoints().noneMatch(::invalidUsernameCodePoint)
    }
    private fun invalidUsernameCodePoint(code: Int): Boolean = Character.isWhitespace(code) || Character.isSpaceChar(code) || Character.getType(code) in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt()) || code == 0x034F || code in 0x115F..0x1160 || code in 0x17B4..0x17B5 || code in 0x180B..0x180F || code in 0x2060..0x206F || code == 0x3164 || code in 0xFE00..0xFE0F || code == 0xFFA0 || code in 0xFFF0..0xFFF8 || code in 0x1BCA0..0x1BCA3 || code in 0x1D173..0x1D17A || code in 0xE0000..0xE0FFF
    fun validFullName(value: String): Boolean = normalizeName(value).let { name -> name.length <= 160 && name.codePoints().noneMatch { Character.getType(it) in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt()) } }
    fun validPin(value: String): Boolean = value.length == 6 && value.all { it in '0'..'9' }
    fun validOtp(value: String, min: Int = 6, max: Int = 10): Boolean = value.length in min..max && value.all { it in '0'..'9' }
}
