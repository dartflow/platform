package nl.dartflow.ochelive

import org.json.JSONObject
import java.time.Instant
import kotlin.math.pow

internal val ocheThemeKeys = listOf("background", "surface", "surfaceRaised", "border", "text", "muted", "primary", "onPrimary", "secondary", "focus", "success", "warning", "error")
data class ClubDisplayTheme(val name: String, val logoData: String?, val brandingRevision: Int, val validUntil: Long, val tokens: Map<String, String>) {
    fun validAt(serverTime: Long) = serverTime < validUntil
    companion object {
        fun parse(value: JSONObject?, serverTime: Long): ClubDisplayTheme? = runCatching {
            require(value != null && value.optInt("version") == 1 && value.optString("id") == "club")
            val name = value.getString("name"); require(name.length in 1..120 && name.none { it.code < 32 })
            val until = Instant.parse(value.getString("validUntil")).toEpochMilli(); require(until > serverTime)
            val bundles = value.getJSONObject("tokens")
            for (mode in listOf("light", "dark")) require(ocheThemeKeys.all { Regex("#[0-9A-Fa-f]{6}").matches(bundles.getJSONObject(mode).optString(it)) })
            val tokens = ocheThemeKeys.associateWith { bundles.getJSONObject("dark").getString(it) }
            for (key in listOf("text", "muted", "primary")) require(ocheThemeContrast(tokens.getValue(key), tokens.getValue("surface")) >= 4.5)
            require(ocheThemeContrast(tokens.getValue("primary"), tokens.getValue("onPrimary")) >= 4.5)
            val logo = value.optString("logoData").takeIf { it.isNotBlank() && it != "null" }
            if (logo != null) require(ocheSafeLogo(logo))
            ClubDisplayTheme(name, logo, value.optInt("brandingRevision").coerceAtLeast(0), minOf(until, serverTime + 300_000), tokens)
        }.getOrNull()
    }
}
internal fun ocheThemeContrast(first: String, second: String): Double {
    fun luminance(value: String): Double { val parts = listOf(1, 3, 5).map { index -> val c = value.substring(index, index + 2).toInt(16) / 255.0; if (c <= .04045) c / 12.92 else ((c + .055) / 1.055).pow(2.4) }; return parts[0] * .2126 + parts[1] * .7152 + parts[2] * .0722 }
    val a = luminance(first); val b = luminance(second); return (maxOf(a, b) + .05) / (minOf(a, b) + .05)
}
internal fun ocheSafeLogo(value: String): Boolean = runCatching {
    require(value.length <= 180_000 && Regex("data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", RegexOption.DOT_MATCHES_ALL).matches(value))
    val bytes = java.util.Base64.getDecoder().decode(value.substringAfter(',')); require(bytes.size <= 131_072)
    val mime = value.substringBefore(';')
    when (mime) {
        "data:image/png" -> bytes.take(8).map { it.toInt() and 255 } == listOf(137, 80, 78, 71, 13, 10, 26, 10)
        "data:image/jpeg" -> bytes.size >= 3 && bytes[0].toInt() and 255 == 255 && bytes[1].toInt() and 255 == 216 && bytes[2].toInt() and 255 == 255
        "data:image/webp" -> bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP"
        else -> false
    }
}.getOrDefault(false)
/** Restarted cached frames cannot establish a current clock or grant. A live
 * frame can retain its palette offline only until the original server deadline. */
internal fun DisplayUi.Screen.activeClubTheme(monotonic: Long): ClubDisplayTheme? = if (cached) null else snapshot.clubTheme?.takeIf { it.validAt(serverAtReceipt + (monotonic - monotonicAtReceipt).coerceAtLeast(0)) }
