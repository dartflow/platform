package nl.dartflow.app

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

data class PlayerDestination(val screen: PlayerScreen, val id: String? = null, val invitationCode: String? = null)
data class PlayerAuthCallback(val code: String, val state: String)
data class PlayerPkce(val verifier: String, val state: String, val createdAt: Long) {
    val challenge: String get() = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
    override fun toString() = "PlayerPkce([redacted])"
    companion object {
        fun create(now: Long = System.currentTimeMillis()): PlayerPkce {
            fun random() = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
            return PlayerPkce(random(), random(), now)
        }
    }
}

object PlayerLinks {
    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
    fun query(uri: URI): Map<String, String> {
        val pairs = uri.rawQuery?.split('&')?.filter { it.isNotBlank() } ?: emptyList()
        val result = mutableMapOf<String, String>()
        for (pair in pairs) {
            val parts = pair.split('=', limit = 2)
            val key = URLDecoder.decode(parts[0], "UTF-8")
            require(!result.containsKey(key)) { "Dubbele linkparameter." }
            result[key] = URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }
        return result
    }
    fun callback(value: String, scheme: String, pending: PlayerPkce?, now: Long = System.currentTimeMillis()): PlayerAuthCallback? = runCatching {
        val uri = URI(value)
        require(uri.scheme == scheme && uri.host == "auth" && uri.path == "/callback" && uri.userInfo == null && uri.port == -1 && uri.fragment == null)
        val params = query(uri)
        require(pending != null && now >= pending.createdAt && now - pending.createdAt < 10 * 60_000L)
        val state = params["state"].orEmpty()
        require(state.isNotEmpty() && MessageDigest.isEqual(state.toByteArray(), pending.state.toByteArray()))
        val code = params["code"].orEmpty()
        require(code.length in 1..2048 && !code.any { it.code < 32 })
        PlayerAuthCallback(code, state)
    }.getOrNull()
    fun destination(value: String, origin: String): PlayerDestination? = runCatching {
        val input = value.trim()
        require(input.length <= 2048)
        val normalized = when {
            Regex("[A-Za-z0-9]{4}|[A-Za-z0-9_-]{24}").matches(input) -> "$origin/w/$input"
            input.startsWith('/') && !input.startsWith("//") -> origin.trimEnd('/') + input
            else -> input
        }
        val uri = URI(normalized)
        val base = URI(origin)
        require(uri.scheme == base.scheme && uri.host == base.host && uri.port == base.port && uri.userInfo == null)
        val path = (uri.fragment?.takeIf { fragment -> listOf("baan-phone/", "match/", "lobby/", "training/", "tournaments/", "leagues/", "clubs/", "seasons/", "locations", "rankings", "help", "faq").any(fragment::startsWith) }?.let { "/$it" } ?: uri.path).trimEnd('/')
        val parts = path.split('/').filter(String::isNotEmpty).let { if (it.firstOrNull() == "app") it.drop(1) else it }
        val id = parts.getOrNull(1)?.takeIf { it.length in 1..128 && it.all { c -> c.isLetterOrDigit() || c in "-_" } }
        val invitation = query(uri)["code"]?.let { code ->
            require(Regex("[A-Za-z0-9]{4}|[A-Za-z0-9_-]{24}").matches(code))
            if (code.length == 4) code.uppercase() else code
        }
        when (parts.firstOrNull()) {
            "w" -> id?.takeIf { it.length in listOf(4, 24) }?.let { PlayerDestination(PlayerScreen.PLAY, invitationCode = if (it.length == 4) it.uppercase() else it) }
            "wedstrijd", "match" -> id?.let { PlayerDestination(PlayerScreen.MATCH, it) }
            "baan", "baan-phone" -> id?.let { PlayerDestination(PlayerScreen.BOARD, it) }
            "lobby" -> id?.let { PlayerDestination(PlayerScreen.LOBBY, it, invitation) }
            "training" -> PlayerDestination(PlayerScreen.TRAINING, id)
            "seasons", "competities" -> PlayerDestination(if (id != null) PlayerScreen.SEASON else PlayerScreen.SEASONS, id)
            "locations" -> PlayerDestination(PlayerScreen.LOCATIONS)
            "feed" -> PlayerDestination(PlayerScreen.FEED)
            "koppel-scherm" -> {
                val code = query(URI("https://native.invalid/?${uri.rawFragment.orEmpty()}"))["code"].orEmpty().uppercase().replace("-", "")
                if (Regex("[A-Z0-9]{8}").matches(code)) PlayerDestination(PlayerScreen.SCREENS, "paircode:$code") else PlayerDestination(PlayerScreen.SCREENS)
            }
            "profiel" -> PlayerDestination(PlayerScreen.PROFILE)
            "spelen" -> PlayerDestination(if (id != null) PlayerScreen.PLAY_SESSION else PlayerScreen.PLAY_START, id)
            "oefenen" -> PlayerDestination(PlayerScreen.PRACTICE)
            "uitdagingen" -> PlayerDestination(PlayerScreen.CHALLENGES, id)
            "speler" -> PlayerDestination(PlayerScreen.PLAY)
            "evenementen", "toernooien", "tournaments", "leagues" -> PlayerDestination(if (id != null) PlayerScreen.EVENT else PlayerScreen.EVENTS, id, invitation)
            "rankings" -> PlayerDestination(PlayerScreen.RANKINGS)
            "handleiding" -> PlayerDestination(PlayerScreen.MANUAL,id)
            "help", "faq" -> {
                val help = query(uri).filter { (key, input) -> key in listOf("q", "category", "id") && input.length <= 200 && input.none { it.code < 32 } }.toMutableMap()
                if (id != null) help["id"] = id
                PlayerDestination(PlayerScreen.HELP, help.entries.joinToString("&") { "${it.key}=${encode(it.value)}" }.ifBlank { null })
            }
            "clubhouse" -> id?.let { PlayerDestination(PlayerScreen.CLUBHOUSE, playerClubId(it, playerClubPage(query(uri)["page"]) ?: playerClubPage(parts.getOrNull(2)) ?: "overview", query(uri)["item"] ?: query(uri)["activity"] ?: query(uri)["post"])) }
            "competition-wizard" -> id?.let { PlayerDestination(PlayerScreen.CLUB_COMPETITION_WIZARD, playerClubId(it)) }
            "verenigingen", "clubs" -> if (id != null && (playerClubPage(query(uri)["page"]) != null || playerClubPage(parts.getOrNull(2)) != null)) PlayerDestination(PlayerScreen.CLUBHOUSE, playerClubId(id, playerClubPage(query(uri)["page"]) ?: requireNotNull(playerClubPage(parts.getOrNull(2))), query(uri)["item"] ?: query(uri)["activity"] ?: query(uri)["post"])) else PlayerDestination(if (id != null) PlayerScreen.CLUB else PlayerScreen.CLUBS, id)
            "organiseren" -> PlayerDestination(PlayerScreen.ORGANIZE)
            "vrienden" -> PlayerDestination(PlayerScreen.FRIENDS)
            "historie" -> PlayerDestination(PlayerScreen.HISTORY)
            else -> null
        }
    }.getOrNull()
    fun googleUrl(authUrl: String, callback: String, pkce: PlayerPkce): String {
        val callbackUri = URI(callback)
        require(callbackUri.scheme == "https" && callbackUri.host != null && callbackUri.userInfo == null)
        val redirect = callback + (if (callbackUri.rawQuery.isNullOrBlank()) "?" else "&") + "state=" + encode(pkce.state)
        return "${authUrl.trimEnd('/')}/auth/v1/authorize?provider=google&redirect_to=${encode(redirect)}&code_challenge=${encode(pkce.challenge)}&code_challenge_method=s256"
    }
}
