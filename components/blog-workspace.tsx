/* The reference stylesheets are deliberately loaded only with the editorial workspace. */
/* eslint-disable @next/next/no-css-tags */
"use client";

import {useEffect,useRef} from 'react';
import {blogStudioMarkup} from './blog-studio-markup';

export default function BlogWorkspace(){
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let dispose:(()=>void)|undefined,cancelled=false;
    void import('./blog-editor-runtime').then(({mountBlogStudio})=>{
      if(!cancelled&&container.current)dispose=mountBlogStudio(container.current);
    });
    return()=>{cancelled=true;dispose?.();};
  },[]);
  return <><link rel="stylesheet" href="/marketing.css"/><link rel="stylesheet" href="/blog-studio.css"/><div className="studio-body" ref={container} dangerouslySetInnerHTML={{__html:blogStudioMarkup}}/></>;
}
