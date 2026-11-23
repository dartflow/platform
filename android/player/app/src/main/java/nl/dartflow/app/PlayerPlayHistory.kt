package nl.dartflow.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

@Composable internal fun PlayerPlayHistoryScreen(state: PlayerUiState, actions: PlayerActions) {
    if(state.activeId?.startsWith("statistics")==true){PlayerPlayStatistics(state,actions);return}
    if(state.session!=null)Action("Mijn spelstatistieken",primary=false){actions.navigate(PlayerScreen.PLAY_HISTORY,"statistics:")}
    Heading("Partijen & herstel", "HISTORIE", if (state.session == null) "Partijen die op dit toestel zijn bewaard. Een persoonlijke link opent je eigen deelname op een ander toestel." else "Jouw accountpartijen en bewaarde gastpartijen gebruiken dezelfde partijidentiteit.")
    Action("Nieuwe vrije partij") { actions.navigate(PlayerScreen.PLAY_START, null) }
    var mode by rememberSaveable{mutableStateOf("")};var source by rememberSaveable{mutableStateOf("")}
    Choice("Spelvorm",mode,listOf("" to "Alle spelvormen")+playerPlayModes.map{it to playerPlayModeName(it)},{mode=it})
    Choice("Herkomst",source,listOf("" to "Alle herkomsten","free" to "Vrij spel","practice" to "Oefeningen","challenge" to "Uitdagingen"),{source=it})
    fun visible(raw:JSONObject)=(mode.isBlank()||PlayerPlaySession(raw).rules.text("mode")==mode)&&(source.isBlank()||raw.text("statisticsClass")==source)
    val active = state.play.sessions.filter(::visible); val history = state.play.history.filter(::visible)
    Text("Vrij spel, oefeningen en uitdagingen behouden hun eigen regelprofiel; er wordt geen gezamenlijke X01-score of officiële ranking van gemaakt.",color=PlayerMuted)
    if(state.canManagePlatform)PlayerPlayPolicy(state,actions)
    if (active.isEmpty() && history.isEmpty()) Text("Nog geen partijen gevonden. Speel een partij of scan je persoonlijke herstel- of claimlink.", color = PlayerMuted)
    listOf("Hervatten" to active, "Afgerond" to history).forEach { (label, rows) ->
        if (rows.isNotEmpty()) Text(label, color = PlayerLime)
        rows.forEach { raw -> val session = PlayerPlaySession(raw); PlayerCard(playerPlayModeName(session.rules.text("mode"))) {
            Text(session.participants.joinToString(" · ") { it.text("name") }, color = PlayerText)
            Text("${statusLabel(raw.text("status"))} · ${session.game.rows("visits").size} beurten · ${playerPlayRulesLabel(session.rules)}", color = PlayerMuted)
            raw.text("recoverExpiresAt").takeIf(String::isNotBlank)?.let { Text("Herstel mogelijk tot ${shortDate(it)}", color = PlayerMuted) }
            Action("Open dezelfde partij") { actions.navigate(PlayerScreen.PLAY_SESSION, session.id) }
        } }
    }
}

