package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** name is the server's public compatibility label. Private fields are never a fallback. */
internal fun playerPublicName(value: JSONObject): String = listOf("displayName", "username", "name").firstNotNullOfOrNull { key -> value.text(key).takeIf { it.isNotBlank() } } ?: "Speler"
internal fun playerPublicHandle(value: JSONObject): String? = value.text("username").takeIf(PlayerValidation::validUsername)?.let { "@${PlayerValidation.normalizeUsername(it)}" }
internal fun playerPublicSearchResult(value: JSONObject): JSONObject {
    val display = value.text("displayName").takeIf(PlayerValidation::validName)?.let(PlayerValidation::normalizeName)
    val username = value.text("username").takeIf(PlayerValidation::validUsername)?.let(PlayerValidation::normalizeUsername)
    return json("id" to value.text("id"), "name" to (display ?: username?.let { "@$it" } ?: "Speler"), "displayName" to display, "username" to username, "avatar" to playerAvatarUrl(value.text("avatar")))
}
internal fun playerSearchMatches(player: JSONObject, query: String): Boolean {
    val normalized = java.text.Normalizer.normalize(query, java.text.Normalizer.Form.NFKC).removePrefix("@").lowercase(java.util.Locale.ROOT).trim()
    if (normalized.isBlank()) return false
    // Do not serialize the entire player or search private identity fields.
    return listOf(player.text("displayName"), player.text("username")).any { java.text.Normalizer.normalize(it, java.text.Normalizer.Form.NFKC).lowercase(java.util.Locale.ROOT).contains(normalized) }
}
internal fun playerIdentityUpdate(profile: PlayerProfile, fullName: String, displayName: String, username: String): JSONObject {
    require(PlayerValidation.validFullName(fullName)) { "Vul een geldige volledige naam in of laat dit privéveld leeg." }
    require(PlayerValidation.validName(displayName)) { "Vul een geldige displaynaam in." }
    require(profile.usernameLocked || PlayerValidation.validUsername(username)) { "Kies een gebruikersnaam zonder witruimte of onzichtbare tekens." }
    return json("type" to "profile.update", "fullName" to fullName.takeIf { it.isNotBlank() }?.let(PlayerValidation::normalizeName), "displayName" to PlayerValidation.normalizeName(displayName)).also {
        if (!profile.usernameLocked) it.put("username", PlayerValidation.normalizeUsername(username))
    }
}
internal fun playerAvatarUrl(value: String): String? = runCatching { java.net.URI(value).let { uri -> require(value.length <= 2048 && uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.port in listOf(-1, 443)); value } }.getOrNull()
private suspend fun playerAvatarBitmap(url: String): ImageBitmap? = withContext(Dispatchers.IO) {
    runCatching {
        val connection = java.net.URL(url).openConnection() as javax.net.ssl.HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 4000; connection.readTimeout = 4000; connection.useCaches = false
            require(connection.responseCode == 200 && connection.contentType?.startsWith("image/") == true)
            val bytes = connection.inputStream.use { input -> val result = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192); while (true) { val size = input.read(buffer); if (size < 0) break; require(result.size() + size <= 1_048_576); result.write(buffer, 0, size) }; result.toByteArray() }
            val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            require(options.outWidth in 1..8192 && options.outHeight in 1..8192)
            options.inJustDecodeBounds = false; options.inSampleSize = 1
            while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 256) options.inSampleSize *= 2
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
        } finally { connection.disconnect() }
    }.getOrNull()
}

