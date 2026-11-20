package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable internal fun PlayerClubAccountPicker(label: String, selected: String, actions: PlayerActions, choose: (String) -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }; var rows by remember { mutableStateOf(emptyList<JSONObject>()) }; var error by remember { mutableStateOf<String?>(null) }
    Field("Zoek op displaynaam of @gebruikersnaam", search, { search = it }, max = 80)
    LaunchedEffect(search) { delay(300); try { rows = actions.read("/players?search=${PlayerLinks.encode(search)}&offset=0").rows("players"); error = null } catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure; error = (failure as? PlayerApiFailure)?.feedback ?: "Spelers zoeken is tijdelijk niet beschikbaar." } }
    Choice(label, selected, listOf("" to "Kies account") + rows.map { it.text("id") to (playerPublicName(it) + playerPublicHandle(it).orEmpty().let { h -> if (h.isBlank()) "" else " · $h" }) }, choose)
    error?.let { Notice(it, true) }
}
@Composable internal fun PlayerClubMembers(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val club = view.obj("club"); val id = club.text("id"); val details = club.obj("clubDetails"); val enabled = state.online && !state.busy
    var search by rememberSaveable { mutableStateOf("") }; var status by rememberSaveable { mutableStateOf("all") }; var team by rememberSaveable { mutableStateOf("") }
    Field("Zoek clublid", search, { search = it }, max = 80)
    Choice("Lidmaatschap", status, listOf("all" to "Alle zichtbare leden", "active" to "Actief", "pending" to "Aangevraagd", "invited" to "Uitgenodigd", "banned" to "Geschorst", "left" to "Vertrokken"), { status = it })
    Choice("Teamfilter", team, listOf("" to "Alle teams") + view.rows("teams").map { it.text("id") to it.text("name") }, { team = it })
    val selectedTeam = view.rows("teams").find { it.text("id") == team }
    val teamIds = selectedTeam?.let { it.optJSONArray("memberIds")?.strings().orEmpty() + it.optJSONArray("reserveIds")?.strings().orEmpty() }
    club.rows("members").filter { (status == "all" || it.text("status") == status) && (search.isBlank() || playerPublicName(it).contains(search, true) || it.text("username").contains(search.removePrefix("@"), true)) && (teamIds == null || it.text("id") in teamIds) }.forEach { member ->
        PlayerCard(playerPublicName(member)) {
            playerPublicHandle(member)?.takeIf(String::isNotBlank)?.let { Text(it, color = PlayerMuted) }
            Text(if (member.text("status") == "banned") "Geschorst" else statusLabel(member.text("status")), color = PlayerLime)
            Text("Rol: ${statusLabel(member.text("role"))}", color = PlayerMuted)
            if (playerClubPermission(view, "members.manage") && member.text("id") != club.text("ownerId") && (club.obj("clubAccess").optBoolean("isOwner") || member.text("role") in listOf("member", "player") && member.obj("attributes").optJSONArray("clubRoleIds")?.length().let { it == null || it == 0 })) {
                Action(if (member.text("status") == "active") "Lid schorsen" else "Lidmaatschap herstellen", enabled, false) { playerClubhouseAction(actions, id, if (member.text("status") == "active") "member.suspend" else "member.restore", json("userId" to member.text("id"))) }
                if (member.text("status") != "left") Action("Lid verwijderen uit vereniging", enabled, false) { playerClubhouseAction(actions, id, "member.remove", json("userId" to member.text("id"))) }
            }
            if (club.obj("clubAccess").optBoolean("canManageRoles") && member.text("id") != club.text("ownerId")) {
                var role by rememberSaveable(member.text("id")) { mutableStateOf(member.text("role", "member")) }
                var roleIds by rememberSaveable(member.text("id")) { mutableStateOf(member.obj("attributes").optJSONArray("clubRoleIds")?.strings().orEmpty()) }
                Choice("Verenigingsrol", role, details.rows("roles").filter { it.optBoolean("builtin") }.map { it.text("id") to it.text("name") }, { role = it }, enabled)
                details.rows("roles").filter { !it.optBoolean("builtin") }.forEach { custom -> PlayerToggle(custom.text("name"), custom.text("id") in roleIds, enabled) { checked -> roleIds = if (checked) roleIds + custom.text("id") else roleIds - custom.text("id") } }
                Action("Rollen opslaan", enabled) { actions.platformAction(json("type" to "club.member.roles", "id" to id, "userId" to member.text("id"), "role" to role, "roleIds" to JSONArray(roleIds))) }
            }
        }
    }
    if (playerClubPermission(view, "members.invite")) PlayerCard("Lid uitnodigen") {
        var account by rememberSaveable { mutableStateOf("") }; var role by rememberSaveable { mutableStateOf("member") }
        PlayerClubAccountPicker("Account uitnodigen", account, actions) { account = it }
        Choice("Rol bij acceptatie", role, details.rows("roles").filter { it.optBoolean("builtin") && (club.obj("clubAccess").optBoolean("isOwner") || it.text("id") == "member") }.map { it.text("id") to it.text("name") }, { role = it }, enabled)
        Text("Een uitnodiging is nog geen actief lidmaatschap. De gekozen rol gaat pas na acceptatie in.", color = PlayerMuted)
        Action("Uitnodiging versturen", enabled && account.isNotBlank()) { actions.platformAction(json("type" to "club.invite", "id" to id, "userId" to account, "role" to role)) }
        details.rows("invites").forEach { Text("${it.text("name")} · ${statusLabel(it.text("status"))} · ${shortDate(it.text("expiresAt"))}", color = PlayerMuted) }
    }
    if (playerClubPermission(view, "members.approve")) details.rows("requests").filter { it.text("status") == "pending" }.forEach { request -> PlayerCard("Aanmelding · ${request.text("name")}") {
        var reason by rememberSaveable(request.text("id")) { mutableStateOf("") }
        request.rows("answers").forEach { Text("${it.text("label")}: ${it.text("value")}") }
        Field("Toelichting op besluit", reason, { reason = it }, multiline = true, max = 1000)
        Action("Aanmelding goedkeuren", enabled) { actions.platformAction(json("type" to "club.approve", "id" to id, "requestId" to request.text("id"), "reason" to reason)) }
        Action("Aanmelding afwijzen", enabled && reason.isNotBlank(), false) { actions.platformAction(json("type" to "club.reject", "id" to id, "requestId" to request.text("id"), "reason" to reason)) }
    } }
}
@Composable internal fun PlayerClubTeams(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val id = view.obj("club").text("id"); val enabled = state.online && !state.busy; val manage = playerClubPermission(view, "teams.manage")
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    if (manage) Action("Nieuw verenigingsteam", enabled) { editing = "{}" }
    view.rows("teams").forEach { team -> PlayerCard(team.text("name")) {
        val members = playerClubMembers(view); val captain = members.find { it.text("id") == team.text("captainId") }
        Text("Aanvoerder: ${captain?.let(::playerPublicName) ?: "Niet beschikbaar"}", color = PlayerLime)
        Text("Spelers: " + team.optJSONArray("memberIds")?.strings().orEmpty().joinToString(", ") { player -> members.find { it.text("id") == player }?.let(::playerPublicName) ?: "Oud lid" })
        Text("Reserves: " + team.optJSONArray("reserveIds")?.strings().orEmpty().joinToString(", ") { player -> members.find { it.text("id") == player }?.let(::playerPublicName) ?: "Oud lid" }, color = PlayerMuted)
        view.rows("competitions").filter { season -> season.rows("teams").any { it.text("id") == team.text("id") } }.forEach { season -> Action("${season.text("name")} · opstelling en eigen wedstrijdbeschikbaarheid", primary = false) { actions.navigate(PlayerScreen.SEASON, season.text("id")) } }
        if (manage) { Action("Team bewerken", enabled, false) { editing = team.toString() }; if (team.optBoolean("active")) Action("Team archiveren", enabled, false) { playerClubhouseAction(actions, id, "team.archive", json("id" to team.text("id")), team.optInt("revision")) } }
    } }
    if (view.rows("teams").isEmpty()) Text("Nog geen teams aangemaakt.", color = PlayerMuted)
    editing?.let { saved -> key(saved) { val team = JSONObject(saved)
        var name by rememberSaveable { mutableStateOf(team.text("name")) }; var members by rememberSaveable { mutableStateOf(team.optJSONArray("memberIds")?.strings().orEmpty()) }; var reserves by rememberSaveable { mutableStateOf(team.optJSONArray("reserveIds")?.strings().orEmpty()) }; var captain by rememberSaveable { mutableStateOf(team.text("captainId")) }
        PlayerCard("Team samenstellen") {
            Field("Teamnaam", name, { name = it }, max = 80)
            playerClubMembers(view).forEach { member -> val player = member.text("id"); PlayerToggle(playerPublicName(member), player in members, enabled) { chosen -> members = if (chosen) members + player else members - player; reserves = reserves - player }; if (player !in members) PlayerToggle("Reserve: ${playerPublicName(member)}", player in reserves, enabled) { chosen -> reserves = if (chosen) reserves + player else reserves - player } }
            Choice("Aanvoerder", captain, listOf("" to "Kies een vaste speler") + playerClubMembers(view).filter { it.text("id") in members }.map { it.text("id") to playerPublicName(it) }, { captain = it }, enabled)
            Text("Alleen actieve eigen leden. Reserves staan los van de vaste selectie.", color = PlayerMuted)
            Action("Team opslaan", enabled && name.isNotBlank() && captain in members) { playerClubhouseAction(actions, id, "team.save", json("name" to name, "captainId" to captain, "memberIds" to JSONArray(members), "reserveIds" to JSONArray(reserves)).also { if (team.text("id").isNotBlank()) it.put("id", team.text("id")) }, team.optInt("revision")) }
            Action("Bewerking sluiten", primary = false) { editing = null }
        }
    } }
}
