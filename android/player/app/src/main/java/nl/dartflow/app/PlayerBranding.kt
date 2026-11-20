package nl.dartflow.app

import android.content.Context
import org.json.JSONObject
import java.time.Instant
import kotlin.math.pow

internal val playerThemeKeys = listOf("background", "surface", "surfaceRaised", "border", "text", "muted", "primary", "onPrimary", "secondary", "focus", "success", "warning", "error")
internal val playerDefaultDark = mapOf("background" to "#111615", "surface" to "#1A201E", "surfaceRaised" to "#202724", "border" to "#2D3631", "text" to "#F3F6F1", "muted" to "#AAB8B0", "primary" to "#C7F36A", "onPrimary" to "#19230D", "secondary" to "#B5D5A4", "focus" to "#C7F36A", "success" to "#91E5A6", "warning" to "#F6D285", "error" to "#FFADA4")
internal val playerDefaultLight = mapOf("background" to "#F2F5F0", "surface" to "#FFFFFF", "surfaceRaised" to "#E6ECE5", "border" to "#7C897D", "text" to "#18221B", "muted" to "#46584A", "primary" to "#36551B", "onPrimary" to "#FFFFFF", "secondary" to "#325A4D", "focus" to "#36551B", "success" to "#1C6335", "warning" to "#76500B", "error" to "#A12424")
internal fun playerHex(value: String) = Regex("#[0-9a-fA-F]{6}").matches(value)
internal fun playerContrast(first: String, second: String): Double {
    fun luminance(value: String): Double {
        val rgb = value.removePrefix("#").toLong(16)
        val channels = listOf((rgb shr 16) and 255, (rgb shr 8) and 255, rgb and 255).map { val c = it / 255.0; if (c <= .04045) c / 12.92 else ((c + .055) / 1.055).pow(2.4) }
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    }
    val a = luminance(first); val b = luminance(second)
    return (maxOf(a, b) + .05) / (minOf(a, b) + .05)
}
internal fun playerReadableInk(background: String) = if (playerContrast(background, "#111111") >= playerContrast(background, "#FFFFFF")) "#111111" else "#FFFFFF"
/** Preserve the original white/lime wordmark on dark surfaces; a light header
 * needs one readable ink colour for the same transparent logo silhouette. */
internal fun playerWordmarkTint(tokens: Map<String, String>): String? = if (playerContrast("#FFFFFF", tokens.getValue("background")) >= 4.5) null else tokens.getValue("text").takeIf { playerContrast(it, tokens.getValue("background")) >= 4.5 } ?: playerReadableInk(tokens.getValue("background"))
internal fun playerThemeTokens(value: JSONObject?, dark: Boolean): Map<String, String> {
    val defaults = if (dark) playerDefaultDark else playerDefaultLight
    if (value == null || playerThemeKeys.any { !playerHex(value.text(it)) }) return defaults
    val result = playerThemeKeys.associateWith { value.text(it) }.toMutableMap()
    if (playerContrast(result.getValue("primary"), result.getValue("onPrimary")) < 4.5) result["onPrimary"] = playerReadableInk(result.getValue("primary"))
    for (key in listOf("text", "muted")) if (playerContrast(result.getValue("surface"), result.getValue(key)) < 4.5 || playerContrast(result.getValue("background"), result.getValue(key)) < 4.5) result[key] = defaults.getValue(key)
    return result
}
/** A previously validated response is display-only, expires in at most five minutes,
 * and cannot make an unrelated club page inherit a personal club preference. */
