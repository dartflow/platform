package nl.dartflow.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

internal val playerClubPermissionLabels = linkedMapOf("members.invite" to "Leden uitnodigen", "members.approve" to "Aanmeldingen beoordelen", "members.manage" to "Lidmaatschappen beheren", "chat.moderate" to "Chat modereren", "competitions.manage" to "Competities beheren", "tournaments.manage" to "Toernooien beheren", "settings.edit" to "Verenigingsinstellingen wijzigen", "branding.manage" to "Clubuitstraling beheren", "calendar.manage" to "Clubagenda beheren", "teams.manage" to "Teams beheren", "tasks.manage" to "Taken en vrijwilligers beheren", "dues.manage" to "Contributie beheren", "channels.manage" to "Chatkanalen beheren")

@Composable internal fun PlayerThemePreference(state: PlayerUiState, actions: PlayerActions) {
    val data = state.theme; val preference = data.obj("preference")
    if (preference.length() == 0) return
    var mode by rememberSaveable(preference.optInt("revision")) { mutableStateOf(preference.text("mode", "auto")) }; var club by rememberSaveable(preference.optInt("revision")) { mutableStateOf(preference.text("clubId")) }; var colorMode by rememberSaveable(preference.optInt("revision")) { mutableStateOf(preference.text("colorMode", "system")) }
    PlayerCard("Mijn DartFlow-uitstraling") {
        Text("Je persoonlijke voorkeur synchroniseert met web. Een geopende verenigingspagina gebruikt altijd haar eigen geldige huisstijl.", color = PlayerMuted)
        if (data.optBoolean("needsChoice")) Notice("Kies bewust een vereniging of standaard DartFlow. Er wordt geen willekeurige club gekozen.")
        Choice("Persoonlijke huisstijl", mode, listOf("auto" to "Automatisch", "dartflow" to "Standaard DartFlow", "club" to "Mijn premiumvereniging"), { mode = it }, !state.busy)
        if (mode != "dartflow") Choice("Voorkeursvereniging", club, listOf("" to "Geen expliciete keuze") + data.rows("options").map { it.text("clubId") to it.text("name") }, { club = it }, !state.busy)
        Choice("Licht en donker", colorMode, listOf("system" to "Systeemvoorkeur", "light" to "Licht", "dark" to "Donker"), { colorMode = it }, !state.busy)
        Action("Uitstraling opslaan", state.online && !state.busy && (mode != "club" || data.rows("options").any { it.text("clubId") == club })) { actions.command("/theme/actions", json("requestId" to UUID.randomUUID().toString(), "expectedRevision" to preference.optInt("revision"), "action" to json("type" to "preference", "mode" to mode, "clubId" to club.takeIf { mode != "dartflow" && it.isNotBlank() }, "colorMode" to colorMode))) }
    }
}
@Composable internal fun PlayerClubManagement(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val club = view.obj("club"); val id = club.text("id"); val details = club.obj("clubDetails"); val enabled = !state.busy && state.online
    if (playerClubPermission(view, "settings.edit")) PlayerCard("Profiel en toelating") {
        var name by rememberSaveable(id) { mutableStateOf(club.text("name")) }; var description by rememberSaveable(id) { mutableStateOf(club.obj("state").text("description")) }; var introduction by rememberSaveable(id) { mutableStateOf(details.text("intakeIntroduction")) }; var policy by rememberSaveable(id) { mutableStateOf(details.text("joinPolicy", "intake")) }; var questions by rememberSaveable(id) { mutableStateOf(details.optJSONArray("intakeQuestions")?.toString() ?: "[]") }
        Field("Verenigingsnaam", name, { name = it }, max = 80); Field("Clubbeschrijving", description, { description = it }, multiline = true, max = 2000)
        Choice("Toelating", policy, listOf("open" to "Open", "intake" to "Op aanvraag", "invite" to "Alleen op uitnodiging", "closed" to "Gesloten"), { policy = it }, enabled)
        Field("Welkom en intake-uitleg", introduction, { introduction = it }, multiline = true, max = 2000)
        JSONArray(questions).objects().forEachIndexed { index, question ->
            fun update(key: String, value: Any) { val rows = JSONArray(questions); rows.getJSONObject(index).put(key, value); questions = rows.toString() }
            Field("Intakevraag ${index + 1}", question.text("label"), { update("label", it) }, max = 160)
            Choice("Antwoordtype ${index + 1}", question.text("type", "text"), listOf("text" to "Korte tekst", "textarea" to "Lange tekst", "select" to "Keuze"), { update("type", it) })
            PlayerToggle("Vraag ${index + 1} verplicht", question.optBoolean("required"), enabled) { update("required", it) }
            if (question.text("type") == "select") Field("Antwoordkeuzes (één per regel)", question.optJSONArray("options")?.strings()?.joinToString("\n").orEmpty(), { update("options", JSONArray(it.lines().filter(String::isNotBlank))) }, multiline = true, max = 1000)
            Action("Vraag ${index + 1} verwijderen", enabled, false) { questions = JSONArray(JSONArray(questions).objects().filterIndexed { i, _ -> i != index }).toString() }
        }
        Action("Intakevraag toevoegen", enabled, false) { questions = JSONArray(JSONArray(questions).objects() + json("id" to UUID.randomUUID().toString(), "label" to "", "type" to "text", "required" to false, "options" to JSONArray())).toString() }
        Action("Clubinstellingen opslaan", enabled && name.isNotBlank()) { actions.platformAction(json("type" to "club.settings", "id" to id, "name" to name, "description" to description, "joinPolicy" to policy, "intakeIntroduction" to introduction, "intakeQuestions" to JSONArray(questions))) }
    }
    PlayerClubModeration(view, state, actions)
    PlayerClubBrandingEditor(view, state, actions)
    if (club.obj("clubAccess").optBoolean("canManageRoles")) PlayerCard("Verenigingsrollen en rechten") {
        details.rows("roles").forEach { role ->
            Text(role.text("name"), color = PlayerLime); Text(role.optJSONArray("permissions")?.strings()?.joinToString(" · ") { playerClubPermissionLabels[it] ?: it }.orEmpty().ifBlank { "Geen algemene beheerrechten" }, color = PlayerMuted)
            if (!role.optBoolean("builtin")) {
                var edit by rememberSaveable(role.text("id")) { mutableStateOf(false) }; var customName by rememberSaveable(role.text("id")) { mutableStateOf(role.text("name")) }; var customPermissions by rememberSaveable(role.text("id")) { mutableStateOf(role.optJSONArray("permissions")?.strings().orEmpty()) }
                Action("Rol ${role.text("name")} bewerken", enabled, false) { edit = !edit }
                if (edit) { Field("Nieuwe rolnaam", customName, { customName = it }, enabled, max = 64); playerClubPermissionLabels.forEach { (key, label) -> PlayerToggle(label, key in customPermissions, enabled) { checked -> customPermissions = playerWizardSelection(customPermissions, key, checked) } }; Action("Rolwijziging opslaan", enabled && customName.isNotBlank()) { actions.platformAction(json("type" to "club.role.save", "id" to id, "roleId" to role.text("id"), "name" to customName, "permissions" to JSONArray(customPermissions))) }; Action("Eigen rol verwijderen", enabled, false) { actions.platformAction(json("type" to "club.role.delete", "id" to id, "roleId" to role.text("id"))) } }
            }
        }
        var roleName by rememberSaveable { mutableStateOf("") }; var permissions by rememberSaveable { mutableStateOf(emptyList<String>()) }
        Field("Naam nieuwe rol", roleName, { roleName = it }, max = 64)
        listOf("members.invite", "members.approve", "members.manage", "chat.moderate", "competitions.manage", "tournaments.manage", "settings.edit", "branding.manage", "calendar.manage", "teams.manage", "tasks.manage", "dues.manage", "channels.manage").forEach { permission -> PlayerToggle(playerClubPermissionLabels[permission] ?: permission, permission in permissions, enabled) { checked -> permissions = if (checked) permissions + permission else permissions - permission } }
        Action("Eigen rol maken", enabled && roleName.isNotBlank()) { actions.platformAction(json("type" to "club.role.save", "id" to id, "name" to roleName, "permissions" to JSONArray(permissions))) }
    }
    val offer = view.obj("ownershipTransfer")
    if (club.obj("clubAccess").optBoolean("isOwner")) PlayerCard("Eigendom gecontroleerd overdragen") {
        var recipient by rememberSaveable { mutableStateOf("") }; var confirm by remember { mutableStateOf(false) }
        Choice("Nieuwe eigenaar", recipient, listOf("" to "Kies actief clublid") + playerClubMembers(view).filter { it.text("id") != state.profile?.id }.map { it.text("id") to playerPublicName(it) }, { recipient = it }, enabled)
        Text("De ontvanger moet zelf accepteren. Tot die tijd blijf jij eigenaar.", color = PlayerMuted)
        Action("Overdracht aanbieden", enabled && recipient.isNotBlank()) { confirm = true }
        if (offer.length() > 0) { Text("Aanbod geldig tot ${shortDate(offer.text("expiresAt"))}", color = PlayerMuted); Action("Overdrachtsaanbod intrekken", enabled, false) { playerClubhouseAction(actions, id, "ownership.cancel") } }
        if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Overdracht aanbieden?") }, text = { Text("Alleen het gekozen actieve lid kan dit aanbod accepteren. Beheerrechten worden pas daarna overgedragen.") }, confirmButton = { TextButton(onClick = { confirm = false; playerClubhouseAction(actions, id, "ownership.offer", json("recipientId" to recipient)) }) { Text("Aanbod bevestigen") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Annuleren") } })
    }
    if (offer.text("recipientId") == state.profile?.id) PlayerCard("Aanbod om eigenaar te worden") { Text("Aanvaard bewust het beheer van deze vereniging. Geldig tot ${shortDate(offer.text("expiresAt"))}."); var confirm by remember { mutableStateOf(false) }; Action("Eigendom accepteren", enabled) { confirm = true }; if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Eigenaar worden?") }, text = { Text("De huidige eigenaar draagt het volledige verenigingsbeheer aan jou over.") }, confirmButton = { TextButton(onClick = { confirm = false; playerClubhouseAction(actions, id, "ownership.accept", json("transferId" to offer.text("id"))) }) { Text("Accepteren") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Annuleren") } }) }
}
@Suppress("DEPRECATION")
internal fun playerClubLogoBytes(bytes: ByteArray): String {
    require(bytes.size <= 8_000_000)
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }; android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    require(bounds.outWidth in 1..20000 && bounds.outHeight in 1..20000 && bounds.outMimeType in listOf("image/png", "image/jpeg", "image/webp")) { "Kies een PNG-, JPEG- of WebP-afbeelding." }
    val options = android.graphics.BitmapFactory.Options(); while (maxOf(bounds.outWidth, bounds.outHeight) / options.inSampleSize.coerceAtLeast(1) > 1024) options.inSampleSize = options.inSampleSize.coerceAtLeast(1) * 2
    val decoded = requireNotNull(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options))
    val orientation = runCatching { android.media.ExifInterface(java.io.ByteArrayInputStream(bytes)).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)
    val matrix = android.graphics.Matrix().apply { when (orientation) { 2 -> setScale(-1f, 1f); 3 -> setRotate(180f); 4 -> { setRotate(180f); postScale(-1f, 1f) }; 5 -> { setRotate(90f); postScale(-1f, 1f) }; 6 -> setRotate(90f); 7 -> { setRotate(270f); postScale(-1f, 1f) }; 8 -> setRotate(270f) } }
    val bitmap = if (orientation in 2..8) android.graphics.Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true) else decoded
    val scale = minOf(1.0, 512.0 / maxOf(bitmap.width, bitmap.height)); val resized = android.graphics.Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
    val output = java.io.ByteArrayOutputStream(); resized.compress(android.graphics.Bitmap.CompressFormat.WEBP, 85, output)
    require(output.size() <= 96 * 1024) { "Kies een eenvoudiger afbeelding van maximaal 96 KiB na verkleinen." }
    return "data:image/webp;base64," + android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP)
}
@Composable private fun PlayerClubBrandingEditor(view: JSONObject, state: PlayerUiState, actions: PlayerActions) {
    val branding = view.obj("branding"); if (!branding.optBoolean("canManage")) return
    val context = LocalContext.current; val clubId = view.obj("club").text("id"); val draft = branding.optJSONObject("draft") ?: branding.obj("published")
    var primary by rememberSaveable(clubId) { mutableStateOf(draft.text("primary", "#C7F36A")) }; var secondary by rememberSaveable(clubId) { mutableStateOf(draft.text("secondary", "#8EA7EC")) }; var name by rememberSaveable(clubId) { mutableStateOf(draft.text("name", view.obj("club").text("name"))) }; var logo by rememberSaveable(clubId) { mutableStateOf(draft.text("logoData")) }; var revision by rememberSaveable(clubId) { mutableIntStateOf(branding.optInt("revision")) }; var error by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) runCatching { val raw = context.contentResolver.openInputStream(uri)?.use { playerReadBounded(it, 8_000_000) } ?: throw IllegalArgumentException("Bestand niet beschikbaar"); logo = playerClubLogoBytes(raw) }.onFailure { error = it.message ?: "Dit logo kan niet worden gebruikt." } }
    PlayerCard("Premium clubuitstraling") {
        Text(if (branding.obj("entitlement").optBoolean("effective")) "Premium actief · gepubliceerd ontwerp ${branding.optInt("publishedRevision")}" else "Geen actief premiumrecht. Je ontwerp blijft bewaard; publiceren is niet beschikbaar.", color = PlayerMuted)
        Field("Naam huisstijl", name, { name = it }, max = 80); Field("Primaire clubkleur", primary, { primary = it }, error = if (playerHex(primary)) null else "Gebruik # en zes hexadecimale cijfers", max = 7); Field("Tweede clubkleur", secondary, { secondary = it }, max = 7)
        Action("Logo kiezen", !state.busy, false) { picker.launch(arrayOf("image/png", "image/jpeg", "image/webp")) }; if (logo.isNotBlank()) { PlayerClubLogo(logo, name); Action("Logo verwijderen", primary = false) { logo = "" } }
        if (revision != branding.optInt("revision")) Notice("De huisstijlversie is gewijzigd. Je invoer is behouden; laad bewust het nieuwste concept voor je verder publiceert.", true)
        Action("Nieuwste huisstijlconcept laden", state.online && !state.busy, false) { primary = draft.text("primary", "#C7F36A"); secondary = draft.text("secondary", "#8EA7EC"); name = draft.text("name", view.obj("club").text("name")); logo = draft.text("logoData"); revision = branding.optInt("revision") }
        if (playerHex(primary) && playerHex(secondary)) {
            val preview = JSONObject(view.obj("theme").toString()).also { it.obj("effective").put("validUntil", Instant.now().plusSeconds(300).toString()).put("tokens", json("light" to playerPreviewThemeTokens(primary, secondary, false), "dark" to playerPreviewThemeTokens(primary, secondary, true))) }
            DartFlowPlayerTheme(preview) { PlayerCard("Persoonlijke conceptpreview · $name") { Heading("Clubhouse"); Text("Voorbeeld van de clubopmaak"); Field("Voorbeeldformulier", "", {}, enabled = false); Action("Voorbeeldactie", false) {}; Text("Chat en keuzemenu's volgen dezelfde kleuren. Deze preview publiceert niets.", color = PlayerMuted) } }
        }
        error?.let { Notice(it, true) }
        Action("Huisstijlconcept opslaan", state.online && !state.busy && name.isNotBlank() && playerHex(primary) && playerHex(secondary)) { playerClubhouseAction(actions, clubId, "branding.save", json("design" to json("name" to name, "primary" to primary, "secondary" to secondary, "logoData" to logo.ifBlank { null })), revision) }
        Action("Opgeslagen huisstijl publiceren", state.online && !state.busy && branding.obj("entitlement").optBoolean("effective") && branding.obj("draft").length() > 0) { playerClubhouseAction(actions, clubId, "branding.publish", revision = branding.optInt("revision")) }
    }
}
