"use client";

import type {ReactNode} from "react";
import ScoreConsoleFrame,{ScoreConsoleHeader} from "./score-console-frame";

/** The same full-screen presentation for modes that require actual dart hits. */
export default function DartScoreConsole({title,scoreboard,message,offline,open,onBack,children,options}:{title:string;scoreboard:ReactNode;message?:string;offline:boolean;open:boolean;onBack:()=>void;children:ReactNode;options?:ReactNode}){
  return <ScoreConsoleFrame open={open} onBack={onBack} className="dart-score-console">{open&&<ScoreConsoleHeader title={title} offline={offline} onBack={onBack}/>}<div className={open?"dart-console-scoreboard":"dart-console-overview"}>{open&&scoreboard}</div><div className="dart-console-input">{children}</div>{open&&message&&<p className="dart-console-status" role="status">{message}</p>}{open&&options&&<details className="dart-console-options"><summary>Stand, darts & correctie</summary><div>{options}</div></details>}</ScoreConsoleFrame>;
}
