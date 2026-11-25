package nl.dartflow.app

import android.content.Context
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

internal class PlayerManualCache(private val context: Context) {
    private val prefs=context.getSharedPreferences("dartflow-public-manual-v1",Context.MODE_PRIVATE)
    fun read():JSONObject = runCatching { prefs.getString("published",null)?.takeIf{it.length<=400_000}?.let(::JSONObject)?.takeIf{it.has("version")&&it.has("articles")} }.getOrNull()
        ?: json("version" to "2026.11.20-support.1","articles" to JSONArray(context.assets.open("manual.nl.json").bufferedReader().use{it.readText()}))
    fun write(value:JSONObject){val raw=value.toString();if(raw.length<=400_000&&value.has("version")&&value.has("articles"))prefs.edit().putString("published",raw).apply()}
}
internal fun playerManualArticles(resource:JSONObject,query:String,category:String):List<JSONObject>{
    fun normalize(value:String)=Normalizer.normalize(value,Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"),"").lowercase(Locale.forLanguageTag("nl"))
    val terms=normalize(query.take(200)).split(Regex("\\s+")).filter(String::isNotBlank)
    return resource.rows("articles").filter{a->(category.isBlank()||a.text("category")==category)&&terms.all{term->normalize((listOf(a.text("title"),a.text("intro"))+listOf("steps","examples","notes","keywords").flatMap{a.optJSONArray(it)?.strings().orEmpty()}).joinToString(" ")).contains(term)}}
}
@Composable internal fun PlayerManualScreen(state:PlayerUiState,actions:PlayerActions){
    val resource=state.resource
    var query by rememberSaveable{mutableStateOf("")};var category by rememberSaveable{mutableStateOf("")}
    val selected=state.activeId?.let{id->resource.rows("articles").find{it.text("id")==id}}
    Heading("Handleiding","DARTFLOW","Stap voor stap: spelen, herstellen, oefenen en organiseren.")
    Text("Inhoudsversie ${resource.text("version","wordt opgehaald")}",color=PlayerMuted)
    if(resource.optBoolean("offline"))Notice("Offline · opgeslagen handleiding. Nieuwe online wijzigingen zijn nog niet opgehaald.")
    Action("Terug",primary=false,onClick=actions.back)
    if(selected!=null){
        PlayerCard(selected.text("title")){
            Text(selected.text("intro"),color=PlayerText)
            selected.optJSONArray("steps")?.strings()?.forEachIndexed{i,step->Text("${i+1}. $step",color=PlayerText)}
            selected.optJSONArray("examples")?.strings()?.forEach{Text("Voorbeeld: $it",color=PlayerLime)}
            selected.optJSONArray("notes")?.strings()?.forEach{Text(it,color=PlayerMuted)}
        }
        Action("Alle hoofdstukken",primary=false){actions.navigate(PlayerScreen.MANUAL,null)}
    }else{
        Field("Zoek in de handleiding",query,{query=it},max=200)
        Choice("Onderwerp",category,listOf("" to "Alle onderwerpen")+resource.rows("articles").map{it.text("category")}.distinct().map{it to it},{category=it})
        val articles=playerManualArticles(resource,query,category)
        if(articles.isEmpty()&&!state.loading)Text("Geen hoofdstukken gevonden. Probeer andere woorden.",color=PlayerMuted)
        articles.forEach{article->PlayerCard(article.text("title")){Text(article.text("intro"),color=PlayerMuted);Action("Lees stappen",primary=false){actions.navigate(PlayerScreen.MANUAL,article.text("id"))}}}
    }
    Action("Stel een supportvraag", primary = false) { actions.openLink("/app/support/new") }
    Action("Veelgestelde vragen",primary=false){actions.navigate(PlayerScreen.HELP,null)}
}