@Composable internal fun PlayerPracticeScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Oefenen", "TRAINING", "Solo of samen, met een scorekaart die past bij de gekozen oefening.")
    Action("Finish 72", !state.play.syncing) { actions.navigate(PlayerScreen.PLAY_START, "mode:finish:72:double") }
    val advice = state.play.auxiliary.optJSONObject("advice")
    if (advice != null) PlayerCard("Finishadvies uit jouw geaccepteerde beurten") {
        Text(advice.text("explanation"), color = PlayerMuted)
        Text("Finish ${advice.optInt("target")} · ${advice.optInt("frequency")} keer · ${advice.optInt("windowDays")} dagen · ${playerPlayOutLabel(advice.text("outRule"))}", color = PlayerLime)
        Action("Bewaar dit advies", !state.play.syncing, false) { actions.playAction(json("type" to "advice.save")) }
        Action("Oefen deze finish") { actions.navigate(PlayerScreen.PLAY_START, "mode:finish:${advice.optInt("target")}:${advice.text("outRule")}") }
    } else Text(if (state.session == null) "Persoonlijk finishadvies vraagt een account en echte gespeelde beurten." else "Nog te weinig herhaalde geaccepteerde finishstanden voor een persoonlijk advies.", color = PlayerMuted)
    state.play.auxiliary.optJSONObject("saved")?.takeIf{it.optJSONObject("advice")!=null}?.let { saved -> PlayerCard("Bewaard finishadvies") { Text(saved.obj("advice").text("explanation"),color=PlayerMuted);Action("Wis bewaard advies",!state.play.syncing,false){actions.playAction(json("type" to "advice.clear"))} } }
    val finishHistory=state.play.auxiliary.rows("history");val comparisonOptions=finishHistory.distinctBy{it.text("comparisonKey")}
    var comparison by rememberSaveable{mutableStateOf("")}
    val selectedComparison=comparison.takeIf{key->comparisonOptions.any{it.text("comparisonKey")==key}}?:comparisonOptions.firstOrNull()?.text("comparisonKey").orEmpty()
    if(comparisonOptions.isNotEmpty()){
        Choice("Vergelijk hetzelfde finishreglement",selectedComparison,comparisonOptions.map{it.text("comparisonKey") to playerFinishComparisonLabel(it)},{comparison=it})
        Text("Alleen dezelfde target, uitregel, hoeveelheid pogingen, routehulp en regelversie staan samen.",color=PlayerMuted)
    }
    playerFinishComparable(finishHistory,selectedComparison).take(20).forEach { row -> PlayerCard("Finish ${row.optInt("target")}") { Text(playerFinishComparisonLabel(row),color=PlayerLime);Text("${row.optInt("successes")}/${row.optInt("attempts")} uit · ${row.optInt("darts")} pijlen · dubbelpogingen ${row.text("doubleAttempts","onbekend")} · ${shortDate(row.text("completedAt"))}",color=PlayerMuted);Action("Open trainingsresultaat",primary=false){actions.navigate(PlayerScreen.PLAY_SESSION,row.text("sessionId"))} } }
    listOf("x01", "cricket", "tactics", "around", "bingo", "finish").forEach { mode -> Action(playerPlayModeName(mode), primary = false) { actions.navigate(PlayerScreen.PLAY_START, "mode:$mode") } }
    if (state.session != null) Action("Bestaande bot- en 170-training", primary = false) { actions.navigate(PlayerScreen.TRAINING, null) }
    Action("Trainingen vergelijken & hervatten", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
}

@Composable internal fun PlayerPlayChallengesScreen(state: PlayerUiState, actions: PlayerActions) {
    Heading("Versla mijn leg", "UITDAGINGEN", "Speel tegen een vastgelegde, werkelijk voltooide 301-, 501- of 701-leg. Historische worpen verschijnen pas nadat jouw beurt is verwerkt.")
    if (state.session == null && state.activeId == null) { Notice("Log in voor je eigen uitdagingen. Een gedeelde uitdagingslink kan ook een gastpoging openen."); Action("Inloggen") { actions.navigate(PlayerScreen.HOME, null) }; return }
    var selectedSource by rememberSaveable{mutableStateOf("")}
    val sourceRows=state.play.auxiliary.rows("sources")
    if(sourceRows.isNotEmpty())PlayerCard("Uitdaging maken"){
        Choice("Jouw gespeelde partij",selectedSource,listOf("" to "Kies een bronpartij")+sourceRows.distinctBy{it.text("sourceId")}.map{it.text("sourceId") to it.text("name")},{selectedSource=it},!state.play.syncing)
    }
    sourceRows.find{it.text("sourceId")==selectedSource}?.let{PlayerChallengePublish(it.text("sourceKind"),it.text("sourceId"),it.text("playerId"),state,actions)}
    val context=LocalContext.current
    val rows = state.play.auxiliary.rows("challenges")
    if (rows.isEmpty()) Text("Nog geen uitdagingen. Open een voltooide X01-partij in de historie om een bronleg te delen.", color = PlayerMuted)
    rows.forEach { item -> PlayerCard(item.text("name", "Versla mijn leg")) {
        Text(item.text("sourceName", item.text("playerName")), color = PlayerText)
        item.text("comparison").takeIf(String::isNotBlank)?.let { Text(if (it == "darts") "Vergelijking op betrouwbare pijlen" else "Vergelijking op beurten; dezelfde beurt is gelijk", color = PlayerMuted) }
        val summary=item.obj("sourceSummary")
        Text("${item.text("ownerName")} · ${summary.optInt("startScore")} · ${summary.optInt("visits")} beurten · ${if(summary.isNull("darts")) "pijlaantal onbekend" else "${summary.optInt("darts")} pijlen"}",color=PlayerMuted)
        if(item.optBoolean("sourceChanged"))Notice("De bron is gewijzigd; iedere poging houdt de vastgelegde bronversie.")
        if(item.optBoolean("sourceInvalidated")||item.optBoolean("revoked"))Notice("Deze bron of deellink is ingetrokken. Nieuwe pogingen zijn gesloten.",true)
        var guestName by rememberSaveable(item.text("id")){mutableStateOf("")}
        if(state.session==null)Field("Jouw voornaam",guestName,{guestName=it},!state.play.syncing,max=80)
        Action("Start eigen poging", item.optBoolean("canStart") && !state.play.syncing && (state.session!=null || validPlayerName(guestName))) { actions.playAction(json("type" to "challenge.start", "challengeId" to item.text("id"),"name" to guestName.takeIf(String::isNotBlank))) }
        item.optJSONObject("link")?.let{link->
            var show by rememberSaveable(item.text("id")){mutableStateOf(false)}
            Action("Toon of deel uitdagingslink",primary=false){show=!show}
            if(show){val url=link.text("url").let{if(it.startsWith('/'))BuildConfig.API_ORIGIN+it else it};PlayerPrivateQr(url);Action("Deel deze leg",primary=false){context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT,url),"Deel leguitdaging"))}}
        }
        if (item.optBoolean("canManage")) Action("Sluit nieuwe pogingen", !state.play.syncing, false) { actions.playAction(json("type" to "challenge.revoke", "challengeId" to item.text("id"))) }
    } }
    Action("Mijn pogingen & historie", primary = false) { actions.navigate(PlayerScreen.PLAY_HISTORY, null) }
}

