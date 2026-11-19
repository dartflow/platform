package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject

/** Provisional core-match projection. Accepted history and authorization always come back from the server. */
internal fun playerProjectMatch(source: PlayerMatch, action: JSONObject, actorId: String): PlayerMatch {
    if(action.text("type")=="undo")return playerProjectMatchUndo(source,actorId)
    require(source.raw.optBoolean("offlineSupported") && source.raw.optJSONObject("scoringState") != null) { "Laad eerst de actuele scorekaart voor offline invoer." }
    require(source.status == "live" && source.permissions.optBoolean("canScore") && !source.raw.optBoolean("paused") && source.raw.obj("offlineConflict").text("status") != "open") { "Je mag deze beurt nu niet invoeren." }
    require(source.raw.text("writerId")==actorId) { "De actuele schrijver hoort bij een ander account." }
    require(action.text("type") == "score")
    val raw = JSONObject(source.raw.toString()); val game = raw.obj("scoringState"); val settings = raw.obj("settings"); val side = game.optInt("turn"); val mode = settings.text("discipline", "x01")
    val rules = playerPlayDefaultRules(mode, settings.optInt("startScore",501)).put("bestOfLegs",1).put("bestOfSets",1)
    rules.put("inRule", settings.text("inRule","single")).put("outRule",settings.text("outRule","double"))
    val targets = if (mode == "tactics") (20 downTo 10).toList() + 25 else playerCricketTargets
    val marks = game.obj(mode)
    if (mode in listOf("cricket","tactics")) {
        rules.put("points", settings.text(if (mode == "tactics") "tacticsMode" else "cricketMode", "standard") != "no-score")
        if (mode == "tactics") rules.put("preset",settings.text("tacticsPreset","tactics-5")).put("requiredMarks",marks.optInt("requiredMarks",5)).put("tieRule",if (settings.text("tacticsPreset","tactics-5") == "tactics-5" && rules.optBoolean("points")) "replay" else "first-closed")
    }
    val progress = if (mode == "x01") json("mode" to mode,"remaining" to game.optJSONArray("remaining"),"opened" to (game.optJSONArray("opened") ?: JSONArray(listOf(settings.text("inRule") != "double",settings.text("inRule") != "double")))) else json("mode" to mode,"targets" to JSONArray(targets),"requiredMarks" to if (mode == "tactics") marks.optInt("requiredMarks",5) else 3,"marks" to marks.optJSONArray("marks"),"points" to marks.optJSONArray("points"),"creditedMarks" to marks.optJSONArray("creditedMarks"))
    val roster = source.sides.map { players -> json("id" to players.first().id,"playerIds" to JSONArray(players.map { it.id })) }
    val thrower = playerCoreThrower(game)
    val frame = json("id" to source.id,"rules" to rules,"ruleVersion" to 1,"mode" to mode,"sides" to JSONArray(roster),"turn" to side,"currentThrowerId" to thrower,"status" to "live","starter" to game.optInt("legStarter"),"set" to source.setNumber,"leg" to source.legNumber,"attempt" to marks.optInt("attempt",1),"legs" to JSONArray(listOf(0,0)),"sets" to JSONArray(listOf(0,0)),"progress" to progress,"visits" to JSONArray(),"attempts" to JSONArray(),"result" to null)
    val predicted = PlayerPlayEngine.project(PlayerPlaySession(json("id" to source.id,"revision" to source.revision,"rules" to rules,"game" to frame,"participants" to JSONArray(source.participants.map { json("id" to it.id,"name" to it.displayName) }))), action)
    val visit = predicted.game.rows("visits").last(); val won = visit.optBoolean("finish"); val before = game.optJSONArray("remaining")?.optInt(side) ?: 0
    val history = game.optJSONArray("history") ?: JSONArray(); history.put(JSONObject(game.toString()).also { it.remove("history") }); game.put("history",history)
    val row = json("player" to source.players[side].id,"playerIndex" to side,"throwerId" to thrower,"score" to visit.optInt("score"),"darts" to if (mode == "tactics" || mode == "cricket" && won) action.optJSONArray("dartHits")?.length() ?: 3 else if(mode=="cricket")3 else visit.optInt("countingDarts"),"remainingBefore" to before,"remainingAfter" to if (mode == "x01") visit.optInt("remainingAfter") else predicted.progress.optJSONArray("points")?.optInt(side),"bust" to visit.optBoolean("bust"),"leg" to source.legNumber,"checkout" to won,"measurementVersion" to 1)
    listOf("dartHits","observedScore","openedBefore","openedAfter","doubleAttempts").forEach { key -> if (visit.has(key)) row.put(key,visit.get(key)) }
    if (mode != "x01") row.put(mode,json("marksBefore" to marks.optJSONArray("marks")?.optJSONArray(side),"marksAfter" to predicted.progress.optJSONArray("marks")?.optJSONArray(side),"pointsBefore" to marks.optJSONArray("points")?.optInt(side),"pointsAfter" to predicted.progress.optJSONArray("points")?.optInt(side),"creditedMarks" to (predicted.progress.optJSONArray("creditedMarks")?.optInt(side) ?: 0) - (marks.optJSONArray("creditedMarks")?.optInt(side) ?: 0)).also { if (mode == "tactics") it.put("attempt",marks.optInt("attempt",1)) })
    game.getJSONArray("visits").put(row); raw.getJSONArray("visits").put(row)
    val stats = game.optJSONArray("stats")?.optJSONObject(side)
    stats?.put("darts", stats.optInt("darts") + row.optInt("darts"))?.put("total",stats.optInt("total") + visit.optInt("score"))
    if(mode=="x01")stats?.put("oneEighties",stats.optInt("oneEighties")+if(visit.optInt("score")==180)1 else 0)?.put("highestFinish",if(won)maxOf(stats.optInt("highestFinish"),visit.optInt("score"))else stats.optInt("highestFinish"))
    if (mode == "x01") { game.put("remaining",predicted.progress.getJSONArray("remaining")); if (game.has("opened")) game.put("opened",predicted.progress.getJSONArray("opened")) }
    else { listOf("marks","points","creditedMarks").forEach { marks.put(it,predicted.progress.get(it)) }; game.put("remaining",marks.getJSONArray("points")); game.put(mode,marks) }
    if (predicted.game.text("status") == "replay-required") {
        val replayStarter = (game.optInt("legStarter") + game.getJSONArray("legs").ints().sum() + 1) % 2
        val replays = marks.optJSONArray("replays") ?: JSONArray()
        replays.put(json("leg" to source.legNumber,"attempt" to marks.optInt("attempt",1),"starter" to 1-replayStarter,"fromVisit" to game.rows("visits").indexOfFirst { it.optInt("leg") == source.legNumber && it.obj("tactics").optInt("attempt") == marks.optInt("attempt",1) } + 1,"toVisit" to game.rows("visits").size))
        marks.put("attempt",marks.optInt("attempt",1)+1).put("replays",replays).put("marks",JSONArray(List(2){JSONArray(List(targets.size){0})})).put("points",JSONArray(listOf(0,0)))
        game.put("remaining",JSONArray(listOf(0,0))).put("turn",replayStarter)
    } else if (!won) game.put("turn",1-side)
    else {
        val legs = game.getJSONArray("legs"); legs.put(side,legs.optInt(side)+1)
        val legLimit = settings.optInt("legLimit"); val setFinished = if (legLimit > 0) legs.ints().sum() >= legLimit else playerSeriesWinner(legs.ints(),settings.optInt("bestOfLegs",3),settings.obj("legWinByTwo").optInt("maximum")) != null
        if (setFinished) {
            val sets = raw.getJSONArray("sets"); if (legs.optInt(0) != legs.optInt(1)) sets.put(side,sets.optInt(side)+1)
            if (legLimit > 0 || playerSeriesWinner(sets.ints(),settings.optInt("bestOfSets",1),settings.obj("setWinByTwo").optInt("maximum")) != null) { game.put("status","finished"); raw.put("status","result").put("winnerId",if (legs.optInt(0)==legs.optInt(1)) JSONObject.NULL else source.players[side].id) }
            else { raw.put("setNumber",source.setNumber+1); game.put("legs",JSONArray(listOf(0,0))).put("history",JSONArray()).put("visits",JSONArray()); raw.put("_awaitingServerStart",true) }
        }
        if (raw.text("status") == "live") {
            if (mode == "x01") { game.put("remaining",settings.optJSONArray("sideStartScores") ?: JSONArray(listOf(settings.optInt("startScore",501),settings.optInt("startScore",501)))); if (game.has("opened")) game.put("opened",JSONArray(listOf(settings.text("inRule") != "double",settings.text("inRule") != "double"))) }
            else { marks.put("marks",JSONArray(List(2){JSONArray(List(targets.size){0})})).put("points",JSONArray(listOf(0,0))); game.put("remaining",JSONArray(listOf(0,0))) }
            game.put("turn",(game.optInt("legStarter")+game.getJSONArray("legs").ints().sum())%2)
            if (settings.text("decidingLeg") == "rebull" && game.getJSONArray("legs").optInt(0) == game.getJSONArray("legs").optInt(1) && game.getJSONArray("legs").ints().sum() == settings.optInt("bestOfLegs",3)-1) raw.put("_awaitingServerStart",true)
        }
    }
    raw.put("revision",source.revision+1).put("remaining",game.getJSONArray("remaining")).put("legs",game.getJSONArray("legs")).put("turn",game.optInt("turn")).put("legNumber",game.getJSONArray("legs").ints().sum()+if(raw.text("status")=="result")0 else 1).put("currentLegVisits",JSONArray(game.rows("visits").filter { it.optInt("leg")==game.getJSONArray("legs").ints().sum()+1 }))
    if (mode != "x01") raw.put(mode,marks)
    val nextThrower = playerCoreThrower(game); source.participants.find { it.id==nextThrower }?.let { raw.put("currentThrower",json("id" to it.id,"name" to it.name,"displayName" to it.displayName)) }
    val remote = raw.text("scoringMode") == "per-player"; val nextWriter = if (remote) raw.optJSONArray("remoteWriterIds")?.optString(game.optInt("turn"))?.takeIf(String::isNotBlank) ?: nextThrower else raw.text("writerId")
    raw.put("writerId",nextWriter)
    raw.obj("permissions").put("canScore",raw.text("status")=="live"&&!raw.optBoolean("_awaitingServerStart")&&nextWriter==actorId).put("canUndo",true)
    return PlayerMatch.parse(raw)
}

