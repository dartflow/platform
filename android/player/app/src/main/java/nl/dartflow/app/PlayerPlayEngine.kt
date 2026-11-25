package nl.dartflow.app

import org.json.JSONArray
import org.json.JSONObject

/** Local projection of version 1 dart input. Only the server turns a queued visit into accepted input. */
internal object PlayerPlayEngine {
    fun dartValue(hit: String): Int = when (hit) { "MISS" -> 0; "SB" -> 25; "DB" -> 50; else -> {
        require(hit.matches(Regex("[SDT]([1-9]|1[0-9]|20)"))) { "Kies een geldige pijl." }
        hit.drop(1).toInt() * when (hit[0]) { 'D' -> 2; 'T' -> 3; else -> 1 }
    } }
    fun project(session: PlayerPlaySession, input: JSONObject): PlayerPlaySession {
        require(session.supported && session.game.text("status") == "live") { "Deze partij kan nu geen score verwerken." }
        val raw = session.publicCache(); val game = raw.obj("game"); val rules = session.rules; val p = game.obj("progress")
        val hits = input.optJSONArray("dartHits")?.strings().orEmpty()
        val aggregate = hits.isEmpty() && session.rules.text("mode") in listOf("x01", "leg-challenge") && input.has("score")
        require(aggregate || hits.size in 1..3) { "Registreer één tot drie werkelijk geworpen pijlen." }
        hits.forEach(::dartValue)
        val side = game.optInt("turn"); val mode = rules.text("mode"); val visits = game.optJSONArray("visits") ?: JSONArray().also { game.put("visits", it) }
        val actual = if (aggregate) input.optInt("darts", 3) else hits.size
        val row = json("number" to visits.length() + 1, "sideId" to session.sides[side].text("id"), "throwerId" to game.text("currentThrowerId"), "set" to game.optInt("set"), "leg" to game.optInt("leg"), "attempt" to game.optInt("attempt"), "input" to input, "score" to 0, "observedScore" to if (aggregate) input.optInt("score") else hits.sumOf(::dartValue), "countingDarts" to actual, "actualDarts" to if (aggregate && !input.has("darts")) null else actual, "bust" to false, "finish" to false, "doubleAttempts" to null)
        if (!aggregate) row.put("dartHits", JSONArray(hits))
        if (input.has("doubleAttempts") && !input.isNull("doubleAttempts")) row.put("doubleAttempts", input.optInt("doubleAttempts"))
        input.optJSONArray("intendedTargets")?.let { targets ->
            require(targets.length() == hits.size)
            row.put("intendedTargets", targets)
            if ((0 until targets.length()).none { targets.isNull(it) }) row.put("doubleAttempts", targets.strings().count { it == "DB" || it.startsWith('D') })
        }
        var won = false; var replay = false
        when (mode) {
            "x01", "leg-challenge", "finish" -> {
                val single = mode != "x01"; val before = if (single) p.optInt("remaining") else p.getJSONArray("remaining").getInt(side)
                val openedBefore = if (mode == "finish") true else if (single) p.optBoolean("opened") else p.getJSONArray("opened").getBoolean(side)
                val out = if (mode == "leg-challenge") rules.obj("source").text("outRule") else rules.text("outRule")
                if (mode == "finish") require(hits.size <= p.optInt("dartsLeft")) { "Deze poging heeft onvoldoende pijlen over." }
                var left = before; var opened = openedBefore; var bust = false; var finish = false
                if (aggregate) {
                    require(opened) { "Registreer de openingsfase per pijl." }
                    val score = input.optInt("score", -1)
                    require(actual in 1..3 && score in 0..180 && possibleTotals(actual).contains(score)) { "Deze score is niet mogelijk met dit aantal pijlen." }
                    left = before - score; bust = input.optBoolean("bust") || left < 0 || out != "straight" && left == 1
                    finish = left == 0 && !bust
                    require(!input.optBoolean("bust") || score == 0)
                    if (finish) { require(input.has("darts") && playerPlayFinishRoutes(before, actual, out, 1).isNotEmpty()) { "Deze checkout is niet mogelijk." }; require(out == "straight" || input.optBoolean("doubleConfirmed")) { "Bevestig een geldige einddubbel of eindtriple." } }
                    require(!input.optBoolean("doubleConfirmed") || finish) { "Deze beurt finisht de reststand niet." }
                }
                hits.forEachIndexed { index, hit ->
                    if (!opened && (hit == "DB" || hit.startsWith('D'))) opened = true
                    if (opened) {
                        left -= dartValue(hit)
                        val end = out == "straight" || hit == "DB" || hit.startsWith('D') || out == "master" && hit.startsWith('T')
                        bust = left < 0 || out != "straight" && left == 1 || left == 0 && !end
                        finish = left == 0 && !bust
                    }
                    require(!(bust || finish) || index == hits.lastIndex) { "Er kan geen pijl volgen na bust of finish." }
                }
                if (bust) { left = before; opened = openedBefore }
                row.put("remainingBefore", before).put("remainingAfter", left).put("openedBefore", openedBefore).put("openedAfter", opened).put("score", if (bust) 0 else before - left).put("bust", bust).put("finish", finish).put("countingDarts", if (mode == "x01" || mode == "leg-challenge") if (finish) actual else 3 else actual)
                when (mode) {
                    "x01" -> { p.getJSONArray("remaining").put(side, left); p.getJSONArray("opened").put(side, opened); won = finish }
                    "finish" -> {
                        val dartsLeft = p.optInt("dartsLeft") - hits.size; p.put("remaining", if (bust) rules.optInt("target") else left).put("dartsLeft", dartsLeft)
                        if (bust || finish || dartsLeft == 0) {
                            val prior = visits.objects().filter { it.optInt("attempt") == game.optInt("attempt") } + row
                            val attempts = if (prior.any { it.isNull("doubleAttempts") }) null else prior.sumOf { it.optInt("doubleAttempts") }
                            val done = p.getJSONArray("completed").put(json("number" to p.optInt("attemptNumber"), "success" to finish, "bust" to bust, "remaining" to p.optInt("remaining"), "darts" to 3 - dartsLeft, "doubleAttempts" to attempts, "visitNumber" to row.optInt("number")))
                            if (done.length() == rules.optInt("attemptCount")) finish(game, session, 0, "Alle finishpogingen zijn geregistreerd.")
                            else { p.put("attemptNumber", p.optInt("attemptNumber") + 1).put("remaining", rules.optInt("target")).put("dartsLeft", 3); game.put("attempt", game.optInt("attempt") + 1) }
                        }
                    }
                    else -> {
                        p.put("remaining", left).put("opened", opened).put("ownDarts", p.optInt("ownDarts") + if (aggregate && !input.has("darts")) 0 else actual).put("ownVisits", p.optInt("ownVisits") + 1)
                        // Future source visits remain sealed until the server accepts this visit.
                        val reference = if (rules.text("comparison") == "darts") p.optInt("sourceDarts") else p.optInt("sourceVisitCount", rules.obj("source").optInt("visitCount", rules.obj("source").optJSONArray("visits")?.length() ?: 0))
                        val own = if (rules.text("comparison") == "darts") p.optInt("ownDarts") else p.optInt("ownVisits")
                        if (finish || reference > 0 && own >= reference) {
                            val kind = if (!finish || own > reference) "loss" else if (own == reference) "draw" else "win"
                            game.put("status", "finished").put("result", json("kind" to kind, "winnerSideId" to if (kind == "win") session.sides[0].text("id") else null, "reason" to "Voorlopige vergelijking; wacht op serververwerking."))
                        }
                    }
                }
            }
            "cricket", "tactics" -> {
                val required = p.optInt("requiredMarks"); val targets = p.getJSONArray("targets").ints(); val marks = p.getJSONArray("marks"); val points = p.getJSONArray("points"); val credits = p.getJSONArray("creditedMarks"); val before = points.optInt(side)
                hits.forEachIndexed { index, hit ->
                    val target = if (hit in listOf("SB", "DB")) 25 else hit.drop(1).toIntOrNull() ?: 0
                    val slot = targets.indexOf(target); val amount = when { hit == "DB" -> 2; hit == "SB" -> 1; hit.startsWith('T') -> 3; hit.startsWith('D') -> 2; hit.startsWith('S') -> 1; else -> 0 }
                    if (slot >= 0 && amount > 0) {
                        val own = marks.getJSONArray(side); val closing = minOf(required - own.optInt(slot), amount); val extra = amount - closing
                        own.put(slot, own.optInt(slot) + closing); credits.put(side, credits.optInt(side) + closing)
                        if (rules.optBoolean("points") && (0 until marks.length()).any { it != side && marks.getJSONArray(it).optInt(slot) < required }) { points.put(side, points.optInt(side) + extra * target); credits.put(side, credits.optInt(side) + extra) }
                    }
                    won = marks.getJSONArray(side).ints().all { it == required } && (!rules.optBoolean("points") || points.ints().filterIndexed { i, _ -> i != side }.all { if (mode == "tactics" && rules.text("preset") == "tactics-5") points.optInt(side) > it else points.optInt(side) >= it })
                    replay = mode == "tactics" && rules.text("tieRule") == "replay" && (0 until marks.length()).all { marks.getJSONArray(it).ints().all { n -> n == required } } && points.ints().distinct().size == 1
                    require(!(won || replay) || index == hits.lastIndex) { "Er kan geen pijl volgen na de beslissende pijl." }
                }
                row.put("score", points.optInt(side) - before).put("finish", won)
            }
            "around" -> {
                val targets = p.getJSONArray("targets"); val indices = p.getJSONArray("targetIndex"); val counts = p.getJSONArray("targetHits"); val successes = p.getJSONArray("successes"); val darts = p.getJSONArray("darts"); val before = successes.optInt(side)
                hits.forEachIndexed { index, hit ->
                    val target = targets.optInt(indices.optInt(side)); val value = if (hit in listOf("SB", "DB")) 25 else hit.drop(1).toIntOrNull() ?: 0
                    val valid = if (target == 25) when (rules.text("bull")) { "any" -> hit in listOf("SB", "DB"); "outer" -> hit == "SB"; "inner" -> hit == "DB"; else -> false } else value == target && when (rules.text("segment")) { "single" -> hit.startsWith('S'); "double" -> hit.startsWith('D'); "triple" -> hit.startsWith('T'); else -> hit.first() in "SDT" }
                    darts.put(side, darts.optInt(side) + 1)
                    if (valid) { successes.put(side, successes.optInt(side) + 1); counts.put(side, counts.optInt(side) + 1); if (counts.optInt(side) == rules.optInt("hitsPerTarget")) { counts.put(side, 0); indices.put(side, indices.optInt(side) + 1) } }
                    won = indices.optInt(side) == targets.length(); require(!won || index == hits.lastIndex) { "De reeks is na deze pijl voltooid." }
                }
                row.put("score", successes.optInt(side) - before).put("finish", won)
            }
            "bingo" -> {
                val card = p.getJSONArray("card").ints(); val filled = p.getJSONArray("filled").getJSONArray(side); val darts = p.getJSONArray("darts"); val before = (0 until filled.length()).count { filled.optBoolean(it) }
                val lines = listOf(listOf(0,1,2),listOf(3,4,5),listOf(6,7,8),listOf(0,3,6),listOf(1,4,7),listOf(2,5,8),listOf(0,4,8),listOf(2,4,6))
                hits.forEachIndexed { index, hit ->
                    darts.put(side, darts.optInt(side) + 1)
                    if (hit.startsWith('D') && hit != "DB") card.indexOf(hit.drop(1).toInt()).takeIf { it >= 0 }?.let { filled.put(it, true) }
                    val pattern = if (rules.text("win") == "full-card") (0..8).toList().takeIf { it.all(filled::optBoolean) } else lines.firstOrNull { it.all(filled::optBoolean) }
                    won = pattern != null; if (won) p.put("winningPattern", JSONArray(pattern)); require(!won || index == hits.lastIndex) { "De kaart is na deze pijl gewonnen." }
                }
                row.put("score", (0 until filled.length()).count { filled.optBoolean(it) } - before).put("finish", won)
            }
            else -> error("Deze spelvorm vereist een appupdate.")
        }
        visits.put(row)
        if (replay) game.put("status", "replay-required")
        else if (won) {
            if (mode in listOf("x01", "cricket", "tactics")) winLeg(game, session, side) else finish(game, session, side, if (mode == "bingo") "De gekozen bingoregel is voltooid." else "De gekozen reeks is voltooid.")
        } else if (mode !in listOf("finish", "leg-challenge") && game.text("status") == "live") {
            val next = (side + 1) % session.sides.size; game.put("turn", next)
            val ids = session.sides[next].getJSONArray("playerIds").strings(); val count = visits.objects().count { it.text("sideId") == session.sides[next].text("id") }
            game.put("currentThrowerId", ids[count % ids.size])
        }
        raw.put("revision", session.revision + 1)
        return PlayerPlaySession(raw)
    }
    private fun possibleTotals(darts: Int): Set<Int> {
        var values = setOf(0); val hits = listOf(0,25,50) + (1..20).flatMap { listOf(it,2*it,3*it) }
        repeat(darts) { values = values.flatMap { a -> hits.map { a + it } }.toSet() }; return values
    }
    fun restart(session: PlayerPlaySession): PlayerPlaySession {
        require(session.rules.text("mode") == "tactics" && session.game.text("status") == "replay-required")
        val raw = session.publicCache(); val game = raw.obj("game"); val starter = (game.optInt("starter") + 1) % session.sides.size; val oldAttempt = game.optInt("attempt")
        game.getJSONArray("attempts").put(json("number" to oldAttempt, "set" to game.optInt("set"), "leg" to game.optInt("leg"), "starter" to game.optInt("starter"), "status" to "replayed", "winnerSideId" to null, "fromVisit" to game.rows("visits").indexOfFirst { it.optInt("attempt") == oldAttempt } + 1, "toVisit" to game.rows("visits").size))
        game.put("attempt", oldAttempt + 1).put("starter", starter).put("turn", starter).put("currentThrowerId", session.sides[starter].getJSONArray("playerIds").getString(0)).put("status", "live")
        val targets = session.progress.getJSONArray("targets").ints()
        game.put("progress", json("mode" to "tactics", "targets" to JSONArray(targets), "requiredMarks" to session.rules.optInt("requiredMarks"), "marks" to JSONArray(List(session.sides.size) { JSONArray(List(targets.size) { 0 }) }), "points" to JSONArray(List(session.sides.size) { 0 }), "creditedMarks" to JSONArray(List(session.sides.size) { 0 })))
        return PlayerPlaySession(raw.put("revision", session.revision + 1))
    }
    private fun finish(game: JSONObject, session: PlayerPlaySession, side: Int, reason: String) { game.put("status", "finished").put("result", json("kind" to if (session.sides.size == 1) "completed" else "win", "winnerSideId" to session.sides[side].text("id"), "reason" to reason)) }
    private fun winLeg(game: JSONObject, session: PlayerPlaySession, side: Int) {
        val rules = session.rules; val legs = game.getJSONArray("legs"); val sets = game.getJSONArray("sets")
        game.getJSONArray("attempts").put(json("number" to game.optInt("attempt"), "set" to game.optInt("set"), "leg" to game.optInt("leg"), "starter" to game.optInt("starter"), "status" to "won", "winnerSideId" to session.sides[side].text("id"), "fromVisit" to game.rows("visits").indexOfFirst { it.optInt("attempt") == game.optInt("attempt") } + 1, "toVisit" to game.getJSONArray("visits").length()))
        legs.put(side, legs.optInt(side) + 1)
        if (legs.optInt(side) >= rules.optInt("bestOfLegs") / 2 + 1) {
            sets.put(side, sets.optInt(side) + 1)
            if (sets.optInt(side) >= rules.optInt("bestOfSets") / 2 + 1) { finish(game, session, side, "De partij is gewonnen."); return }
            repeat(legs.length()) { legs.put(it, 0) }; game.put("set", game.optInt("set") + 1)
        }
        val starter = (game.optInt("starter") + 1) % session.sides.size
        game.put("leg", game.optInt("leg") + 1).put("attempt", game.optInt("attempt") + 1).put("starter", starter).put("turn", starter).put("currentThrowerId", session.sides[starter].getJSONArray("playerIds").getString(0))
        val count = session.sides.size
        val progress = when (rules.text("mode")) {
            "x01" -> json("mode" to "x01", "remaining" to JSONArray(List(count) { rules.optInt("startScore") }), "opened" to JSONArray(List(count) { rules.text("inRule") != "double" }))
            else -> { val targets = (20 downTo if (rules.text("mode") == "cricket") 15 else 10).toList() + 25; json("mode" to rules.text("mode"), "targets" to JSONArray(targets), "requiredMarks" to if (rules.text("mode") == "cricket") 3 else rules.optInt("requiredMarks"), "marks" to JSONArray(List(count) { JSONArray(List(targets.size) { 0 }) }), "points" to JSONArray(List(count) { 0 }), "creditedMarks" to JSONArray(List(count) { 0 })) }
        }
        game.put("progress", progress)
    }
}
