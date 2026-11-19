package nl.dartflow.ochelive

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** Explicit public fields only. No capability, account identifier, claim link or future source visit is retained. */
data class PlayDisplay(val id: String, val mode: String, val version: Int, val revision: Long, val status: String,
    val names: List<String>, val current: String, val turn: Int, val set: Int, val leg: Int,
    val remaining: List<Int>, val points: List<Int>, val targets: List<Int>, val marks: List<List<Int>>, val requiredMarks: Int,
    val targetIndex: List<Int>, val targetHits: List<Int>, val hitsPerTarget: Int,
    val card: List<Int>, val cardCode: String, val filled: List<List<Boolean>>, val win: String,
    val attempt: Int, val attemptCount: Int, val dartsLeft: Int, val sourceRemaining: Int, val ownVisits: Int,
    val sourceVisits: List<Pair<Int,Int>>, val result: String?, val deadlineAt: Long, val warningAt: Long,
    val extensionsUsed: Int, val writerName: String, val attempts: List<String>, val pointsEnabled: Boolean, val sourceName:String="",val legs:List<Int> = emptyList(),val sets:List<Int> = emptyList(),val x01Match:Match?=null,val darts:List<Int> = emptyList(),val finishTarget:Int=0,val ownVisitRows:List<Pair<Int,Int>> = emptyList()) {
    val supported get() = version == 1 && mode in listOf("x01", "cricket", "tactics", "around", "bingo", "finish", "leg-challenge") && (mode!="x01"||x01Match!=null)
    val title get() = when (mode) { "x01" -> "X01"; "cricket" -> "CRICKET"; "tactics" -> "TACTICS $requiredMarks"; "around" -> "AROUND THE CLOCK"; "bingo" -> "DUBBELBINGO"; "finish" -> "FINISHTRAINING"; "leg-challenge" -> "VERSLA MIJN LEG"; else -> "APPUPDATE NODIG" }
    companion object {
        fun parse(raw: JSONObject): PlayDisplay {
            val game = raw.optJSONObject("game") ?: JSONObject(); val rules = raw.optJSONObject("rules") ?: game.optJSONObject("rules") ?: JSONObject(); val p = game.optJSONObject("progress") ?: JSONObject()
            val people = raw.optJSONArray("participants").objects().take(16).associate { it.optString("id") to it.optString("name", "Speler").take(80) }
            val sides = game.optJSONArray("sides").objects().take(8)
            val names = sides.map { s -> s.optJSONArray("playerIds")?.let { ids -> (0 until minOf(8, ids.length())).joinToString(" & ") { people[ids.optString(it)] ?: "Speler" } } ?: "Speler" }
            val result = game.optJSONObject("result")?.let { r -> when (r.optString("kind")) { "draw" -> "GELIJKSPEL"; "loss" -> "POGING VERLOREN"; "completed" -> "OEFENING VOLTOOID"; else -> sides.indexOfFirst { it.optString("id") == r.optString("winnerSideId") }.takeIf { it >= 0 }?.let { "GEWONNEN: ${names[it]}" } ?: "PARTIJ VOLTOOID" } }
            fun ints(key: String) = p.optJSONArray(key)?.ints().orEmpty().take(30)
            val mode = rules.optString("mode", raw.optString("mode")); val revealed = p.optInt("revealedSourceVisits").coerceIn(0,300)
            return PlayDisplay(raw.optString("id"), mode, if(raw.optInt("version",1)!=1||game.optInt("ruleVersion",1)!=1)0 else rules.optInt("version", game.optInt("ruleVersion")), raw.optLong("revision"), raw.optString("status"), names, people[game.optString("currentThrowerId")] ?: "Speler", game.optInt("turn"), game.optInt("set",1), game.optInt("leg",1), if (mode in listOf("finish", "leg-challenge")) listOf(p.optInt("remaining")) else ints("remaining"), ints("points"), ints("targets"), (0 until (p.optJSONArray("marks")?.length() ?: 0).coerceAtMost(4)).map { p.optJSONArray("marks")?.optJSONArray(it)?.ints().orEmpty().take(12) }, p.optInt("requiredMarks",3), ints("targetIndex"), ints("targetHits"), rules.optInt("hitsPerTarget",1), ints("card").take(9), p.optString("cardCode").take(100), (0 until (p.optJSONArray("filled")?.length() ?: 0).coerceAtMost(8)).map { i -> (0..8).map { p.optJSONArray("filled")?.optJSONArray(i)?.optBoolean(it) == true } }, rules.optString("win"), p.optInt("attemptNumber",1), rules.optInt("attemptCount",5), p.optInt("dartsLeft",3), p.optInt("sourceRemaining"), p.optInt("ownVisits"), rules.optJSONObject("source")?.optJSONArray("visits").objects().take(revealed).map { it.optInt("score") to it.optInt("remainingAfter") }, result ?: if (game.optString("status") == "replay-required") "GELIJK GESLOTEN · LEG OVERSPELEN" else null, raw.optLong("deadlineAt"), raw.optLong("warningAt"), raw.optInt("extensionsUsed"), raw.optString("writerName").take(160), p.optJSONArray("completed").objects().takeLast(10).map { "${it.optInt("number")}. ${if (it.optBoolean("success")) "UIT" else if (it.optBoolean("bust")) "BUST" else "NIET UIT"} · ${it.optInt("darts")} pijlen" }, rules.optBoolean("points",true),raw.optString("sourceName").take(160),game.optJSONArray("legs")?.ints().orEmpty().take(4),game.optJSONArray("sets")?.ints().orEmpty().take(4),playX01Match(raw),ints("darts"),rules.optInt("target"),game.optJSONArray("visits").objects().take(300).map{it.optInt("score") to it.optInt("remainingAfter")} )
        }
    }
}