@Composable internal fun PlayerIdentityFields(profile: PlayerProfile, enabled: Boolean, fullName: String, onFullName: (String) -> Unit, displayName: String, onDisplay: (String) -> Unit, username: String, onUsername: (String) -> Unit, actions: PlayerActions): Boolean {
    var availability by remember(profile.id, username) { mutableStateOf<JSONObject?>(null) }
    var availabilityError by remember(profile.id, username) { mutableStateOf<String?>(null) }
    var checkAttempt by remember(profile.id) { mutableIntStateOf(0) }
    LaunchedEffect(profile.id, username, profile.usernameLocked, enabled, checkAttempt) {
        if (!enabled || profile.usernameLocked || !PlayerValidation.validUsername(username)) return@LaunchedEffect
        availability = null; availabilityError = null
        delay(400)
        try { availability = actions.read("/profile/username-availability?username=${PlayerLinks.encode(username)}") }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { availabilityError = "Beschikbaarheid kon niet worden gecontroleerd. Controleer je verbinding en probeer opnieuw." }
    }
    Field("Volledige naam", fullName, onFullName, enabled, error = if (!PlayerValidation.validFullName(fullName)) "Gebruik maximaal 160 tekens zonder onzichtbare tekens." else null, max = 160)
    Text("Privé: alleen voor jou en bevoegde administratieve handelingen die je persoonlijke naam nodig hebben.", color = PlayerMuted, fontSize = 12.sp)
    Field("Displaynaam", displayName, onDisplay, enabled, error = if (displayName.isNotEmpty() && !PlayerValidation.validName(displayName)) "Gebruik een herkenbare openbare naam van maximaal 80 tekens." else null, max = 80)
    Text("Openbaar op scorekaarten, in zoekresultaten en bij sociale meldingen. Spaties en dezelfde displaynaam als een andere speler zijn toegestaan.", color = PlayerMuted, fontSize = 12.sp)
    if (profile.usernameLocked) {
        Text("Gebruikersnaam", color = PlayerMuted, fontSize = 12.sp)
        Text("@${profile.username}", fontWeight = FontWeight.Bold)
        Text("Definitief vastgelegd. Je gebruikersnaam kan niet worden gewijzigd.", color = PlayerMuted, fontSize = 12.sp)
    } else {
        Field("Gebruikersnaam", username, onUsername, enabled, error = if (username.isNotBlank() && !PlayerValidation.validUsername(username)) "Geen spaties, witruimte of onzichtbare tekens; maximaal 80 tekens." else null, max = 81)
        Text("Uniek, zonder spaties. Hoofdletters maken geen verschil. Na bevestigen staat deze gebruikersnaam vast.", color = PlayerMuted, fontSize = 12.sp)
        if (PlayerValidation.validUsername(username)) Text(availabilityError ?: when {
            availability == null -> "Beschikbaarheid controleren…"
            availability?.optBoolean("valid") != true -> availability?.text("error", "Deze gebruikersnaam is niet geldig.").orEmpty()
            availability?.optBoolean("available") == true -> "@${availability?.text("username")} is beschikbaar."
            else -> availability?.text("error", "Deze gebruikersnaam is al in gebruik. Kies een andere.").orEmpty()
        }, color = if (availability?.optBoolean("available") == true) PlayerLime else PlayerMuted, fontSize = 12.sp)
        if (availabilityError != null) Action("Controleer beschikbaarheid opnieuw", enabled, false) { checkAttempt++ }
    }
    val shown = displayName.takeIf { it.isNotBlank() } ?: profile.username.takeIf { it.isNotBlank() } ?: "Speler"
    val handle = (if (profile.usernameLocked) profile.username else username).takeIf(PlayerValidation::validUsername)?.let { " · @${PlayerValidation.normalizeUsername(it)}" }.orEmpty()
    Text("Anderen zien: $shown$handle", color = PlayerLime)
    if (profile.identityNeedsReview) Text("Controleer je persoonlijke naam en openbare displaynaam. Onduidelijke oude naamgegevens worden niet als privénaam of openbare naam ingevuld.", color = PlayerMuted)
    return PlayerValidation.validFullName(fullName) && PlayerValidation.validName(displayName) && (profile.usernameLocked || PlayerValidation.validUsername(username) && availability?.optBoolean("valid") == true && availability?.optBoolean("available") == true && availability?.text("username") == PlayerValidation.normalizeUsername(username))
}

@Composable internal fun PlayerUsernameConfirmation(username: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Gebruikersnaam definitief vastleggen?") }, text = { Text("Je legt @${PlayerValidation.normalizeUsername(username)} eenmalig vast voor dit account. Je kunt deze gebruikersnaam daarna niet wijzigen. Je volledige naam en displaynaam kun je later wel aanpassen.") }, confirmButton = { TextButton(onClick = onConfirm) { Text("Definitief vastleggen") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Terug") } })
}

@Composable internal fun PlayerPublicIdentity(player: JSONObject) {
    val url = playerAvatarUrl(player.text("avatar"))
    val image by produceState<ImageBitmap?>(null, url) { value = if (url != null && !BuildConfig.LOCAL_FIXTURES) playerAvatarBitmap(url) else null }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (image != null) Image(image!!, contentDescription = null, modifier = Modifier.size(42.dp).clip(CircleShape), contentScale = ContentScale.Crop) else Avatar(playerPublicName(player), Modifier.size(42.dp))
        Column(Modifier.weight(1f)) { Text(playerPublicName(player), fontWeight = FontWeight.Bold); playerPublicHandle(player)?.let { Text(it, color = PlayerMuted, fontSize = 12.sp) } }
    }
}
