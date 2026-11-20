package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject

internal fun playerFinishComparisonLabel(row:JSONObject)="Finish ${row.optInt("target")} · ${playerPlayOutLabel(row.text("outRule"))} · ${row.optInt("attemptCount")} pogingen · ${if(row.optBoolean("routeHelp"))"routehulp beschikbaar" else "zonder routehulp"} · regels v${row.optInt("ruleVersion")}"
internal fun playerFinishComparable(rows:List<JSONObject>,key:String)=rows.filter{it.text("comparisonKey")==key&&key.isNotBlank()}
internal fun playerPlayStatisticsRuleLabel(rules:JSONObject)=when(rules.text("mode")){
    "finish"->playerFinishComparisonLabel(JSONObject(rules.toString()).put("ruleVersion",rules.optInt("version")))
    "leg-challenge"->"${rules.optInt("startScore")} · ${if(rules.text("inRule")=="double")"dubbel openen" else "open start"} · ${playerPlayOutLabel(rules.text("outRule"))} · vergelijking op ${if(rules.text("comparison")=="darts")"pijlen" else "beurten"}"
    "cricket","tactics"->playerPlayRulesLabel(rules)+" · best of ${rules.optInt("bestOfLegs",1)} legs / ${rules.optInt("bestOfSets",1)} sets"
    else->playerPlayRulesLabel(rules)
}
private fun playSourceLabel(source:String)=when(source){"practice"->"Oefening";"challenge"->"Uitdaging";else->"Vrij spel"}

/** Separate server-defined cohorts; never folds these measures into official singles statistics. */
@Composable internal fun PlayerPlayStatistics(state:PlayerUiState,actions:PlayerActions){
    Heading("Mijn spelstatistieken","VRIJ SPEL & OEFENEN","Eigen en geclaimde afgeronde sessies; ieder regelprofiel wordt afzonderlijk vergeleken.")
    if(state.session==null){Text("Log in om uitsluitend je eigen spelresultaten te bekijken.",color=PlayerMuted);return}
    val data=state.play.auxiliary;val filters=data.obj("filters")
    var mode by rememberSaveable{mutableStateOf(filters.text("mode"))};var source by rememberSaveable{mutableStateOf(filters.text("source"))}
    var start by rememberSaveable{mutableStateOf(filters.text("startScore"))};var inRule by rememberSaveable{mutableStateOf(filters.text("inRule"))};var outRule by rememberSaveable{mutableStateOf(filters.text("outRule"))}
    Choice("Spelvorm",mode,listOf("" to "Alle spelvormen")+playerPlayModes.map{it to playerPlayModeName(it)},{mode=it})
    Choice("Herkomst",source,listOf("" to "Alle herkomsten","free" to "Vrij spel","practice" to "Oefeningen","challenge" to "Uitdagingen"),{source=it})
    if(mode.isBlank()||mode=="x01"){
        Choice("X01 startscore",start,listOf("" to "Alle startscores","301" to "301","501" to "501","701" to "701"),{start=it})
        Choice("X01 openen",inRule,listOf("" to "Alle openingsregels","single" to "Single in","double" to "Dubbel in"),{inRule=it})
        Choice("X01 uitgooien",outRule,listOf("" to "Alle uitregels","double" to "Dubbel uit","straight" to "Straight uit","master" to "Master uit"),{outRule=it})
    }
    Action("Toon deze spelstatistieken",!state.play.syncing){
        val params=linkedMapOf("mode" to mode,"source" to source)
        if(mode.isBlank()||mode=="x01")params.putAll(mapOf("startScore" to start,"inRule" to inRule,"outRule" to outRule))
        val query=params.filterValues(String::isNotBlank).entries.joinToString("&"){"${it.key}=${PlayerLinks.encode(it.value)}"}
        actions.navigate(PlayerScreen.PLAY_HISTORY,"statistics:$query")
    }
    data.optJSONArray("definitions")?.strings()?.forEach{Text(it,color=PlayerMuted)}
    val groups=data.rows("groups");val rows=data.rows("rows")
    if(groups.isEmpty()&&!state.play.syncing)Text("Geen afgeronde eigen sessies voor deze filters.",color=PlayerMuted)
    groups.forEach{group->PlayerCard("${playerPlayModeName(group.text("mode"))} · ${playSourceLabel(group.text("source"))}"){
        Text(playerPlayStatisticsRuleLabel(group.obj("rules")),color=PlayerLime)
        group.obj("rules").optJSONArray("teamSizes")?.let{Text("Spelers per zijde: ${it.ints().joinToString(" / ")}",color=PlayerMuted)}
        Text("${group.optInt("sessions")} sessie(s) · regels v${group.obj("rules").optInt("version",1)}",color=PlayerMuted)
        PlayStatisticsMeasures(group,group.text("mode"))
        rows.filter{it.text("groupId")==group.text("id")}.forEach{row->
            Text(shortDate(row.text("completedAt")),color=PlayerText)
            PlayStatisticsMeasures(row,row.text("mode"))
            Action("Open dit spelresultaat",primary=false){actions.navigate(PlayerScreen.PLAY_SESSION,row.text("sessionId"))}
        }
    }}
    Action("Partijen & herstel",primary=false){actions.navigate(PlayerScreen.PLAY_HISTORY,null)}
}

@Composable private fun PlayStatisticsMeasures(row:JSONObject,mode:String){
    fun known(key:String)=row.has(key)&&!row.isNull(key)
    Text("${row.optInt("visits")} beurten · ${if(known("darts"))"${row.optInt("darts")} gemeten pijlen" else "pijlaantal onbekend"}",color=PlayerMuted)
    if(row.optInt("countingDarts")!=row.optInt("darts",-1))Text("${row.optInt("countingDarts")} getelde pijlen volgens de spelregel",color=PlayerMuted)
    if(known("points"))Text("${row.optInt("points")} punten",color=PlayerMuted)
    if(mode in listOf("x01","leg-challenge"))Text(if(known("average"))"AVG ${number(row.optDouble("average"))}" else "AVG onbekend",color=PlayerLime)
    if(mode in listOf("cricket","tactics"))Text(if(known("marksPerRound"))"MPR ${number(row.optDouble("marksPerRound"))}" else "MPR onbekend",color=PlayerLime)
    if(mode in listOf("x01","finish","leg-challenge"))Text(if(known("doubleAttempts"))"${if(known("doubleHits"))row.text("doubleHits")else "Onbekend aantal"} geraakte dubbels / ${row.optInt("doubleAttempts")} dubbelpogingen${if(known("doublePercentage"))" · ${number(row.optDouble("doublePercentage"))}%" else ""}" else "Dubbelpogingen en dubbelpercentage onbekend",color=PlayerMuted)
    if(known("successes")&&known("attempts"))Text("${row.optInt("successes")} / ${row.optInt("attempts")} geslaagde pogingen",color=PlayerMuted)
}