/** Official Tactics uses the same readable twelve-row layout while its match/bull flow stays canonical. */
internal fun tacticsDisplay(match:Match):PlayDisplay {
    val marks=requireNotNull(match.cricket)
    val people=org.json.JSONArray(match.players.mapIndexed{index,player->JSONObject().put("id","side-$index").put("name",player.name)})
    val sides=org.json.JSONArray(match.players.indices.map{JSONObject().put("id","side-$it").put("playerIds",org.json.JSONArray(listOf("side-$it")))})
    val progress=JSONObject().put("targets",org.json.JSONArray(marks.targets)).put("requiredMarks",marks.requiredMarks).put("marks",org.json.JSONArray(marks.marks.map{org.json.JSONArray(it)})).put("points",org.json.JSONArray(marks.points))
    val game=JSONObject().put("turn",match.turn).put("currentThrowerId","side-${match.turn}").put("set",match.set).put("leg",match.leg).put("ruleVersion",1).put("legs",org.json.JSONArray(match.players.map{it.legs})).put("sets",org.json.JSONArray(match.players.map{it.sets})).put("sides",sides).put("progress",progress)
    if(match.finished)game.put("result",JSONObject().put("kind","win").put("winnerSideId","side-${match.players.indexOfFirst{it.name==match.winnerName}}"))
    return PlayDisplay.parse(JSONObject().put("id",match.id).put("version",1).put("revision",match.revision).put("status",if(match.finished)"completed" else if(match.paused)"interrupted" else "active").put("rules",JSONObject().put("version",1).put("mode","tactics").put("points",marks.mode!="no-score")).put("participants",people).put("game",game)).copy(current=match.currentThrowerName?:match.players.getOrNull(match.turn)?.name?:"Speler")
}

private val PlayInk:Color @Composable get()=MaterialTheme.colorScheme.background
private val PlayGreen:Color @Composable get()=MaterialTheme.colorScheme.primary
private val PlayMuted = Color(0xFFADB5B0)

