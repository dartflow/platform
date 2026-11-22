"use client";

import {useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import "./score-console.css";

type HistoryRelease={marker:string;url:string};
let pendingHistoryRelease:HistoryRelease|null=null;

/** Presentation only. Closing never changes a match, writer or pending visit. */
export default function ScoreConsoleFrame({children,onBack,onEscape,className="",open=true}:{children:ReactNode;onBack:()=>void;onEscape?:()=>boolean;className?:string;open?:boolean}){
  const [container,setContainer]=useState<HTMLDivElement|null>(null);
  const placeholder=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDivElement>(null),backRef=useRef(onBack),escapeRef=useRef(onEscape);
  useEffect(()=>{backRef.current=onBack;escapeRef.current=onEscape;},[onBack,onEscape]);
  useEffect(()=>{
    const host=document.createElement("div");host.dataset.scoreConsolePortal="true";placeholder.current?.append(host);setContainer(host);
    return()=>{host.remove();};
  },[]);
  useEffect(()=>{
    if(!open)return;
    const openedUrl=location.href,inherited=pendingHistoryRelease;
    const transferred=Boolean(inherited&&inherited.url===openedUrl&&history.state?.dartflowScoreConsole===inherited.marker);
    const marker=transferred?inherited!.marker:crypto.randomUUID();let popped=false;
    if(transferred)pendingHistoryRelease=null;
    else history.pushState({...history.state,dartflowScoreConsole:marker},"",openedUrl);
    const onPop=()=>{popped=true;backRef.current();};window.addEventListener("popstate",onPop);
    return()=>{
      window.removeEventListener("popstate",onPop);
      if(popped||location.href!==openedUrl||history.state?.dartflowScoreConsole!==marker)return;
      // React can replace a total-entry frame with a dart-entry frame in one
      // commit. Transfer its history entry before releasing a genuine close.
      const release={marker,url:openedUrl};pendingHistoryRelease=release;
      queueMicrotask(()=>{
        if(pendingHistoryRelease!==release)return;
        pendingHistoryRelease=null;
        if(location.href===release.url&&history.state?.dartflowScoreConsole===release.marker)history.back();
      });
    };
  },[open]);
  useEffect(()=>{
    if(!container)return;
    if(!open){placeholder.current?.append(container);return;}
    const host=container,anchor=placeholder.current,previousFocus=document.activeElement,scrollX=window.scrollX,scrollY=window.scrollY;
    document.body.append(host);
    const siblings=Array.from(document.body.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==host);
    const inertBefore=siblings.map(node=>node.inert);siblings.forEach(node=>{node.inert=true;});
    document.body.classList.add("score-console-open");
    return()=>{
      siblings.forEach((node,index)=>{node.inert=inertBefore[index];});
      document.body.classList.remove("score-console-open");anchor?.append(host);window.scrollTo(scrollX,scrollY);
      if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});
    };
  },[container,open]);
  useEffect(()=>{if(container&&open)dialog.current?.querySelector<HTMLElement>("[data-console-back]")?.focus({preventScroll:true});},[container,open]);
  return <><div ref={placeholder}/>{container&&createPortal(<div className={open?`score-console ${className}`:"score-console-inline"} role={open?"dialog":undefined} aria-modal={open?true:undefined} aria-label={open?"Schermvullende score-invoer":undefined} ref={dialog} onKeyDown={event=>{
    if(!open)return;
    if(event.key==="Escape"){event.preventDefault();if(!escapeRef.current?.())backRef.current();}
    if(event.key==="Tab"){
      const targets=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')??[]).filter(element=>element.getClientRects().length>0);
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>{children}</div>,container)}</>;
}

export function ScoreConsoleHeader({title,offline,onBack,children}:{title:string;offline:boolean;onBack:()=>void;children?:ReactNode}){
  return <header className="score-console-header"><button data-console-back type="button" onClick={onBack} aria-label="Terug naar wedstrijd">‹ Terug</button><span>{title}</span>{children}<span className={offline?"score-console-offline":"score-console-connected"}>{offline?"Offline":"Live"}</span></header>;
}
