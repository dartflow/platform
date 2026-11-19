package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONArray
import org.json.JSONObject

internal fun playerFaqItem(id: String, question: String, answer: String, category: String, keywords: String, audience: String): JSONObject = json("id" to id.trim(), "question" to question.trim(), "answer" to answer.trim(), "category" to category.trim(), "keywords" to JSONArray(keywords.split(',').map { it.trim() }.filter { it.isNotBlank() }.distinct()), "audience" to audience)

@Composable internal fun PlayerFaqAdminScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Gedeelde hulp beheren", "PLATFORMBEHEER")
    if (!state.canManagePlatform) { Notice("Je hebt geen actueel recht om de gedeelde hulp te publiceren.", true); return }
    val published = state.resource.obj("published")
    val drafts = state.resource.rows("drafts")
    var id by rememberSaveable { mutableStateOf("") }
    var revision by rememberSaveable { mutableIntStateOf(0) }
    var question by rememberSaveable { mutableStateOf("") }
    var answer by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }
    var keywords by rememberSaveable { mutableStateOf("") }
    var audience by rememberSaveable { mutableStateOf("all") }
    var reason by rememberSaveable { mutableStateOf("") }
    var preview by rememberSaveable { mutableStateOf(false) }
    var pending by remember { mutableStateOf<JSONObject?>(null) }
    val enabled = !state.busy && state.online
    val receipt = state.faqAdminReceipt.obj("draft")
    LaunchedEffect(receipt.toString()) { if (receipt.text("questionId") == id) revision = receipt.optInt("revision") }
    fun load(item: JSONObject, expected: Int) { id = item.text("id"); question = item.text("question"); answer = item.text("answer"); category = item.text("category"); keywords = item.optJSONArray("keywords")?.strings()?.joinToString(", ").orEmpty(); audience = item.text("audience", "all"); revision = expected }
    PlayerCard("Vraag en antwoord · concept") {
        Text("Gepubliceerde versie ${published.text("version", "Onbekend")} · conceptrevisie $revision", color = PlayerMuted)
        Text("Alle antwoorden zijn openbaar. De doelgroep is een zoeklabel en schermt inhoud niet af.", color = PlayerMuted)
        Action("Begin nieuw helpartikel", enabled, false) { id = ""; question = ""; answer = ""; category = ""; keywords = ""; audience = "all"; revision = 0 }
        Field("Vaste vraagcode · kleine letters en streepjes", id, { id = it }, enabled && revision == 0, max = 100)
        Field("Vraag", question, { question = it }, enabled, max = 240)
        Field("Categorie", category, { category = it }, enabled, max = 100)
        Field("Antwoord", answer, { answer = it }, enabled, max = 12000, multiline = true)
        Field("Zoekwoorden · gescheiden door komma", keywords, { keywords = it }, enabled, max = 2400, multiline = true)
        Choice("Doelgroep", audience, listOf("all" to "Iedereen", "player" to "Spelers", "captain" to "Captains", "organizer" to "Organisatoren", "club" to "Verenigingen", "platform" to "Platformbeheer"), { audience = it }, enabled)
        PlayerToggle("Leesvoorbeeld tonen", preview, true) { preview = it }
        if (preview) { Text(question, style = MaterialTheme.typography.titleLarge); Text(answer) }
        val words = keywords.split(',').map { it.trim() }.filter { it.isNotBlank() }.distinct()
        val valid = Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(id) && question.isNotBlank() && answer.isNotBlank() && category.isNotBlank() && words.size <= 30 && words.all { it.length <= 80 }
        Action("Bewaar hulpconcept", enabled && valid) { actions.command("/faq/admin/actions", json("action" to json("type" to "faq.save", "questionId" to id, "expectedRevision" to revision, "item" to playerFaqItem(id, question, answer, category, keywords, audience)))) }
        Text("Bij een revisieconflict blijft jouw tekst staan. Open de actuele conceptversie om die bewust te vergelijken en te hervatten.", color = PlayerMuted)
    }
    PlayerCard("Publiceren en herstellen") {
        Field("Reden voor publicatie of herstel", reason, { reason = it }, enabled, max = 1000, multiline = true)
        drafts.forEach { draft ->
            Text("${draft.obj("item").text("question")} · revisie ${draft.optInt("revision")}")
            Action("Bewerk concept ${draft.text("questionId")}", enabled, false) { load(draft.obj("item"), draft.optInt("revision")) }
            Action("Publiceer ${draft.text("questionId")}", enabled && reason.isNotBlank(), false) { pending = json("type" to "faq.publish", "draftId" to draft.text("id"), "expectedRevision" to draft.optInt("revision"), "expectedVersion" to published.text("version"), "reason" to reason) }
        }
        state.resource.rows("history").forEach { version ->
            Text("${version.text("version")} · ${shortDate(version.text("createdAt"))}\n${version.text("reason")}", color = PlayerMuted)
            Action("Herstel versie ${version.text("version")}", enabled && reason.isNotBlank(), false) { pending = json("type" to "faq.restore", "publicationId" to version.text("id"), "expectedVersion" to published.text("version"), "reason" to reason) }
        }
    }
    PlayerCard("Gepubliceerde artikelen bewerken") { published.rows("items").forEach { item -> Action(item.text("question"), enabled, false) { val existing = drafts.find { it.text("questionId") == item.text("id") }; load(existing?.obj("item") ?: item, existing?.optInt("revision") ?: 0) } } }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { Text(if (command.text("type") == "faq.restore") "Hulpversie herstellen?" else "Hulpconcept publiceren?") }, text = { Text("Deze inhoud wordt gedeeld door website, desktop en apps. Controleer het leesvoorbeeld. Huidige versie: ${command.text("expectedVersion")}.\nReden: ${command.text("reason")}") }, confirmButton = { TextButton(onClick = { pending = null; actions.command("/faq/admin/actions", json("action" to command)) }, enabled = enabled) { Text("Bevestigen") } }, dismissButton = { TextButton(onClick = { pending = null }) { Text("Annuleren") } }) }
}
