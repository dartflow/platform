package nl.dartflow.app

import java.net.URI

internal val playerClubPages = linkedMapOf("overview" to "Overzicht", "feed" to "Verenigingsfeed", "calendar" to "Agenda", "members" to "Leden en aanvragen", "teams" to "Teams", "competitions" to "Competities", "matches" to "Wedstrijden en partijen", "locations" to "Locaties, banen en Oche Live", "tasks" to "Taken en vrijwilligers", "dues" to "Contributie", "manage" to "Verenigingsbeheer")
internal fun playerClubPage(value: String?): String? = value?.takeIf { it in playerClubPages } ?: mapOf("agenda" to "calendar", "leden" to "members", "competities" to "competitions", "partijen" to "matches", "locaties" to "locations", "taken" to "tasks", "contributie" to "dues", "beheer" to "manage")[value]
internal data class PlayerClubRoute(val clubId: String, val page: String, val item: String? = null)
internal fun playerClubRoute(value: String?): PlayerClubRoute? = runCatching {
    require(!value.isNullOrBlank())
    val id = value.substringBefore('?')
    require(Regex("[A-Za-z0-9_-]{1,128}").matches(id))
    val query = PlayerLinks.query(URI("https://native.invalid/?${value.substringAfter('?', "")}"))
    val page = query["page"] ?: "overview"; require(page in playerClubPages)
    val item = query["item"]?.also { require(Regex("[A-Za-z0-9_-]{1,128}").matches(it)) }
    PlayerClubRoute(id, page, item)
}.getOrNull()
internal fun playerClubId(id: String, page: String = "overview", item: String? = null): String {
    require(page in playerClubPages)
    return id + "?page=" + page + (item?.let { "&item=${PlayerLinks.encode(it)}" } ?: "")
}