@Composable internal fun PlayDisplayView(play: PlayDisplay, landscape: Boolean, serverTime: Long, cached: Boolean) {
    if (!play.supported) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("WERK OCHE LIVE BIJ", color = PlayGreen, fontSize = 32.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text("Deze spelvorm of regelversie wordt nog niet ondersteund. Gebruik de telefoon voor de actuele stand.", color = Color.White, textAlign = TextAlign.Center)
        }; return
    }
    if(play.x01Match!=null){LiveView(play.x01Match,landscape,play.x01Match.finished);return}
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val availableHeight = maxHeight
        val compact = maxHeight < 580.dp || maxWidth < 380.dp
        val textSize = if (compact) 15.sp else 21.sp
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 10.dp)) {
            Text("${play.title} · SET ${play.set} · LEG ${play.leg}", color = PlayMuted, fontSize = if (compact) 13.sp else 18.sp)
            if(play.legs.isNotEmpty())Text("LEGS ${play.legs.joinToString(" – ")} · SETS ${play.sets.joinToString(" – ")}",color=PlayMuted,fontSize=if(compact)11.sp else 16.sp,maxLines=1)
            Text(play.result ?: if (play.status == "interrupted") "ONDERBROKEN · HERSTEL OP TELEFOON" else "AAN DE BEURT: ${play.current}", color = PlayGreen, fontSize = if (compact) 20.sp else 28.sp, fontWeight = FontWeight.Bold)
            when (play.mode) {
                "cricket", "tactics" -> {
                    val columns=if(play.targets.size>7&&availableHeight<420.dp)2 else 1
                    val rows=(play.targets.size+columns-1)/columns
                    val scale=LocalDensity.current.fontScale
                    val markSize=minOf(textSize.value,((availableHeight.value-115f).coerceAtLeast(55f)/(rows+2)/1.3f/scale)).coerceAtLeast(8f).sp
                    Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
                        play.targets.indices.chunked(rows.coerceAtLeast(1)).forEach{indices->Column(Modifier.weight(1f).fillMaxHeight()){
                            Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically){Text("DOEL",Modifier.weight(1f),color=PlayMuted,fontSize=markSize,lineHeight=markSize*1.2f,maxLines=1);play.names.forEach{Text(it,Modifier.weight(1f),color=Color.White,fontSize=markSize,lineHeight=markSize*1.2f,maxLines=1,overflow=TextOverflow.Ellipsis)}}
                            indices.forEach{i->Row(Modifier.weight(1f).fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                                Text(if(play.targets[i]==25)"BULL" else "${play.targets[i]}",Modifier.weight(1f),color=Color.White,fontSize=markSize,lineHeight=markSize*1.2f,maxLines=1)
                                play.names.indices.forEach{side->val marks=play.marks.getOrNull(side)?.getOrNull(i)?:0;Text(if(marks>=play.requiredMarks)"✓" else "$marks/${play.requiredMarks}",Modifier.weight(1f),color=PlayGreen,fontSize=markSize,lineHeight=markSize*1.2f,fontWeight=FontWeight.Bold,maxLines=1)}
                            }}
                        }}
                    }
                    if(play.pointsEnabled)Row{Text("PUNTEN",Modifier.weight(1f),color=PlayMuted,fontSize=markSize,lineHeight=markSize*1.2f);play.names.indices.forEach{Text("${play.points.getOrElse(it){0}}",Modifier.weight(1f),color=PlayGreen,fontSize=markSize,lineHeight=markSize*1.2f)}}
                }
                "bingo" -> {
                    Text("${if (play.win == "full-card") "VOLLE KAART" else "EERSTE LIJN"} · ${play.cardCode}", color = PlayMuted, fontSize = if (compact) 11.sp else 15.sp)
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        play.names.indices.chunked(if(play.names.size>1)2 else 1).forEach{sideRow->Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                            sideRow.forEach{side->Column(Modifier.weight(1f).fillMaxHeight().border(if(side==play.turn)2.dp else 1.dp,if(side==play.turn)PlayGreen else PlayMuted).padding(4.dp),verticalArrangement=Arrangement.spacedBy(3.dp)){
                                Text("${if(side==play.turn)"▶ " else ""}${play.names[side]} · ${play.filled.getOrNull(side)?.count{it}?:0}/9",color=if(side==play.turn)PlayGreen else Color.White,fontSize=if(play.names.size>2)10.sp else 13.sp,lineHeight=if(play.names.size>2)12.sp else 16.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                                play.card.chunked(3).forEachIndexed{row,targets->Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)){targets.forEachIndexed{col,target->
                                    val done=play.filled.getOrNull(side)?.getOrNull(row*3+col)==true
                                    Box(Modifier.weight(1f).fillMaxHeight().border(1.dp,if(done)PlayGreen else PlayMuted).background(if(done)PlayGreen.copy(alpha=.15f)else PlayInk),contentAlignment=Alignment.Center){Text("${if(done)"✓ " else ""}D$target",color=if(done)PlayGreen else Color.White,fontSize=if(play.names.size>2)14.sp else if(compact)24.sp else 34.sp,lineHeight=if(play.names.size>2)16.sp else if(compact)28.sp else 38.sp,fontWeight=FontWeight.Bold,maxLines=1)}
                                }}}
                            }}
                        }}
                    }
                }
                "around" -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { play.names.forEachIndexed { side, name ->
                    val index = play.targetIndex.getOrElse(side) { 0 }; val target = play.targets.getOrNull(index)
                    Text(name, color = Color.White, fontSize = textSize)
                    Text(if (target == null) "VOLTOOID" else if (target == 25) "BULL" else "$target", color = PlayGreen, fontSize = if (compact) 54.sp else 80.sp, fontWeight = FontWeight.Bold)
                    Text("${index.coerceAtMost(play.targets.size)}/${play.targets.size} doelen · ${play.targetHits.getOrElse(side) { 0 }}/${play.hitsPerTarget} treffers · ${play.darts.getOrElse(side){0}} pijlen", color = PlayMuted, fontSize = textSize)
                } }
                "leg-challenge" -> Row(Modifier.weight(1f).fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                    listOf("JOUW POGING" to (play.remaining.firstOrNull()?:0),play.sourceName.ifBlank{"GESPEELDE LEG"} to play.sourceRemaining).forEachIndexed{side,(name,remaining)->Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        Text(name,color=if(side==0)PlayGreen else PlayMuted,fontSize=textSize,maxLines=2,overflow=TextOverflow.Ellipsis)
                        Text("$remaining",color=if(side==0)PlayGreen else Color.White,fontSize=if(compact)48.sp else 74.sp)
                        val visits=if(side==0)play.ownVisitRows else play.sourceVisits
                        visits.forEachIndexed{index,(score,rest)->Text("${index+1}. $score → $rest",color=PlayMuted,fontSize=textSize)}
                        if(visits.isEmpty())Text(if(side==0)"Nog geen verwerkte beurt." else "Historische worpen verschijnen na jouw verwerkte beurt.",color=PlayMuted,fontSize=textSize)
                    }}
                }
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { play.names.forEachIndexed { side, name -> Column(Modifier.weight(1f)) { Text(name, color = Color.White, fontSize = textSize); Text("${play.remaining.getOrElse(side) { 0 }}", color = if (side == play.turn) PlayGreen else Color.White, fontSize = if (compact) 64.sp else 100.sp, fontWeight = FontWeight.Bold) } } }
                    if (play.mode == "finish") { Text("DOEL ${play.finishTarget} · POGING ${play.attempt.coerceAtMost(play.attemptCount)}/${play.attemptCount} · ${play.dartsLeft} PIJLEN OVER", color = PlayGreen, fontSize = textSize); play.attempts.forEach { Text(it, color = PlayMuted, fontSize = textSize) } }
                    if (play.mode == "leg-challenge") { Text("${if(play.sourceName.isBlank())"GESPEELDE LEG" else play.sourceName}: ${play.sourceRemaining}", color = PlayMuted, fontSize = if (compact) 30.sp else 46.sp); Text("Jouw geaccepteerde beurten: ${play.ownVisits}", color = PlayMuted, fontSize = textSize); play.sourceVisits.forEach { (score, rest) -> Text("$score → $rest", color = PlayMuted, fontSize = textSize) }; if (play.sourceVisits.isEmpty()) Text("Historische worpen verschijnen na jouw verwerkte beurt.", color = PlayMuted, fontSize = textSize) }
                }
            }
            if (!cached && play.deadlineAt > 0 && serverTime >= play.warningAt && play.status == "active") Text("SPELEN JULLIE NOG? ${secondsRemaining(play.deadlineAt, serverTime)}s · verleng op telefoon (${(2-play.extensionsUsed).coerceAtLeast(0)} over)", color = PlayGreen, fontSize = if (compact) 13.sp else 18.sp)
            if (play.writerName.isNotBlank()) Text("Schrijver: ${play.writerName}", color = PlayMuted, fontSize = if (compact) 11.sp else 15.sp)
        }
    }
}

