package nl.dartflow.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONArray
import org.json.JSONObject

/** Legacy source retains its canonical UUID; official fixtures keep their director workflow. */
@Composable internal fun PlayerLegacyResume(sourceId:String,kind:String,interrupted:Boolean,currentBoards:List<String>,state:PlayerUiState,actions:PlayerActions){
    var board by rememberSaveable(sourceId){mutableStateOf(currentBoards.firstOrNull().orEmpty())}
    var extraBoard by rememberSaveable(sourceId){mutableStateOf(currentBoards.getOrNull(1).orEmpty())}
    var confirm by remember{mutableStateOf(false)}
    PlayerCard(if(interrupted)"Hervat de bewaarde partij" else "Verplaats deze vrije partij"){
        Text("De partij, regels, beurt en geaccepteerde historie blijven dezelfde. De server controleert de actuele baanrechten en bezetting. Officiële wedstrijden lopen via de wedstrijdleiding.",color=PlayerMuted)
        val current=currentBoards.mapIndexed{index,value->value to "Huidige baan ${index+1}"}
        PlayerPlayBoardChoice("Beschikbare baan",board,state,actions,{board=it},current)
        if(currentBoards.size>1){Text("Remote hervatten vraagt de twee bestaande fysieke zijden en actuele toestemming van beide zijden.",color=PlayerMuted);PlayerPlayBoardChoice("Tweede bestaande baan",extraBoard,state,actions,{extraBoard=it},current)}
        Action(if(interrupted)"Controleer hervatten" else "Controleer verplaatsen",board.isNotBlank()&&!state.busy&&state.online&&state.pendingMatchVisits==0){confirm=true}
    }
    if(confirm)androidx.compose.material3.AlertDialog(onDismissRequest={confirm=false},title={Text("Dezelfde partij behouden?")},text={Text("Alleen de baankoppeling verandert. Een bezette, gesloten of onbevoegde baan wordt geweigerd. De oorspronkelijke partij wordt niet opnieuw aangemaakt.")},confirmButton={androidx.compose.material3.TextButton(onClick={
        actions.command("/play/legacy-actions",json("sourceId" to sourceId,"kind" to kind,"action" to if(interrupted)"resume" else "move","boardIds" to JSONArray(listOf(board,extraBoard).filter(String::isNotBlank))))
        confirm=false
    }){Text("Bevestigen")}},dismissButton={androidx.compose.material3.TextButton(onClick={confirm=false}){Text("Annuleren")}})
}

@Composable internal fun PlayerTrainingConflict(entity:JSONObject,state:PlayerUiState,actions:PlayerActions){
    val conflict=entity.obj("state").obj("offlineConflict");if(conflict.text("status")!="open")return
    var reason by rememberSaveable(conflict.text("id")){mutableStateOf("")};var decision by remember{mutableStateOf<String?>(null)}
    PlayerCard("Training · controle nodig"){
        Text("Deze eigen training heeft twee lezingen. De voortgang blijft bewaard tot je een gemotiveerd besluit neemt.",color=PlayerMuted)
        listOf("canonical" to "Serverstand","offline" to "Lokale stand").forEach{(key,label)->conflict.obj("readings").optJSONObject(key)?.let{reading->val game=reading.obj("game");Text("$label: ${game.optJSONArray("remaining")?.ints()?.joinToString(" – ").orEmpty()} · ${game.rows("visits").size} beurten",color=PlayerLime)}}
        if(entity.optBoolean("canManage")){
            Field("Reden voor mijn trainingscorrectie",reason,{reason=it},!state.busy,max=1000,multiline=true)
            Action("Controleer behouden serverstand",reason.trim().length>=3&&!state.busy&&state.online,false){decision="keep-server"}
            if(conflict.obj("readings").optJSONObject("offline")!=null)Action("Controleer gebruiken lokale stand",reason.trim().length>=3&&!state.busy&&state.online,false){decision="use-offline"}
        }
    }
    decision?.let{selected->androidx.compose.material3.AlertDialog(onDismissRequest={decision=null},title={Text("Bevestig trainingslezing")},text={Text("${if(selected=="keep-server")"De bewaarde lokale lezing wordt verworpen." else "De getoonde gevalideerde lokale beurtvolgorde wordt gekozen."} Dit is je eigen training en verandert geen officiële uitslag of rating.")},confirmButton={androidx.compose.material3.TextButton(onClick={actions.command("/play/legacy-actions",json("sourceId" to entity.text("id"),"kind" to "training","action" to "resolve-offline","expectedRevision" to entity.optInt("revision"),"conflictId" to conflict.text("id"),"decision" to selected,"reason" to reason.trim()));decision=null}){Text("Bevestigen")}},dismissButton={androidx.compose.material3.TextButton(onClick={decision=null}){Text("Annuleren")}})}
}