internal fun playerSeriesWinner(scores: List<Int>, bestOf: Int, maximum: Int = 0): Int? {
    if (scores.size<2) return null
    val leader = if(scores[0]>scores[1])0 else 1; val high=scores[leader]; val low=scores[1-leader]
    return leader.takeIf { high>=bestOf/2+1 && (maximum==0 || high-low>=2 || scores.sum()>=maximum) && high!=low }
}
internal fun playerCoreThrower(game: JSONObject): String {
    val side=game.optInt("turn"); val roster=game.optJSONArray("sidePlayers")?.optJSONArray(side)?.strings().orEmpty()
    if(roster.isEmpty())return game.optJSONArray("players")?.optString(side).orEmpty()
    val completed=game.optJSONArray("legs").ints().sum(); val turns=game.rows("visits").count{it.optInt("leg")==completed+1&&it.optInt("playerIndex")==side}
    return roster[(game.optInt("legOffset")+completed+turns)%roster.size]
}

internal fun playerCanProjectUndo(source:PlayerMatch,actor:String)=source.raw.optBoolean("offlineSupported")&&source.status=="live"&&source.raw.text("scoringMode")!="per-player"&&source.raw.text("writerId")==actor&&source.permissions.optBoolean("canUndo")&&!source.raw.optBoolean("paused")&&!source.raw.optBoolean("_awaitingServerStart")&&source.raw.obj("offlineConflict").text("status")!="open"&&source.raw.obj("scoringState").rows("history").isNotEmpty()
private fun playerProjectMatchUndo(source:PlayerMatch,actor:String):PlayerMatch{
    require(playerCanProjectUndo(source,actor)){"Deze terugname vraagt verbinding en actuele serverbevestiging."}
    val raw=JSONObject(source.raw.toString());val history=raw.obj("scoringState").rows("history")
    val game=JSONObject(history.last().toString()).put("history",JSONArray(history.dropLast(1)))
    val leg=game.getJSONArray("legs").ints().sum()+1
    raw.put("scoringState",game).put("revision",source.revision+1).put("remaining",game.getJSONArray("remaining")).put("legs",game.getJSONArray("legs")).put("turn",game.optInt("turn")).put("legNumber",leg).put("visits",JSONArray(raw.rows("visits").dropLast(1))).put("currentLegVisits",JSONArray(game.rows("visits").filter{it.optInt("leg")==leg}))
    listOf("cricket","tactics").forEach{key->game.optJSONObject(key)?.let{raw.put(key,it)}}
    val thrower=playerCoreThrower(game);source.participants.find{it.id==thrower}?.let{raw.put("currentThrower",json("id" to it.id,"name" to it.name,"displayName" to it.displayName))}
    raw.obj("permissions").put("canScore",true).put("canUndo",game.rows("history").isNotEmpty())
    return PlayerMatch.parse(raw)
}
