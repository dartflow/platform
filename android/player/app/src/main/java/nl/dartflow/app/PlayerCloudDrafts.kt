package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject
import java.util.UUID

/** Scope changes create a distinct draft; revisions never silently overwrite another editor. */
internal fun playerCloudDraftContext(kind: String, ownership: String, clubId: String) = "$kind:$ownership:${if (ownership == "club") clubId else ""}"

@Composable internal fun PlayerCloudDraftPanel(state: PlayerUiState, actions: PlayerActions, kind: String, ownership: String, clubId: String, name: String, step: String, values: JSONObject, onResume: (JSONObject) -> Unit) {
    var selected by rememberSaveable { mutableStateOf("") }
    var revision by rememberSaveable { mutableIntStateOf(0) }
    var savedContext by rememberSaveable { mutableStateOf("") }
    var delete by remember { mutableStateOf<JSONObject?>(null) }
    val context = playerCloudDraftContext(kind, ownership, clubId)
    val accepted = state.organizerCloudDraft
    LaunchedEffect(accepted.toString()) {
        if (accepted.text("id") == selected && playerCloudDraftContext(accepted.text("kind"), accepted.text("ownership"), accepted.text("clubId")) == context) revision = accepted.optInt("revision")
    }
    val enabled = !state.busy && state.online && (ownership != "club" || clubId.isNotBlank())
    val drafts = state.resource.rows("drafts").filter { it.text("kind") == kind && it.optBoolean("canEdit") }
    PlayerCard("Bewaarde concepten") {
        Text(if (ownership == "club") "Verenigingsconcepten zijn gedeeld met bevoegde organisatoren. Iedere wijziging controleert de actuele rechten en revisie." else "Bewaar je concept op je account en hervat op een ander apparaat.", color = PlayerMuted)
        if (selected.isNotBlank() && savedContext == context) Text("Actief concept · revisie $revision", color = PlayerLime)
        Action(if (selected.isBlank() || savedContext != context) "Bewaar nieuw accountconcept" else "Werk accountconcept bij", enabled) {
            val same = selected.isNotBlank() && savedContext == context
            val id = if (same) selected else UUID.randomUUID().toString()
            if (!same) { selected = id; revision = 0; savedContext = context }
            actions.command("/organizer-drafts/actions", json("action" to json("type" to "draft.save", "id" to id, "expectedRevision" to if (same) revision else 0, "kind" to kind, "ownership" to ownership, "clubId" to if (ownership == "club") clubId else JSONObject.NULL, "name" to name.trim().ifBlank { "Naamloos concept" }, "step" to step, "values" to values)))
        }
        drafts.forEach { draft ->
            Text("${draft.text("name")} · revisie ${draft.optInt("revision")} · ${shortDate(draft.text("updatedAt"))}")
            Column {
                Action("Hervat ${draft.text("name")}", !state.busy, false) { selected = draft.text("id"); revision = draft.optInt("revision"); savedContext = playerCloudDraftContext(kind, draft.text("ownership"), draft.text("clubId")); onResume(JSONObject(draft.obj("values").toString()).put("ownership", draft.text("ownership")).put("clubId", draft.text("clubId"))) }
                TextButton(onClick = { delete = draft }, enabled = enabled) { Text("Verwijderen") }
            }
        }
        if (drafts.isEmpty() && !state.loading) Text("Nog geen accountconcepten beschikbaar.", color = PlayerMuted)
        Text("Bij een revisieconflict blijft jouw invoer staan. Hervatten vervangt jouw formulier door de gekozen serverversie.", color = PlayerMuted)
    }
    delete?.let { draft -> AlertDialog(onDismissRequest = { delete = null }, title = { Text("Concept verwijderen?") }, text = { Text("Verwijder ${draft.text("name")} op revisie ${draft.optInt("revision")}. Andere bevoegde organisatoren kunnen dit concept daarna niet hervatten.") }, confirmButton = { TextButton(onClick = { delete = null; if (selected == draft.text("id")) { selected = ""; revision = 0; savedContext = "" }; actions.command("/organizer-drafts/actions", json("action" to json("type" to "draft.delete", "id" to draft.text("id"), "expectedRevision" to draft.optInt("revision")))) }, enabled = enabled) { Text("Verwijder concept") } }, dismissButton = { TextButton(onClick = { delete = null }) { Text("Annuleren") } }) }
}