@Composable internal fun PlayerChallengePublish(sourceKind: String, sourceId: String, playerId: String, state: PlayerUiState, actions: PlayerActions) {
    var visibility by rememberSaveable(sourceId) { mutableStateOf("private") }
    var sourceIndex by rememberSaveable(sourceId) { mutableStateOf("") }
    var sources by remember(sourceId) { mutableStateOf(state.play.auxiliary.rows("sources").filter{it.text("sourceId")==sourceId}) }
    var error by remember(sourceId) { mutableStateOf<String?>(null) }
    LaunchedEffect(sourceId) {
        runCatching{actions.read("/play/sources").rows("sources").filter{it.text("sourceId")==sourceId&&it.text("sourceKind")==sourceKind}}
            .onSuccess{sources=it}.onFailure{error="De beschikbare bronlegs konden niet worden opgehaald. Open Uitdagingen en probeer opnieuw."}
    }
    PlayerCard("Maak een uitdaging van jouw voltooide leg") {
        Text("Kies een echte eigen bronleg. De server controleert regelversie en betrouwbare pijlaantallen.", color = PlayerMuted)
        error?.let{Notice(it,true)}
        val source=sources.getOrNull(sourceIndex.toIntOrNull()?:-1)
        Choice("Gespeelde bronleg",sourceIndex,listOf("" to "Kies jouw bronleg")+sources.mapIndexed{index,row->"$index" to "${row.text("name")} · set ${row.optInt("set")} · leg ${row.optInt("leg")}"},{sourceIndex=it},!state.play.syncing)
        if(source!=null&&!source.optBoolean("eligible"))Notice(source.text("reason","Deze bronleg heeft onvoldoende betrouwbare gegevens."),true)
        val publicAllowed=source?.optBoolean("publicAllowed")==true
        Choice("Wie mag proberen?",if(publicAllowed)visibility else "private",listOf("private" to "Alleen ik")+if(publicAllowed)listOf("friends" to "Mijn vrienden","link" to "Wie mijn link ontvangt")else emptyList(),{visibility=it},!state.play.syncing)
        Action("Leg vast als uitdaging",!state.play.syncing&&source?.optBoolean("eligible")==true){
            actions.playAction(json("type" to "challenge.create","sourceKind" to source!!.text("sourceKind"),"sourceId" to source.text("sourceId"),"playerId" to source.text("playerId"),"set" to source.optInt("set"),"leg" to source.optInt("leg"),"visibility" to if(publicAllowed)visibility else "private"))
        }
    }
}

@Composable private fun PlayerPlayPolicy(state:PlayerUiState,actions:PlayerActions){
    var policy by remember{mutableStateOf<JSONObject?>(null)};var claim by rememberSaveable{mutableStateOf("7")};var recovery by rememberSaveable{mutableStateOf("7")}
    LaunchedEffect(state.play.auxiliary.obj("policy").optInt("revision")){
        runCatching{actions.read("/play/policy")}.onSuccess{policy=it;claim=it.optInt("claimDays",7).toString();recovery=it.optInt("recoveryDays",7).toString()}
    }
    policy?.let{p->PlayerCard("Bewaartermijnen · platformeigenaar"){
        Field("Gastresultaat claimen · dagen",claim,{claim=it},!state.play.syncing,max=2)
        Field("Onderbroken partij herstellen · dagen",recovery,{recovery=it},!state.play.syncing,max=2)
        Text("Wijzigingen gelden voor toekomstige partijen. Een bestaande vaste einddatum schuift niet op door openen, delen of opnieuw proberen.",color=PlayerMuted)
        Action("Bewaar termijnen",!state.play.syncing&&claim.toIntOrNull()?.let{it in 1..90}==true&&recovery.toIntOrNull()?.let{it in 1..90}==true){actions.playAction(json("type" to "policy.update","claimDays" to claim.toInt(),"recoveryDays" to recovery.toInt(),"expectedPolicyRevision" to p.optInt("revision")))}
    }}
}