internal fun playerBoundedTheme(value: JSONObject, now: Long, clubContext: String?): JSONObject? = runCatching {
    val effective = value.obj("effective")
    val until = Instant.parse(effective.text("validUntil")).toEpochMilli()
    require(until > now)
    require(clubContext == null || effective.text("clubId").isBlank() || effective.text("clubId") == clubContext)
    for (mode in listOf("light", "dark")) require(playerThemeKeys.all { playerHex(effective.obj("tokens").obj(mode).text(it)) })
    JSONObject(value.toString()).also { it.obj("effective").put("validUntil", Instant.ofEpochMilli(minOf(until, now + 5 * 60_000)).toString()) }
}.getOrNull()
internal fun playerThemeContext(screen: PlayerScreen, id: String?): String? = when (screen) {
    PlayerScreen.CLUB -> id
    PlayerScreen.CLUBHOUSE, PlayerScreen.CLUB_CHAT, PlayerScreen.CLUB_COMPETITION_WIZARD -> id?.substringBefore('?')
    else -> null
}
internal class PlayerThemeCache(context: Context) {
    private val store = PlayerSessionStore(context, "theme")
    fun read(actor: String, context: String?, now: Long): JSONObject? {
        val data = store.read()
        if (actor.isBlank() || data.text("actorId") != actor || data.text("context") != context.orEmpty()) return null
        return playerBoundedTheme(data.obj("view"), now, context)
    }
    fun write(actor: String, context: String?, view: JSONObject) {
        // No account credential, private club page or membership list is a theme cache.
        val safe = json("preference" to view.obj("preference"), "effective" to view.obj("effective"))
        store.write(json("actorId" to actor, "context" to context.orEmpty(), "view" to safe))
    }
    fun clear() = store.clear()
}

/** Account deletion also erases this feature's private on-device drafts. Ordinary
 * logout leaves an encrypted, account-bound draft available after fresh login. */
internal fun playerEraseClubDrafts(context: Context, actor: String) {
    if (!Regex("[A-Za-z0-9_-]{1,128}").matches(actor)) return
    val prefixes = listOf("competition-wizard", "club-chat-draft", "club-feed-draft").map { "dartflow-player-$it-$actor-" }
    val files = java.io.File(context.applicationInfo.dataDir, "shared_prefs").listFiles().orEmpty()
    val keys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    files.filter { it.name.endsWith("-private-v1.xml") && prefixes.any(it.name::startsWith) }.forEach { file ->
        val preference = file.name.removeSuffix(".xml")
        context.deleteSharedPreferences(preference)
        val slot = preference.removePrefix("dartflow-player-").removeSuffix("-private-v1")
        runCatching { keys.deleteEntry("dartflow-player-$slot-v1") }
    }
}

/** Matches the server's contrast-safe preview derivation; publishing is server-only. */
internal fun playerPreviewThemeTokens(primary: String, secondary: String, dark: Boolean): JSONObject {
    require(playerHex(primary) && playerHex(secondary))
    val surface = if (dark) "#1A201E" else "#FFFFFF"
    fun mix(a: String, b: String): String {
        val components = listOf(1, 3, 5).map { i -> val x = a.substring(i, i + 2).toInt(16); val y = b.substring(i, i + 2).toInt(16); kotlin.math.floor(x + (y - x) * .14 + .5).toInt() }
        return "#" + components.joinToString("") { "%02X".format(java.util.Locale.ROOT, it) }
    }
    fun readable(input: String): String { var color = input.uppercase(); repeat(20) { if (playerContrast(color, surface) < 4.5) color = mix(color, if (dark) "#FFFFFF" else "#000000") }; return color }
    val accent = readable(primary)
    return json("background" to if (dark) "#111615" else "#F4F7F3", "surface" to surface, "surfaceRaised" to if (dark) "#202724" else "#E8EEE8", "border" to if (dark) "#65736B" else "#6A786F", "text" to if (dark) "#F3F6F1" else "#17231B", "muted" to if (dark) "#A6B3AA" else "#526257", "primary" to accent, "onPrimary" to if (playerContrast(accent, "#111615") >= playerContrast(accent, "#FFFFFF")) "#111615" else "#FFFFFF", "secondary" to readable(secondary), "focus" to accent, "success" to if (dark) "#8CE3A3" else "#176635", "warning" to if (dark) "#FFD47A" else "#775200", "error" to if (dark) "#FFADAD" else "#A3192B")
}