/** Reuse the existing mirrored X01 card, accepted-turn scroll state and performance cue model. */
private fun playX01Match(raw:JSONObject):Match?{
    val game=raw.optJSONObject("game")?:return null;val rules=raw.optJSONObject("rules")?:return null
    if(rules.optString("mode")!="x01"||raw.optInt("version",1)!=1||rules.optInt("version")!=1||game.optInt("ruleVersion",1)!=1||rules.optInt("startScore") !in listOf(301,501,701))return null
    val p=game.optJSONObject("progress")?:return null;val sides=game.optJSONArray("sides").objects().take(2)
    if(sides.isEmpty())return null
    val names=raw.optJSONArray("participants").objects().associate{it.optString("id") to it.optString("name","Speler").take(80)}
    val rows=game.optJSONArray("visits").objects();val leg=game.optInt("leg",1);val set=game.optInt("set",1)
    val players=sides.mapIndexed{index,side->
        val own=rows.filter{it.optString("sideId")==side.optString("id")};val darts=own.sumOf{it.optInt("countingDarts")};val total=own.sumOf{it.optInt("score")}
        Player(side.optJSONArray("playerIds")?.let{ids->(0 until ids.length()).joinToString(" & "){names[ids.optString(it)]?:"Speler"}}?:"Speler",p.optJSONArray("remaining")?.optInt(index)?:rules.optInt("startScore"),game.optJSONArray("legs")?.optInt(index)?:0,game.optJSONArray("sets")?.optInt(index)?:0,if(darts>0)3.0*total/darts else null,own.count{it.optInt("score")==180&&!it.optBoolean("bust")},own.filter{it.optBoolean("finish")}.maxOfOrNull{it.optInt("remainingBefore")}?:0)
    }
    val visits=rows.filter{it.optInt("set",1)==set&&it.optInt("leg",1)==leg}.map{Visit(sides.indexOfFirst{s->s.optString("id")==it.optString("sideId")}.coerceAtLeast(0),it.optInt("score"),it.optInt("remainingAfter",rules.optInt("startScore")),it.optBoolean("bust"))}
    val id=raw.optString("id");val key=raw.optString("sessionKey",id);val revision=raw.optLong("revision")
    val events=rows.map{row->ScoreEvent("$key:${row.optInt("set")}:${row.optInt("leg")}:${row.optInt("number")}:${row.optInt("score")}:${row.optInt("remainingAfter")}",revision,"score",row.optInt("score"),row.optBoolean("bust"),row.optBoolean("finish"),names[row.optString("throwerId")]?:"Speler")}
    val winner=sides.indexOfFirst{it.optString("id")==game.optJSONObject("result")?.optString("winnerSideId")}.takeIf{it>=0}?.let{players[it].name}
    return Match(id,revision,if(game.optString("status")=="finished")"result" else if(raw.optString("status")=="interrupted")"interrupted" else "live",players,game.optInt("turn"),rules.optInt("startScore"),leg,set,visits,events,key,paused=raw.optString("status")=="interrupted",winnerName=winner,inRule=rules.optString("inRule","single"),outRule=rules.optString("outRule","double"),currentThrowerName=names[game.optString("currentThrowerId")])
}
