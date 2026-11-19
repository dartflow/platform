import {CRICKET_TARGETS} from '@/lib/cricket';
import type {CricketState} from '@/lib/cricket';

export default function CricketCard({cricket,names}:{cricket:CricketState;names:string[]}){
 return <section className="panel cricket-card" aria-label="Cricket marks en punten"><h2>Cricket</h2><div className="table-wrap"><table><thead><tr><th scope="col">{names[0]}</th><th scope="col">Doel</th>{names.length>1&&<th scope="col">{names[1]}</th>}</tr></thead><tbody>{CRICKET_TARGETS.map((target,index)=><tr key={target}><td aria-label={`${names[0]} ${target}: ${cricket.marks[0][index]} marks`}>{['—','/','×','⊗'][cricket.marks[0][index]]}</td><th scope="row">{target===25?'Bull':target}</th>{names.length>1&&<td aria-label={`${names[1]} ${target}: ${cricket.marks[1][index]} marks`}>{['—','/','×','⊗'][cricket.marks[1][index]]}</td>}</tr>)}<tr><td>{cricket.points[0]}</td><th scope="row">Punten</th>{names.length>1&&<td>{cricket.points[1]}</td>}</tr></tbody></table></div></section>;
}
